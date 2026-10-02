-- READ ONLY. Run before enabling Anonymous Sign-Ins in the existing project.
-- No guest rows, invitation codes, function bodies or secrets are selected.
-- Local migration files cannot establish the actual deployed authorization state.
-- A clean result here is not sufficient: exercise access using real test identities.

-- Views may execute as their owner and bypass the base tables' RLS.
select n.nspname as schema_name, c.relname as object_name,
       c.relkind, c.relrowsecurity as rls_enabled,
       coalesce(c.reloptions, array[]::text[]) as view_options,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_can_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','v','m')
order by c.relname;

-- Examine policy role/command coverage without exposing policy expressions.
select schemaname, tablename, policyname, permissive, roles, cmd
from pg_policies where schemaname in ('public','realtime')
order by schemaname, tablename, policyname;

-- Review exposed SECURITY DEFINER RPCs: grants plus their implementation in a
-- trusted editor. Do not paste function bodies into logs or a public report.
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as argument_types,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef
order by p.proname;

-- Check Anonymous Auth enablement, same-IP quotas, JWT expiry and Realtime
-- project settings separately in the Dashboard. CAPTIONS_GUEST_AUTH_AUDITED
-- must remain false until existing private-data access tests also pass.
