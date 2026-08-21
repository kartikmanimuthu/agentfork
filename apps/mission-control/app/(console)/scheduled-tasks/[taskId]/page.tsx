import { TaskDetailClient } from '@/components/scheduled-tasks/task-detail-client';

export default async function ScheduledTaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 pt-6 md:p-8">
      <TaskDetailClient taskId={taskId} />
    </div>
  );
}
