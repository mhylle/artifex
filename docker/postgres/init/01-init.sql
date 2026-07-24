-- Runs once on first Postgres init (docker-entrypoint-initdb.d).
-- The Memory Fabric uses pgvector for the Knowledge Commons' semantic retrieval
-- (ADR-0001). Enable the extension so it is present from a clean bootstrap.
CREATE EXTENSION IF NOT EXISTS vector;
