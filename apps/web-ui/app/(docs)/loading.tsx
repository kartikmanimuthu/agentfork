import { Skeleton } from '@/components/ui/skeleton';

export default function DocsLoading() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r p-4 space-y-3 hidden md:block">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </aside>
      <main className="flex-1 p-8 space-y-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-32 w-full" />
      </main>
    </div>
  );
}
