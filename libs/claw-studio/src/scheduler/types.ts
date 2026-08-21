export type ScheduleType = 'cron' | 'interval' | 'once';
export type TaskStatus = 'active' | 'paused' | 'completed' | 'deleted';
export type ApprovalMode = 'ask' | 'allowlist' | 'all';
export type SessionMode = 'isolated' | 'main';

export type DeliveryChannel = 'slack' | 'telegram' | 'discord' | 'jira' | 'email' | 'none';

export interface TaskDelivery {
  type: DeliveryChannel;
  /** Channel id, chat id, issue key, or email address — per channel. */
  target?: string;
}

/** The minimal projection the sweeper needs to decide what is due. */
export interface ActiveTaskRow {
  taskId: string;
  tenantId: string;
  scheduleType: string;
  cronExpression: string;
  intervalMinutes: number | null;
  runAt: Date | null;
  timezone: string;
  nextRunAt: Date | null;
}

export interface ScheduledTaskRecord {
  id: string;
  tenantId: string;
  clawId: string;
  taskId: string;
  name: string;
  prompt: string;
  scheduleType: ScheduleType;
  cronExpression: string;
  intervalMinutes: number | null;
  runAt: Date | null;
  timezone: string;
  status: TaskStatus;
  approvalMode: ApprovalMode;
  allowedTools: string[];
  sessionMode: SessionMode;
  maxIterations: number | null;
  providerModelId: string | null;
  delivery: TaskDelivery;
  lastRunId: string | null;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  nextRunAt: Date | null;
  runCount: number;
  failureStreak: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}
