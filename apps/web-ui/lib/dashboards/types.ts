import type { WidgetQuerySpec, VizType, SourceMeta, QueryResultRow } from '@chatbot/shared';

export type { WidgetQuerySpec, VizType, SourceMeta, QueryResultRow };

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WidgetDTO {
  id: string;
  title: string;
  vizType: VizType;
  querySpec: WidgetQuerySpec;
  layout: WidgetLayout;
}

export interface DashboardListItem {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  updatedAt: string;
}

export interface DashboardDTO extends Omit<DashboardListItem, 'updatedAt'> {
  widgets: WidgetDTO[];
}
