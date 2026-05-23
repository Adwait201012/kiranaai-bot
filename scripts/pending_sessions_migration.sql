-- Pending conversation state (survives server restarts; TTL enforced in app code)
CREATE TABLE IF NOT EXISTS public.pending_sessions (
  phone text PRIMARY KEY,
  session_type text NOT NULL,
  session_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_sessions_created_at
  ON public.pending_sessions (created_at);

-- Backend uses service role; allow full access if using anon/authenticated key
ALTER TABLE public.pending_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pending_sessions_backend_all" ON public.pending_sessions;
CREATE POLICY "pending_sessions_backend_all"
  ON public.pending_sessions
  FOR ALL
  USING (true)
  WITH CHECK (true);
