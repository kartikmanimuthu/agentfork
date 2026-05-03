import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { createLogger } from '../lib/logger.js';
import { env } from '../env';
import type { JobExecutor } from './types.js';

const log = createLogger('horizontal-executor');

export class HorizontalExecutor implements JobExecutor {
  private readonly ecs = new ECSClient({ region: env.AWS_REGION });

  async execute(jobName: string, jobData: unknown): Promise<unknown> {
    log.info('Dispatching job to ECS Fargate', { jobName });

    const command = new RunTaskCommand({
      cluster: env.ECS_CLUSTER_ARN,
      taskDefinition: env.WORKER_TASK_DEFINITION_ARN,
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: (env.PRIVATE_SUBNET_IDS ?? '').split(','),
          securityGroups: (env.SECURITY_GROUP_IDS ?? '').split(','),
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
