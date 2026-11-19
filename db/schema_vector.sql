-- Optional: semantic search / topic embeddings (requires the pgvector extension).
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE transcript_segments ADD COLUMN IF NOT EXISTS embedding vector(1024);
CREATE INDEX IF NOT EXISTS transcript_segments_embedding ON transcript_segments USING hnsw (embedding vector_cosine_ops);
