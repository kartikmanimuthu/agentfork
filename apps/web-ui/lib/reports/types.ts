import type { ReportVizType, VizConfig, ReportResult, ReportTableSchema } from '@chatbot/shared/client';

export type VizType = ReportVizType;
export type { VizConfig, ReportResult, ReportTableSchema };

export interface ReportListItem {
  id: string;
  name: string;
  description?: string | null;
  vizType: VizType;
  updatedAt: string;
  createdById: string;
}

export interface ReportDTO {
  id: string;
  name: string;
  description?: string | null;
  sqlText: string;
  vizType: VizType;
  vizConfig: VizConfig;
}
