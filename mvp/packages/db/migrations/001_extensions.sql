-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid(), pgp_sym_encrypt
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- Trigram similarity for FTS
CREATE EXTENSION IF NOT EXISTS "btree_gin";  -- GIN indexes on btree-able types
