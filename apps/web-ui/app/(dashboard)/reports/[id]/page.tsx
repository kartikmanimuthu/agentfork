'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ReportEditor } from '@/components/reports/report-editor';
import type { ReportDTO } from '@/lib/reports/types';

export default function EditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['report', id],
    queryFn: async (): Promise<{ report: ReportDTO }> => {
      const res = await fetch(`/api/reports/${id}`);
      if (!res.ok) throw new Error('Failed to load report');
      return res.json();
    },
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading report…</div>;
  }
  if (isError || !data?.report) {
    return <div className="p-6 text-sm text-destructive">Report not found.</div>;
  }

  return <ReportEditor reportId={id} initial={data.report} />;
}
