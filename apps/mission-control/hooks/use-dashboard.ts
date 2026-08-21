import { useQuery } from '@tanstack/react-query';
import type { DashboardPayload, DashboardRange } from '@chatbot/claw-studio';
import { BASE_PATH } from '@/lib/base-path';

async function fetchDashboard(range: DashboardRange): Promise<DashboardPayload> {
  const res = await fetch(`${BASE_PATH}/api/dashboard?range=${range}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    throw new Error(body?.error ?? 'Failed to load dashboard');
  }
  return body.data as DashboardPayload;
}

export const dashboardKeys = {
  all: ['dashboard'] as const,
  range: (range: DashboardRange) => [...dashboardKeys.all, range] as const,
};

export function useDashboard(range: DashboardRange) {
  return useQuery({
    queryKey: dashboardKeys.range(range),
    queryFn: () => fetchDashboard(range),
    // Manual refresh only — the design doc rejects polling for v1 rather than
    // claiming "real-time" over a page that never refetches.
    refetchOnWindowFocus: false,
  });
}

export type { DashboardPayload, DashboardRange };
