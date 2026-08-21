import { RunsClient } from '@/components/runs/runs-client';

export default function RunsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 pt-6 md:p-8">
      <RunsClient />
    </div>
  );
}
