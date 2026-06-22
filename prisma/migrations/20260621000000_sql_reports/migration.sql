-- Custom SQL Reports (Metabase-style) — table + Row-Level Security setup.
--
-- Security model (see docs/superpowers/specs/2026-06-21-sql-reports-design.md):
--   * A dedicated NOLOGIN role `chatbot_report_ro` with SELECT only on an
--     allow-list of reportable tables. Admin SQL runs under this role.
--   * RLS policies pin every reportable row to current_setting('app.tenant_id').
--   * A defensive permissive policy keeps the application's own role unaffected
--     even if it is not the table owner (owners bypass RLS automatically).

-- ---------------------------------------------------------------------------
-- 1. reports table
-- ---------------------------------------------------------------------------
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sqlText" TEXT NOT NULL,
    "vizType" TEXT NOT NULL DEFAULT 'table',
    "vizConfig" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reports_tenantId_idx" ON "reports"("tenantId");

ALTER TABLE "reports" ADD CONSTRAINT "reports_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. dedicated read-only reporting role
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'chatbot_report_ro') THEN
    CREATE ROLE chatbot_report_ro NOLOGIN NOBYPASSRLS;
  END IF;
END$$;

-- Allow the application's connection user to SET ROLE into the reporting role.
-- (Migrations run as the app/runtime DB user; if your runtime user differs from
--  the migration user, grant membership to it manually.)
GRANT chatbot_report_ro TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO chatbot_report_ro;

-- SELECT only, only on the v1 allow-list of reportable tables.
GRANT SELECT ON
  "inference_sessions",
  "session_analytics",
  "agents",
  "agent_executions",
  "api_key_executions",
  "scores"
TO chatbot_report_ro;

-- ---------------------------------------------------------------------------
-- 3. RLS policies on each reportable table
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  reportable text[] := ARRAY[
    'inference_sessions',
    'session_analytics',
    'agents',
    'agent_executions',
    'api_key_executions',
    'scores'
  ];
BEGIN
  FOREACH t IN ARRAY reportable LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    -- Restrict the reporting role to the current tenant. current_setting(...,
    -- true) returns NULL when unset -> matches no rows (default deny).
    EXECUTE format('DROP POLICY IF EXISTS report_tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY report_tenant_isolation ON %I FOR SELECT TO chatbot_report_ro '
      || 'USING ("tenantId" = current_setting(''app.tenant_id'', true))',
      t
    );

    -- Defensive: every other role (the app) is unrestricted. Owners bypass RLS
    -- regardless; this keeps non-owner app roles working too. Excludes the
    -- reporting role so it stays bound to the tenant policy above.
    EXECUTE format('DROP POLICY IF EXISTS report_app_bypass ON %I', t);
    EXECUTE format(
      'CREATE POLICY report_app_bypass ON %I FOR ALL TO PUBLIC '
      || 'USING (current_user <> ''chatbot_report_ro'') '
      || 'WITH CHECK (current_user <> ''chatbot_report_ro'')',
      t
    );
  END LOOP;
END$$;
