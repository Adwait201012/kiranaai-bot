-- BharatBahi shop join codes + pending approvals + udhaar attribution
-- Run in Supabase SQL editor after shop_employees.sql

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS join_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS join_code_expires_at timestamptz;

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

ALTER TABLE public.udhaar_logs
  ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shops(id),
  ADD COLUMN IF NOT EXISTS entered_by text;

CREATE INDEX IF NOT EXISTS idx_udhaar_logs_shop_id
  ON public.udhaar_logs (shop_id);

ALTER TABLE public.pending_join_requests ENABLE ROW LEVEL SECURITY;
