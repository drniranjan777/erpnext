-- =============================================================================
-- NextGen ERP - Row-Level Security & privileges
-- Idempotent. Applied by `npm run db:migrate` after every migration run, so new
-- tables with a tenant_id column are protected automatically.
--
-- Roles:
--   nextgen_owner : owns objects, runs migrations/seeds (not subject to RLS)
--   nextgen_app   : backend runtime role, always subject to RLS
-- Session context (set per transaction by withContext()):
--   app.tenant_id, app.user_id
-- =============================================================================

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- -----------------------------------------------------------------------------
-- 1. Generic tenant isolation for every table with a tenant_id column
--    (special-cased tables below get their own policies)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND c.table_name NOT IN ('memberships')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO nextgen_app
         USING (tenant_id = app_current_tenant())
         WITH CHECK (tenant_id = app_current_tenant())',
      t.table_name);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. tenants: visible when it is the active tenant or the user is a member
-- -----------------------------------------------------------------------------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_access ON tenants;
CREATE POLICY tenant_access ON tenants TO nextgen_app
  USING (
    id = app_current_tenant()
    OR id IN (SELECT m.tenant_id FROM memberships m WHERE m.user_id = app_current_user())
  )
  WITH CHECK (id = app_current_tenant());

-- -----------------------------------------------------------------------------
-- 3. memberships: rows of the active tenant, or the caller's own memberships
--    (needed to list a user's workspaces at login)
-- -----------------------------------------------------------------------------
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS membership_access ON memberships;
CREATE POLICY membership_access ON memberships TO nextgen_app
  USING (tenant_id = app_current_tenant() OR user_id = app_current_user())
  WITH CHECK (tenant_id = app_current_tenant());

-- -----------------------------------------------------------------------------
-- 4. users (global identity): self, or members of the active tenant.
--    Login lookup by email goes through auth_find_user_by_email() below.
-- -----------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_select ON users;
DROP POLICY IF EXISTS user_insert ON users;
DROP POLICY IF EXISTS user_update ON users;
CREATE POLICY user_select ON users FOR SELECT TO nextgen_app
  USING (
    id = app_current_user()
    OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.tenant_id = app_current_tenant())
  );
CREATE POLICY user_insert ON users FOR INSERT TO nextgen_app
  WITH CHECK (id = app_current_user());
CREATE POLICY user_update ON users FOR UPDATE TO nextgen_app
  USING (id = app_current_user())
  WITH CHECK (id = app_current_user());

