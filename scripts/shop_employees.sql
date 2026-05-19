-- ═══════════════════════════════════════════════════════════════════════════
-- shop_employees.sql  —  BharatBahi multi-tenant schema (production-ready)
-- Run this in the Supabase SQL editor or via psql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── EXTENSION ───────────────────────────────────────────────────────────────
-- pgcrypto for gen_random_uuid() (already enabled in Supabase by default)
-- Nothing extra to enable.

-- ── 1. SHOPS TABLE ───────────────────────────────────────────────────────────
-- Represents each registered business / kirana store.
-- shop_owner_phone is stored in E.164 format (+91XXXXXXXXXX).
CREATE TABLE IF NOT EXISTS public.shops (
  id                uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_phone       text          NOT NULL,
  shop_name         text          NOT NULL,
  created_at        timestamptz   DEFAULT now(),

  -- owner_phone: Twilio WhatsApp ID (e.g. whatsapp:+91XXXXXXXXXX)

  -- One owner can have only one shop (extend to UNIQUE(owner_phone, shop_name)
  -- if you want multi-shop owners in future).
  CONSTRAINT shops_owner_phone_unique UNIQUE (owner_phone),

  join_code              text,
  join_code_expires_at   timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS shops_join_code_unique
  ON public.shops (join_code)
  WHERE join_code IS NOT NULL;

-- ── 2. SHOP EMPLOYEES TABLE ──────────────────────────────────────────────────
-- Represents every person (owner OR staff) who can interact with the bot
-- on behalf of a shop.
CREATE TABLE IF NOT EXISTS public.shop_employees (
  id              uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id         uuid          NOT NULL
                    REFERENCES public.shops (id)
                    ON DELETE CASCADE,
  -- Denormalised for fast lookups without an extra join (mirrors shops.owner_phone)
  shop_owner_phone text         NOT NULL,
  employee_phone  text          NOT NULL,
  employee_name   text,
  is_owner        boolean       NOT NULL DEFAULT false,
  created_at      timestamptz   DEFAULT now(),

  -- employee_phone: Twilio WhatsApp ID (e.g. whatsapp:+91XXXXXXXXXX)

  -- An employee can work for multiple shops (fixed: was UNIQUE(employee_phone))
  CONSTRAINT emp_shop_unique UNIQUE (shop_id, employee_phone)
);

-- ── 3. INDEXES ───────────────────────────────────────────────────────────────
-- Fast lookup when resolving which shop an employee belongs to
CREATE INDEX IF NOT EXISTS idx_shop_employees_employee_phone
  ON public.shop_employees (employee_phone);

-- Fast lookup of all staff for a given owner
CREATE INDEX IF NOT EXISTS idx_shop_employees_shop_owner_phone
  ON public.shop_employees (shop_owner_phone);

-- Fast lookup by shop_id (FK scans)
CREATE INDEX IF NOT EXISTS idx_shop_employees_shop_id
  ON public.shop_employees (shop_id);

-- ── 4. IDEMPOTENCY TABLE ─────────────────────────────────────────────────────
-- Stores processed WhatsApp message IDs to prevent double-processing.
-- WhatsApp Cloud API may deliver the same webhook more than once.
CREATE TABLE IF NOT EXISTS public.processed_messages (
  message_id  text        PRIMARY KEY,          -- wamid.xxx from WhatsApp
  owner_phone text        NOT NULL,
  processed_at timestamptz DEFAULT now()
);

-- Auto-purge rows older than 7 days (run this periodically via pg_cron or a
-- Supabase Edge Function scheduled job):
--   DELETE FROM processed_messages WHERE processed_at < now() - interval '7 days';

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_processed_messages_processed_at
  ON public.processed_messages (processed_at);

-- ── 4b. PENDING JOIN REQUESTS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pending_join_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE,
  employee_phone text NOT NULL,
  employee_name text,
  requested_at timestamptz DEFAULT now(),
  status text DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  CONSTRAINT unique_pending UNIQUE (shop_id, employee_phone)
);

CREATE INDEX IF NOT EXISTS idx_pending_join_shop_status
  ON public.pending_join_requests (shop_id, status);

-- ── 5. ROW-LEVEL SECURITY (RLS) ──────────────────────────────────────────────
-- Enable RLS on all tables so authenticated app users can only see their data.

ALTER TABLE public.shops            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_employees   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_messages ENABLE ROW LEVEL SECURITY;

-- Policy: service-role key (used by the Node.js backend) bypasses RLS
-- automatically — no policy needed for it.

-- Policy example for anon/authenticated role (e.g., a future owner dashboard):
-- Replace 'authenticated' with your actual role if different.

-- Shops: owners can only read/write their own shop row
CREATE POLICY IF NOT EXISTS "shops_owner_access"
  ON public.shops
  FOR ALL
  TO authenticated
  USING (owner_phone = current_setting('app.current_owner_phone', true))
  WITH CHECK (owner_phone = current_setting('app.current_owner_phone', true));

-- Employees: employees can only see their own shop's records
CREATE POLICY IF NOT EXISTS "shop_employees_shop_access"
  ON public.shop_employees
  FOR ALL
  TO authenticated
  USING (shop_owner_phone = current_setting('app.current_owner_phone', true))
  WITH CHECK (shop_owner_phone = current_setting('app.current_owner_phone', true));

-- processed_messages: only the owning phone can see entries
CREATE POLICY IF NOT EXISTS "processed_messages_owner_access"
  ON public.processed_messages
  FOR ALL
  TO authenticated
  USING (owner_phone = current_setting('app.current_owner_phone', true))
  WITH CHECK (owner_phone = current_setting('app.current_owner_phone', true));

