export type HandlerFn = (jobData: unknown) => Promise<unknown>;

export interface JobExecutor {
  execute(jobName: string, jobData: unknown): Promise<unknown>;
  registerHandler?(jobName: string, handler: HandlerFn): void;
}
