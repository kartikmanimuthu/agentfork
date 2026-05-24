-- Re-add embedding column to document_chunks that was dropped in 20260507063909_agent_kb_alias_integration
-- The Prisma schema declares vector(1024) but the column was removed; this restores it.

ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "embedding" vector(1024);

-- Restore HNSW index for cosine similarity search
CREATE INDEX IF NOT EXISTS "idx_document_chunks_embedding"
  ON "document_chunks" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
