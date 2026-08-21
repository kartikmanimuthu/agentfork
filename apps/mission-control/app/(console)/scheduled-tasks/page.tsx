import { ScheduledTasksClient } from '@/components/scheduled-tasks/scheduled-tasks-client';

export default function ScheduledTasksPage() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 pt-6 md:p-8">
      <ScheduledTasksClient />
    </div>
  );
}
