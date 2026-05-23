-- Run in Supabase SQL Editor after deploying code changes

-- 1. Join brute-force protection
CREATE TABLE IF NOT EXISTS public.join_attempts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  attempted_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_join_attempts_phone_time
  ON public.join_attempts (phone, attempted_at);

-- 2. Customer normalized names (dedupe Sharma / Sharma Ji)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.registered_shops(id);
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS normalized_name text;

UPDATE public.customers c
SET normalized_name = lower(trim(regexp_replace(
  regexp_replace(c.customer_name, '\s*(ji|bhai|ben|behen|didi|sahab|sir|madam|mr|mrs|ms)\s*', ' ', 'gi'),
  '\s+', ' ', 'g'
)))
WHERE normalized_name IS NULL AND customer_name IS NOT NULL;

UPDATE public.customers c
SET shop_id = rs.id
FROM public.registered_shops rs
WHERE c.shop_id IS NULL AND c.owner_phone = rs.owner_phone;

CREATE UNIQUE INDEX IF NOT EXISTS unique_customer_per_owner_normalized
  ON public.customers (owner_phone, normalized_name)
  WHERE normalized_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unique_customer_per_shop_normalized
  ON public.customers (shop_id, normalized_name)
  WHERE shop_id IS NOT NULL AND normalized_name IS NOT NULL;

-- 3. One shop per owner (race-safe registration)
CREATE UNIQUE INDEX IF NOT EXISTS registered_shops_owner_phone_unique
  ON public.registered_shops (owner_phone);

-- 4. One employee row per shop+phone
CREATE UNIQUE INDEX IF NOT EXISTS shop_employees_shop_phone_unique
  ON public.shop_employees (shop_id, employee_phone);

-- 5. Pending udhaar summary (signed amount column — no type field)
CREATE OR REPLACE FUNCTION public.get_pending_udhaar_summary(p_owner_phone text)
RETURNS TABLE (customer_name text, total_balance numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    customer_name,
    SUM(amount)::numeric AS total_balance
  FROM public.udhaar_logs
  WHERE owner_phone = p_owner_phone
  GROUP BY customer_name
  HAVING SUM(amount) <> 0
  ORDER BY total_balance DESC;
$$;
