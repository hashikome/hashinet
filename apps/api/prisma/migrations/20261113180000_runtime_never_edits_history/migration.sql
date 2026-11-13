-- The API's runtime role must never edit the migration history. The migrator's default privileges
-- (infra's allocate-hashinet.sql) grant it every table the migrator creates, _prisma_migrations
-- included, so a fresh database gave it write access until someone re-applied the allocator. Run as
-- the migrator, which owns the table; where the role doesn't exist (development, tests) it does
-- nothing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hashinet_runtime') THEN
    REVOKE ALL ON TABLE public._prisma_migrations FROM hashinet_runtime;
  END IF;
END $$;
