import { useQuery } from '@tanstack/react-query';

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  status: string;
  documentCount: number;
  chunkCount: number;
}

interface KnowledgeBaseListResponse {
  items: KnowledgeBase[];
  total: number;
}

async function fetchKnowledgeBases(): Promise<KnowledgeBaseListResponse> {
  const res = await fetch('/api/knowledge-bases?limit=100');
  if (!res.ok) throw new Error('Failed to fetch knowledge bases');
  return res.json();
}

export const knowledgeBaseKeys = {
  all: () => ['knowledge-bases'] as const,
};

export function useKnowledgeBases() {
  return useQuery({
    queryKey: knowledgeBaseKeys.all(),
    queryFn: () => fetchKnowledgeBases(),
  });
}
