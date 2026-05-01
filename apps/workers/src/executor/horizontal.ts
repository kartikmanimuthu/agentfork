import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { createLogger } from '../lib/logger.js';
import type { JobExecutor } from './types.js';

const log = createLogger('horizontal-executor');

export class HorizontalExecutor implements JobExecutor {
  private readonly ecs = new ECSClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

  async execute(jobName: string, jobData: unknown): Promise<unknown> {
    log.info('Dispatching job to ECS Fargate', { jobName });

    const command = new RunTaskCommand({
      cluster: process.env.ECS_CLUSTER_ARN,
      taskDefinition: process.env.WORKER_TASK_DEFINITION_ARN,
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: (process.env.PRIVATE_SUBNET_IDS ?? '').split(','),
          securityGroups: (process.env.SECURITY_GROUP_IDS ?? '').split(','),
          assignPublicIp: 'DISABLED',
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: 'worker',
            environment: [
              { name: 'JOB_NAME', value: jobName },
              { name: 'JOB_DATA', value: JSON.stringify(jobData) },
            ],
          },
        ],
      },
    });

    const result = await this.ecs.send(command);
    log.info('ECS task dispatched', { taskArn: result.tasks?.[0]?.taskArn });
    return result;
  }
}
