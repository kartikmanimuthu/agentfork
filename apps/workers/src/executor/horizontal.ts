import { ECSClient, RunTaskCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { createLogger } from '../lib/logger.js';
import { env } from '../env';
import type { JobExecutor } from './types.js';

const log = createLogger('horizontal-executor');

const INITIAL_POLL_INTERVAL_MS = 2000;
const MAX_POLL_INTERVAL_MS = 30000;
const DEFAULT_TIMEOUT_MS = 900000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HorizontalExecutor implements JobExecutor {
  private readonly ecs = new ECSClient({ region: env.AWS_REGION });

  async execute(jobName: string, jobData: unknown): Promise<unknown> {
    const subnets = (env.PRIVATE_SUBNET_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const securityGroups = (env.SECURITY_GROUP_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

    log.info('Dispatching job to ECS Fargate', { jobName });

    const runResult = await this.ecs.send(
      new RunTaskCommand({
        cluster: env.ECS_CLUSTER_ARN,
        taskDefinition: env.WORKER_TASK_DEFINITION_ARN,
        launchType: 'FARGATE',
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets,
            securityGroups,
            assignPublicIp: 'DISABLED',
          },
        },
        overrides: {
          containerOverrides: [
            {
              name: 'WorkersContainer',
              command: [
                'bun',
                'run',
                'dist/job-runner.js',
                '--job',
                jobName,
                '--data',
                JSON.stringify(jobData),
              ],
            },
          ],
        },
      })
    );

    if (runResult.failures && runResult.failures.length > 0) {
      const reason = runResult.failures.map((f) => f.reason ?? 'unknown').join(', ');
      throw new Error(`ECS RunTask failed: ${reason}`);
    }

    if (!runResult.tasks || runResult.tasks.length === 0) {
      throw new Error('ECS RunTask returned no tasks');
    }

    const taskArn = runResult.tasks[0].taskArn!;
    log.info('ECS task launched', { jobName, taskArn });

    // Poll until STOPPED with exponential backoff
    const startTime = Date.now();
    let pollInterval = INITIAL_POLL_INTERVAL_MS;

    while (true) {
      await sleep(pollInterval);

      if (Date.now() - startTime > DEFAULT_TIMEOUT_MS) {
        throw new Error(`HorizontalExecutor timed out waiting for task ${taskArn} after ${DEFAULT_TIMEOUT_MS}ms`);
      }

      const describeResult = await this.ecs.send(
        new DescribeTasksCommand({ cluster: env.ECS_CLUSTER_ARN, tasks: [taskArn] })
      );

      const task = describeResult.tasks?.[0];
      if (!task) continue;

      if (task.lastStatus === 'STOPPED') {
        const exitCode = task.containers?.[0]?.exitCode;
        if (exitCode === 0) {
          log.info('ECS task completed successfully', { jobName, taskArn });
          return;
        }
        const stoppedReason = (task as { stoppedReason?: string }).stoppedReason ?? 'unknown';
        throw new Error(`ECS task ${taskArn} exited with code ${exitCode} (reason: ${stoppedReason})`);
      }

      pollInterval = Math.min(pollInterval * 2, MAX_POLL_INTERVAL_MS);
    }
  }
}