-- Pre-authentication lookup. SECURITY DEFINER (runs as owner) and returns only
-- what the login flow needs.
CREATE OR REPLACE FUNCTION auth_find_user_by_email(p_email text)
  RETURNS TABLE (id uuid, email citext, full_name text, password_hash text, status user_status,
                 failed_login_count integer, locked_until timestamptz, mfa_enabled boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT u.id, u.email, u.full_name, u.password_hash, u.status, u.failed_login_count, u.locked_until, u.mfa_enabled
    FROM users u WHERE u.email = p_email::citext
  $$;

-- Lets the sign-up flow check slug availability without seeing other tenants.
CREATE OR REPLACE FUNCTION tenant_slug_exists(p_slug text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$ SELECT EXISTS (SELECT 1 FROM tenants WHERE slug = p_slug::citext) $$;

-- Customer / dealer portal sign-in names the workspace by its code before any tenant context.
CREATE OR REPLACE FUNCTION tenant_id_by_slug(p_slug text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$ SELECT id FROM tenants WHERE slug = p_slug::citext AND status IN ('trial', 'active') $$;

-- Invitation preview/accept happens before the invitee has any tenant context.
-- Looks up by token hash only (the raw token is never stored).
CREATE OR REPLACE FUNCTION invitation_by_token_hash(p_hash text)
  RETURNS TABLE (id uuid, tenant_id uuid, email citext, full_name text, role_ids uuid[],
                 expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz,
                 tenant_name text, tenant_slug citext, tenant_status tenant_status, inviter_name text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT i.id, i.tenant_id, i.email, i.full_name, i.role_ids, i.expires_at, i.accepted_at, i.revoked_at,
           t.name, t.slug, t.status, u.full_name
    FROM invitations i
    JOIN tenants t ON t.id = i.tenant_id
    JOIN users u ON u.id = i.invited_by
    WHERE i.token_hash = p_hash
  $$;

-- Revokes all of the CALLER's sessions across every workspace (e.g. after a
-- password change). Refuses to act on anyone but app.user_id.
CREATE OR REPLACE FUNCTION revoke_my_sessions(p_except_session uuid)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    n integer;
  BEGIN
    IF app_current_user() IS NULL THEN
      RAISE EXCEPTION 'app.user_id is not set' USING ERRCODE = '42501';
    END IF;
    UPDATE auth_sessions SET revoked_at = now()
     WHERE user_id = app_current_user()
       AND revoked_at IS NULL
       AND (p_except_session IS NULL OR id <> p_except_session);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
  END
  $$;

-- -----------------------------------------------------------------------------
-- Job queue (ADR-013). Jobs are INSERTed by the app under normal tenant RLS
-- (same transaction as the business change). Workers claim across tenants via
-- these functions, then process each job under that job's tenant context.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION jobs_claim(p_worker text, p_queues text[], p_limit integer)
  RETURNS SETOF jobs
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public
  AS $$
    UPDATE jobs SET status = 'running', locked_at = now(), locked_by = p_worker, attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM jobs
      WHERE queue = ANY (p_queues)
        AND (
          (status = 'queued' AND run_at <= now())
          -- Recover jobs from a crashed worker
          OR (status = 'running' AND locked_at < now() - interval '10 minutes')
        )
      ORDER BY run_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
    )
    RETURNING *
  $$;

CREATE OR REPLACE FUNCTION jobs_complete(p_id uuid)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public
  AS $$
    UPDATE jobs SET status = 'done', completed_at = now(), locked_at = NULL, last_error = NULL WHERE id = p_id
  $$;

-- Exponential backoff: 30s, 1m, 2m, 4m ... until max_attempts, then 'dead'.
CREATE OR REPLACE FUNCTION jobs_fail(p_id uuid, p_error text, p_retryable boolean)
  RETURNS job_status
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public
  AS $$
    UPDATE jobs SET
      status = CASE WHEN p_retryable AND attempts < max_attempts THEN 'queued'::job_status ELSE 'dead'::job_status END,
      run_at = now() + (interval '30 seconds' * power(2, greatest(attempts - 1, 0))),
      locked_at = NULL,
      last_error = left(p_error, 2000)
    WHERE id = p_id
    RETURNING status
  $$;

-- -----------------------------------------------------------------------------
-- SaaS billing: our own GST invoice numbers (platform-wide, gapless per FY)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION saas_next_invoice_number(p_fy text)
  RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    v integer;
  BEGIN
    INSERT INTO platform_counters (key, value) VALUES ('saas_invoice:' || p_fy, 1)
    ON CONFLICT (key) DO UPDATE SET value = platform_counters.value + 1, updated_at = now()
    RETURNING value INTO v;
    -- ≤ 16 chars (CGST Rule 46): NGE/26-27/000001
    RETURN 'NGE/' || p_fy || '/' || lpad(v::text, 6, '0');
  END
  $$;

-- -----------------------------------------------------------------------------
-- API keys: pre-authentication lookup by public prefix
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api_key_lookup(p_prefix text)
  RETURNS TABLE (id uuid, tenant_id uuid, key_hash text, scopes text[], created_by uuid, membership_id uuid,
                 expires_at timestamptz, revoked_at timestamptz, last_used_at timestamptz,
                 tenant_status tenant_status, membership_status membership_status)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT k.id, k.tenant_id, k.key_hash, k.scopes, k.created_by, k.membership_id, k.expires_at, k.revoked_at, k.last_used_at,
           t.status, m.status
    FROM api_keys k
    JOIN tenants t ON t.id = k.tenant_id
    JOIN memberships m ON m.id = k.membership_id
    WHERE k.prefix = p_prefix
  $$;

-- -----------------------------------------------------------------------------
-- Platform super-admin (cross-tenant). Callers must also set app.platform_admin
-- = 'true' in the transaction (done only by PlatformAdminGuard routes).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_platform_admin() RETURNS void
  LANGUAGE plpgsql STABLE
  AS $$
  BEGIN
    IF coalesce(current_setting('app.platform_admin', true), '') <> 'true' THEN
      RAISE EXCEPTION 'platform admin context required' USING ERRCODE = '42501';
    END IF;
  END
  $$;

CREATE OR REPLACE FUNCTION admin_tenants()
  RETURNS TABLE (id uuid, slug citext, name text, status tenant_status, plan_code text, industry text,
                 created_at timestamptz, trial_ends_at timestamptz, settings jsonb,
                 subscription_status subscription_status, current_period_end timestamptz,
                 active_users bigint, documents bigint, storage_bytes bigint, last_login_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
  BEGIN
    PERFORM assert_platform_admin();
    RETURN QUERY
    SELECT t.id, t.slug, t.name, t.status, t.plan_code, t.industry, t.created_at, t.trial_ends_at, t.settings,
           s.status, s.current_period_end,
           (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id AND m.status = 'active'),
           (SELECT count(*) FROM documents d WHERE d.tenant_id = t.id),
           (SELECT coalesce(sum(a.size_bytes), 0)::bigint FROM attachments a WHERE a.tenant_id = t.id AND a.deleted_at IS NULL),
           (SELECT max(u.last_login_at) FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = t.id)
    FROM tenants t
    LEFT JOIN subscriptions s ON s.tenant_id = t.id
    ORDER BY t.created_at DESC;
  END
  $$;

CREATE OR REPLACE FUNCTION admin_update_tenant(p_id uuid, p_status tenant_status, p_plan_code text,
                                               p_trial_ends_at timestamptz, p_feature_overrides jsonb)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public
  AS $$
  BEGIN
    PERFORM assert_platform_admin();
    UPDATE tenants SET
      status = coalesce(p_status, status),
      plan_code = coalesce(p_plan_code, plan_code),
      trial_ends_at = coalesce(p_trial_ends_at, trial_ends_at),
      settings = CASE WHEN p_feature_overrides IS NULL THEN settings
                      ELSE jsonb_set(settings, '{featureOverrides}', p_feature_overrides) END,
      updated_at = now()
    WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'P0002'; END IF;
  END
  $$;

-- -----------------------------------------------------------------------------
-- 5. Privileges
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO nextgen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nextgen_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nextgen_app;

-- Global catalog: read-only for the app
REVOKE INSERT, UPDATE, DELETE ON permissions FROM nextgen_app;
-- Audit trail is append-only
REVOKE UPDATE, DELETE ON audit_logs FROM nextgen_app;
-- Electronic signatures are never changed or removed (21 CFR Part 11 / Annex 11).
REVOKE UPDATE, DELETE ON e_signatures FROM nextgen_app;
-- Tenants cannot be deleted by the app (archive instead)
REVOKE DELETE ON tenants FROM nextgen_app;

REVOKE ALL ON FUNCTION auth_find_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text) TO nextgen_app;
REVOKE ALL ON FUNCTION tenant_slug_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_slug_exists(text) TO nextgen_app;
REVOKE ALL ON FUNCTION tenant_id_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_id_by_slug(text) TO nextgen_app;
REVOKE ALL ON FUNCTION invitation_by_token_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invitation_by_token_hash(text) TO nextgen_app;
REVOKE ALL ON FUNCTION revoke_my_sessions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_my_sessions(uuid) TO nextgen_app;
REVOKE ALL ON FUNCTION jobs_claim(text, text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION jobs_claim(text, text[], integer) TO nextgen_app;
REVOKE ALL ON FUNCTION jobs_complete(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION jobs_complete(uuid) TO nextgen_app;
REVOKE ALL ON FUNCTION jobs_fail(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION jobs_fail(uuid, text, boolean) TO nextgen_app;
REVOKE ALL ON FUNCTION saas_next_invoice_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION saas_next_invoice_number(text) TO nextgen_app;
REVOKE ALL ON FUNCTION api_key_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_key_lookup(text) TO nextgen_app;
REVOKE ALL ON FUNCTION admin_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_tenants() TO nextgen_app;
REVOKE ALL ON FUNCTION admin_update_tenant(uuid, tenant_status, text, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_update_tenant(uuid, tenant_status, text, timestamptz, jsonb) TO nextgen_app;
-- Platform counters are only reachable through saas_next_invoice_number()
REVOKE ALL ON platform_counters FROM nextgen_app;
-- Issued tax invoices and provider events are immutable for the app
REVOKE DELETE ON saas_invoices FROM nextgen_app;
REVOKE UPDATE, DELETE ON billing_events FROM nextgen_app;
-- The stock ledger is append-only (corrections are reversal rows)
REVOKE UPDATE, DELETE ON stock_ledger FROM nextgen_app;
REVOKE UPDATE, DELETE ON gl_entries FROM nextgen_app;
REVOKE UPDATE, DELETE ON gst_api_logs FROM nextgen_app;
-- Job and delivery history is append/update only from the app's point of view
REVOKE DELETE ON jobs FROM nextgen_app;
REVOKE DELETE ON notification_deliveries FROM nextgen_app;

-- -----------------------------------------------------------------------------
-- Partners (platform-wide, no tenant_id). The app has no direct access: partner
-- users see their own partner, client workspaces and commissions through these
-- functions; platform administrators manage partners through admin_* functions.
-- -----------------------------------------------------------------------------
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_commissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON partners, partner_members, partner_commissions FROM nextgen_app;

CREATE OR REPLACE FUNCTION partner_of_current_user()
  RETURNS TABLE (id uuid, code citext, name text, kind text, commission_pct double precision, certified boolean, status text, role text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT p.id, p.code, p.name, p.kind, p.commission_pct, p.certified, p.status, m.role
    FROM partner_members m JOIN partners p ON p.id = m.partner_id
    WHERE m.user_id = app_current_user()
    ORDER BY p.name
  $$;

CREATE OR REPLACE FUNCTION partner_clients()
  RETURNS TABLE (id uuid, slug citext, name text, status tenant_status, plan_code text, partner_id uuid,
                 subscription_status subscription_status, current_period_end timestamptz, created_at timestamptz, active_users bigint)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT t.id, t.slug, t.name, t.status, t.plan_code, t.partner_id, s.status, s.current_period_end, t.created_at,
           (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id AND m.status = 'active')
    FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id
    WHERE t.partner_id IN (SELECT pm.partner_id FROM partner_members pm WHERE pm.user_id = app_current_user())
    ORDER BY t.created_at DESC
  $$;

CREATE OR REPLACE FUNCTION partner_commissions_mine()
  RETURNS TABLE (id uuid, partner_id uuid, client text, invoice_number text, base_amount double precision, rate_pct double precision,
                 amount double precision, status text, payout_ref text, accrued_at timestamptz, paid_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT c.id, c.partner_id, t.name, c.invoice_number, c.base_amount, c.rate_pct, c.amount, c.status, c.payout_ref, c.accrued_at, c.paid_at
    FROM partner_commissions c JOIN tenants t ON t.id = c.client_tenant_id
    WHERE c.partner_id IN (SELECT pm.partner_id FROM partner_members pm WHERE pm.user_id = app_current_user())
    ORDER BY c.accrued_at DESC
  $$;

-- True when the current user may create workspaces for this partner.
CREATE OR REPLACE FUNCTION partner_can_provision(p_partner uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT EXISTS (SELECT 1 FROM partner_members m JOIN partners p ON p.id = m.partner_id
                   WHERE m.partner_id = p_partner AND m.user_id = app_current_user() AND p.status = 'active')
  $$;

-- The workspace owner names (or clears) the partner managing the workspace.
CREATE OR REPLACE FUNCTION tenant_set_partner(p_code text)
  RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    v_partner partners%ROWTYPE;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = app_current_tenant() AND m.user_id = app_current_user() AND m.is_owner AND m.status = 'active') THEN
      RAISE EXCEPTION 'Only the workspace owner can choose the partner' USING ERRCODE = '42501';
    END IF;
    IF p_code IS NULL THEN
      UPDATE tenants SET partner_id = NULL WHERE id = app_current_tenant();
      RETURN NULL;
    END IF;
    SELECT * INTO v_partner FROM partners WHERE code = p_code AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No active partner with this code' USING ERRCODE = 'P0002';
    END IF;
    UPDATE tenants SET partner_id = v_partner.id WHERE id = app_current_tenant();
    RETURN v_partner.name;
  END
  $$;

CREATE OR REPLACE FUNCTION tenant_partner()
  RETURNS TABLE (code citext, name text, kind text, certified boolean, email text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT p.code, p.name, p.kind, p.certified, p.email FROM tenants t JOIN partners p ON p.id = t.partner_id WHERE t.id = app_current_tenant()
  $$;

CREATE OR REPLACE FUNCTION admin_partners()
  RETURNS TABLE (id uuid, code citext, name text, kind text, email text, gstin text, commission_pct double precision, certified boolean,
                 status text, created_at timestamptz, clients bigint, members bigint, accrued double precision, paid double precision)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
  BEGIN
    PERFORM assert_platform_admin();
    RETURN QUERY
    SELECT p.id, p.code, p.name, p.kind, p.email, p.gstin, p.commission_pct, p.certified, p.status, p.created_at,
           (SELECT count(*) FROM tenants t WHERE t.partner_id = p.id),
           (SELECT count(*) FROM partner_members m WHERE m.partner_id = p.id),
           (SELECT coalesce(sum(c.amount), 0) FROM partner_commissions c WHERE c.partner_id = p.id AND c.status = 'accrued'),
           (SELECT coalesce(sum(c.amount), 0) FROM partner_commissions c WHERE c.partner_id = p.id AND c.status = 'paid')
    FROM partners p ORDER BY p.name;
  END
  $$;

CREATE OR REPLACE FUNCTION admin_save_partner(p_id uuid, p_code text, p_name text, p_kind text, p_email text, p_gstin text,
                                              p_pct double precision, p_certified boolean, p_status text)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    v_id uuid;
  BEGIN
    PERFORM assert_platform_admin();
    IF p_id IS NULL THEN
      INSERT INTO partners (code, name, kind, email, gstin, commission_pct, certified, status)
      VALUES (p_code, p_name, p_kind, p_email, p_gstin, p_pct, p_certified, p_status) RETURNING partners.id INTO v_id;
    ELSE
      UPDATE partners SET code = p_code, name = p_name, kind = p_kind, email = p_email, gstin = p_gstin, commission_pct = p_pct,
                          certified = p_certified, status = p_status
      WHERE partners.id = p_id RETURNING partners.id INTO v_id;
    END IF;
    RETURN v_id;
  END
  $$;

CREATE OR REPLACE FUNCTION admin_add_partner_member(p_partner uuid, p_email text, p_role text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    v_user uuid;
  BEGIN
    PERFORM assert_platform_admin();
    SELECT u.id INTO v_user FROM users u WHERE lower(u.email) = lower(p_email);
    IF v_user IS NULL THEN
      RAISE EXCEPTION 'No user with this email: they must sign up first' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO partner_members (partner_id, user_id, role) VALUES (p_partner, v_user, p_role)
    ON CONFLICT (partner_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  END
  $$;

-- Commission on every paid subscription invoice of a partner's client workspaces, once per invoice.
CREATE OR REPLACE FUNCTION admin_accrue_commissions()
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    n integer;
  BEGIN
    PERFORM assert_platform_admin();
    INSERT INTO partner_commissions (partner_id, client_tenant_id, invoice_id, invoice_number, base_amount, rate_pct, amount)
    SELECT t.partner_id, i.tenant_id, i.id, i.number, i.taxable_amount, p.commission_pct, round(i.taxable_amount * p.commission_pct::numeric / 100, 2)
    FROM saas_invoices i JOIN tenants t ON t.id = i.tenant_id JOIN partners p ON p.id = t.partner_id
    WHERE i.status = 'paid' AND p.status = 'active' AND p.commission_pct > 0
    ON CONFLICT (invoice_id) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
  END
  $$;

CREATE OR REPLACE FUNCTION admin_pay_commissions(p_partner uuid, p_ref text)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    n integer;
  BEGIN
    PERFORM assert_platform_admin();
    UPDATE partner_commissions SET status = 'paid', paid_at = now(), payout_ref = p_ref WHERE partner_id = p_partner AND status = 'accrued';
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
  END
  $$;

-- Login page branding for a verified custom domain (no session yet).
CREATE OR REPLACE FUNCTION branding_by_domain(p_host text)
  RETURNS TABLE (tenant_slug citext, product_name text, logo text, primary_color text, accent_color text, support_email text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT t.slug, b.product_name, b.logo, b.primary_color, b.accent_color, b.support_email
    FROM tenant_branding b JOIN tenants t ON t.id = b.tenant_id
    WHERE b.custom_domain = p_host AND b.domain_verified_at IS NOT NULL AND t.status IN ('trial', 'active')
  $$;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['partner_of_current_user()', 'partner_clients()', 'partner_commissions_mine()', 'partner_can_provision(uuid)',
                           'tenant_set_partner(text)', 'tenant_partner()', 'admin_partners()',
                           'admin_save_partner(uuid, text, text, text, text, text, double precision, boolean, text)',
                           'admin_add_partner_member(uuid, text, text)', 'admin_accrue_commissions()', 'admin_pay_commissions(uuid, text)',
                           'branding_by_domain(text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO nextgen_app', f);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Connector inbound webhooks arrive without a session: find the installation
-- (and so the workspace) by its id. The secret stays encrypted; the app checks
-- the signature before doing anything in that workspace.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION connector_installation(p_id uuid)
  RETURNS TABLE (id uuid, tenant_id uuid, connector text, enabled boolean, webhook_secret_encrypted text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT i.id, i.tenant_id, i.connector, i.enabled, i.webhook_secret_encrypted
    FROM app_installations i JOIN tenants t ON t.id = i.tenant_id
    WHERE i.id = p_id AND t.status IN ('trial', 'active')
  $$;
REVOKE ALL ON FUNCTION connector_installation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connector_installation(uuid) TO nextgen_app;
