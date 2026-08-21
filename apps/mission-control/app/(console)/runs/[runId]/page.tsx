import { RunDetailClient } from '@/components/runs/run-detail-client';

export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 pt-6 md:p-8">
      <RunDetailClient runId={runId} />
    </div>
  );
}
