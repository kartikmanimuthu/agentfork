import { Spinner } from '@/components/ui/spinner';

/**
 * Covers every dashboard route via App Router's nearest-ancestor rule.
 *
 * A bare spinner is deliberate: this boundary sits above pages of very different
 * shapes (lists, single-column forms, the chat console), and a list-shaped
 * skeleton would mispredict most of them — a placeholder that doesn't match what
 * replaces it reads as a layout jump, which is worse than a neutral spinner.
 *
 * The status role and label are the part that was missing: without them a screen
 * reader announced nothing during navigation and the page simply appeared empty.
 */
export default function DashboardLoading() {
  return (
    <div className="flex flex-1 items-center justify-center" role="status" aria-live="polite">
      <Spinner className="size-8" aria-hidden="true" />
      <span className="sr-only">Loading page…</span>
    </div>
  );
}
