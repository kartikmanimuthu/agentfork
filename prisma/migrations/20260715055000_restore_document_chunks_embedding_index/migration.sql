-- Restore HNSW index for cosine similarity search on document_chunks.embedding.
-- The 20260715054818_add_claw_studio migration's diff silently dropped this raw-SQL
-- index (Prisma cannot model HNSW indexes on Unsupported("vector(...)") columns, so its
-- diff engine has no knowledge of it — same root cause as
-- 20260524000000_readd_document_chunks_embedding and
-- 20260608080000_restore_document_chunks_embedding_index).
CREATE INDEX IF NOT EXISTS "idx_document_chunks_embedding"
  ON "document_chunks" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
