-- PostgREST 14 retries SQLSTATE 40001 as a serialization failure. Caption
-- functions used it for deterministic stale-fence conflicts, which can turn one
-- rejected RPC into an unbounded retry loop. Rebuild only the three public
-- caption functions that explicitly assign that code, preserving their full
-- deployed definitions (including later CREATE OR REPLACE migrations), and map
-- the same checks to an HTTP 409 without retry semantics.

DO $migration$
DECLARE
  function_record record;
  function_definition text;
BEGIN
  FOR function_record IN
    SELECT p.oid
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.oid IN (
        'public.caption_consume_uplink_ticket(text,text)'::regprocedure,
        'public.caption_assert_fence(uuid,integer,bigint)'::regprocedure,
        'public.caption_checkpoint_draft(uuid,integer,bigint,jsonb,jsonb)'::regprocedure
      )
      AND p.prosrc ~* 'ERRCODE\s*=\s*''40001'''
  LOOP
    function_definition := pg_get_functiondef(function_record.oid);
    function_definition := regexp_replace(
      function_definition,
      'ERRCODE\s*=\s*''40001''',
      'ERRCODE = ''PT409''',
      'gi'
    );
    EXECUTE function_definition;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND left(p.proname, 8) = 'caption_'
      AND p.prokind = 'f'
      AND p.prosrc ~* 'ERRCODE\s*=\s*''40001'''
  ) THEN
    RAISE EXCEPTION 'caption function still assigns retryable SQLSTATE 40001';
  END IF;
END;
$migration$;
