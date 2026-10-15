
-- agent_events: real-time events from agents
CREATE TABLE public.agent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.agent_events TO authenticated;
GRANT INSERT ON public.agent_events TO authenticated;
GRANT ALL ON public.agent_events TO service_role;

ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin read events" ON public.agent_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_device_access(device_id, auth.uid()));

CREATE POLICY "service insert events" ON public.agent_events FOR INSERT TO service_role
  WITH CHECK (true);

-- agent_audit: destructive command audit log
CREATE TABLE public.agent_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  operator_id uuid,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.agent_audit TO authenticated;
GRANT INSERT ON public.agent_audit TO authenticated;
GRANT ALL ON public.agent_audit TO service_role;

ALTER TABLE public.agent_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin read audit" ON public.agent_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_device_access(device_id, auth.uid()));

CREATE POLICY "auth insert audit" ON public.agent_audit FOR INSERT TO authenticated
  WITH CHECK (true);

-- agent_builds: versioned agent builds
CREATE TABLE public.agent_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  url text NOT NULL,
  sha256 text NOT NULL,
  channel text NOT NULL DEFAULT 'stable',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.agent_builds TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.agent_builds TO authenticated;
GRANT ALL ON public.agent_builds TO service_role;

ALTER TABLE public.agent_builds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin manage builds" ON public.agent_builds FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- agent_rules: event-driven automation rules
CREATE TABLE public.agent_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match jsonb NOT NULL DEFAULT '{}',
  action jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_rules TO authenticated;
GRANT ALL ON public.agent_rules TO service_role;

ALTER TABLE public.agent_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin manage rules" ON public.agent_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Index for fast device event lookups
CREATE INDEX idx_agent_events_device ON public.agent_events(device_id, created_at DESC);
CREATE INDEX idx_agent_audit_device ON public.agent_audit(device_id, created_at DESC);
