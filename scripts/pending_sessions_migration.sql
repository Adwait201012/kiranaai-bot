-- Pending conversation state (survives server restarts; TTL enforced in app code)
CREATE TABLE IF NOT EXISTS public.pending_sessions (
  phone text PRIMARY KEY,
  session_type text NOT NULL,
  session_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_sessions_created_at
  ON public.pending_sessions (created_at);

ALTER TABLE public.pending_sessions ENABLE ROW LEVEL SECURITY;
