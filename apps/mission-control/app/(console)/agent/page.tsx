import { WorkspaceFilesClient } from '@/components/agent/workspace-files-client';

export default function AgentPage() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 pt-6 md:p-8">
      <WorkspaceFilesClient />
    </div>
  );
}