-- ── 6. HELPER: normalise phone to E.164 (Indian default) ────────────────────
-- Call before INSERT: SELECT normalise_phone('9999999999') → '+919999999999'
CREATE OR REPLACE FUNCTION public.normalise_phone(raw text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  digits text;
BEGIN
  -- Strip everything except digits and leading +
  digits := regexp_replace(raw, '[^0-9]', '', 'g');

  -- 10-digit Indian number → prepend +91
  IF length(digits) = 10 THEN
    RETURN '+91' || digits;
  END IF;

  -- 12-digit starting with 91 (Indian with country code, no +)
  IF length(digits) = 12 AND left(digits, 2) = '91' THEN
    RETURN '+' || digits;
  END IF;

  -- Already has +, just strip non-digits and re-add +
  IF left(raw, 1) = '+' THEN
    RETURN '+' || digits;
  END IF;

  -- Fallback: return as-is with + prefix
  RETURN '+' || digits;
END;
$$;

-- ── 7. SEED: register the owner as their own employee ────────────────────────
-- Run this after inserting a shop row to bootstrap the employee table.
-- (In production this is handled by registerShop() in udhaarService.js)
--
-- Example:
--   INSERT INTO public.shops (owner_phone, shop_name)
--     VALUES (normalise_phone('9999999999'), 'Sharma General Store');
--
--   INSERT INTO public.shop_employees
--     (shop_id, shop_owner_phone, employee_phone, employee_name, is_owner)
--   SELECT id, owner_phone, owner_phone, 'Owner', true
--     FROM public.shops WHERE owner_phone = '+919999999999';

-- ── 8. TRIGGER: enforce exactly ONE is_owner = TRUE per shop ─────────────────
-- Fires BEFORE INSERT or UPDATE on shop_employees.
-- Raises an error if:
--   a) You try to set is_owner = TRUE when one already exists for that shop.
--   b) (Optional) You try to demote the last owner (uncomment block below).

CREATE OR REPLACE FUNCTION public.enforce_single_owner()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  existing_owner_count integer;
BEGIN
  -- Only check when is_owner is being set to TRUE
  IF NEW.is_owner = TRUE THEN
    SELECT COUNT(*) INTO existing_owner_count
    FROM public.shop_employees
    WHERE shop_id = NEW.shop_id
      AND is_owner = TRUE
      -- Exclude the row being updated (so UPDATE owner→owner is a no-op)
      AND id IS DISTINCT FROM NEW.id;

    IF existing_owner_count > 0 THEN
      RAISE EXCEPTION
        'Shop % already has an owner. A shop can have exactly one is_owner = TRUE row.',
        NEW.shop_id;
    END IF;
  END IF;

  -- Optional: prevent demoting the last owner
  -- Uncomment if you want to block setting is_owner = FALSE on the sole owner:
  --
  -- IF OLD.is_owner = TRUE AND NEW.is_owner = FALSE THEN
  --   SELECT COUNT(*) INTO existing_owner_count
  --   FROM public.shop_employees
  --   WHERE shop_id = NEW.shop_id AND is_owner = TRUE AND id != NEW.id;
  --   IF existing_owner_count = 0 THEN
  --     RAISE EXCEPTION 'Cannot demote the only owner of shop %.', NEW.shop_id;
  --   END IF;
  -- END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger to shop_employees (fires before each row INSERT or UPDATE)
DROP TRIGGER IF EXISTS trg_enforce_single_owner ON public.shop_employees;
CREATE TRIGGER trg_enforce_single_owner
  BEFORE INSERT OR UPDATE ON public.shop_employees
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_single_owner();

-- ── 9. INSERT EXAMPLES ────────────────────────────────────────────────────────

-- Step 1: Register a new shop
INSERT INTO public.shops (owner_phone, shop_name)
VALUES (normalise_phone('9876543210'), 'Sharma General Store');

-- Step 2: Add the owner as an employee (is_owner = TRUE)
INSERT INTO public.shop_employees
  (shop_id, shop_owner_phone, employee_phone, employee_name, is_owner)
SELECT
  s.id,
  s.owner_phone,
  s.owner_phone,
  'Owner',
  TRUE
FROM public.shops s
WHERE s.owner_phone = normalise_phone('9876543210');

-- Step 3: Add a regular employee to the same shop
INSERT INTO public.shop_employees
  (shop_id, shop_owner_phone, employee_phone, employee_name, is_owner)
SELECT
  s.id,
  s.owner_phone,
  normalise_phone('9399867001'),
  'Raju Helper',
  FALSE
FROM public.shops s
WHERE s.owner_phone = normalise_phone('9876543210');

-- Step 4: Same employee at a DIFFERENT shop (now allowed — composite unique key)
INSERT INTO public.shop_employees
  (shop_id, shop_owner_phone, employee_phone, employee_name, is_owner)
SELECT
  s.id,
  s.owner_phone,
  normalise_phone('9399867001'),
  'Raju Helper',
  FALSE
FROM public.shops s
WHERE s.owner_phone = normalise_phone('9111222333');
-- ↑ This will succeed because (shop_id, employee_phone) is different.
-- ↑ The old UNIQUE(employee_phone) would have blocked this entirely.

-- Step 5: Verify — list all employees for a shop with owner status
SELECT
  e.employee_name,
  e.employee_phone,
  e.is_owner,
  s.shop_name
FROM public.shop_employees e
JOIN public.shops s ON s.id = e.shop_id
WHERE s.owner_phone = normalise_phone('9876543210')
ORDER BY e.is_owner DESC, e.created_at;

