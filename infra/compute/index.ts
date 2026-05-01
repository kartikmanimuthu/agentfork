import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as random from '@pulumi/random';

const callerIdentity = aws.getCallerIdentityOutput({});
const accountId = callerIdentity.accountId;
const region = aws.config.region ?? 'ap-south-1';

const config = new pulumi.Config();
const appUrl = config.get('appUrl') ?? 'https://placeholder.cloudfront.net';
const appName = 'chatbot';

const networking = new pulumi.StackReference(`organization/${appName}-networking/prod`);
const vpcId = networking.requireOutput('vpcId') as pulumi.Output<string>;
const vpcCidr = networking.requireOutput('vpcCidr') as pulumi.Output<string>;
const privateSubnetIds = networking.requireOutput('privateSubnetIds') as pulumi.Output<string[]>;
const publicSubnetIds = networking.requireOutput('publicSubnetIds') as pulumi.Output<string[]>;
const databaseSubnetIds = networking.requireOutput('databaseSubnetIds') as pulumi.Output<string[]>;
const dbSubnetGroupName = networking.requireOutput('dbSubnetGroupName') as pulumi.Output<string>;

// ── Secrets ──
const nextauthSecretRandom = new random.RandomPassword('nextauth-secret-random', {
  length: 32,
  special: false,
  keepers: { version: '1' },
});

const dbPasswordRandom = new random.RandomPassword('db-password-random', {
  length: 24,
  special: false,
  keepers: { version: '1' },
});

const nextauthSecretSm = new aws.secretsmanager.Secret('nextauth-secret', {
  name: `${appName}/nextauth-secret`,
  description: 'NextAuth.js secret for JWT signing',
  recoveryWindowInDays: 0,
});

new aws.secretsmanager.SecretVersion('nextauth-secret-version', {
  secretId: nextauthSecretSm.id,
  secretString: nextauthSecretRandom.result,
});

const databaseUrlSm = new aws.secretsmanager.Secret('database-url', {
  name: `${appName}/database-url`,
  description: 'Full PostgreSQL connection string for ECS tasks',
  recoveryWindowInDays: 0,
});

// ── RDS ──
const dbSecurityGroup = new aws.ec2.SecurityGroup(`${appName}-db-sg`, {
  vpcId,
  description: 'Security group for RDS PostgreSQL',
  ingress: [
    {
      protocol: 'tcp',
      fromPort: 5432,
      toPort: 5432,
      cidrBlocks: [vpcCidr],
    },
  ],
  egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
  tags: { Name: `${appName}-db-sg` },
});

const postgresInstance = new aws.rds.Instance(`${appName}-postgres`, {
  identifier: `${appName}-postgres`,
  engine: 'postgres',
  engineVersion: '16.6',
  instanceClass: 'db.t4g.micro',
  allocatedStorage: 20,
  storageType: 'gp3',
  dbName: 'chatbot',
  username: 'chatbot_admin',
  password: dbPasswordRandom.result,
  dbSubnetGroupName,
  vpcSecurityGroupIds: [dbSecurityGroup.id],
  publiclyAccessible: false,
  skipFinalSnapshot: true,
  backupRetentionPeriod: 7,
  tags: { Name: `${appName}-postgres` },
});

new aws.secretsmanager.SecretVersion('database-url-version', {
  secretId: databaseUrlSm.id,
  secretString: pulumi.interpolate`postgresql://chatbot_admin:${dbPasswordRandom.result}@${postgresInstance.address}:5432/chatbot?sslmode=require&sslrootcert=/etc/ssl/certs/rds-combined-ca-bundle.pem`,
});

// ── Cognito ──
const userPool = new aws.cognito.UserPool(`${appName}-user-pool`, {
  name: `${appName}-user-pool`,
  autoVerifiedAttributes: ['email'],
  usernameAttributes: ['email'],
  usernameConfiguration: { caseSensitive: false },
  passwordPolicy: {
    minimumLength: 8,
    requireNumbers: true,
    requireLowercase: true,
    requireSymbols: false,
    requireUppercase: false,
  },
  accountRecoverySetting: {
    recoveryMechanisms: [{ name: 'verified_email', priority: 1 }],
  },
});

const userPoolDomain = new aws.cognito.UserPoolDomain(`${appName}-user-pool-domain`, {
  userPoolId: userPool.id,
  domain: pulumi.interpolate`${appName}-auth-${accountId}`,
});

const userPoolClient = new aws.cognito.UserPoolClient(`${appName}-user-pool-client`, {
  name: `${appName}-app-client`,
  userPoolId: userPool.id,
  generateSecret: true,
  explicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
  allowedOauthFlows: ['code'],
  allowedOauthFlowsUserPoolClient: true,
  allowedOauthScopes: ['openid', 'email', 'profile'],
  callbackUrls: [
    'http://localhost:3001/api/auth/callback/cognito',
    `${appUrl}/api/auth/callback/cognito`,
  ],
  logoutUrls: ['http://localhost:3001', appUrl],
});

// ── S3 ──
const appBucket = new aws.s3.BucketV2(`${appName}-bucket`, {
  bucket: pulumi.interpolate`${appName}-${accountId}-${region}`,
  forceDestroy: false,
});

new aws.s3.BucketLifecycleConfigurationV2(`${appName}-bucket-lifecycle`, {
  bucket: appBucket.id,
  rules: [
    {
      id: 'conversation-exports-expire-7d',
      status: 'Enabled',
      filter: { prefix: 'conversation-exports/' },
      expiration: { days: 7 },
    },
    {
      id: 'temp-expire-1d',
      status: 'Enabled',
      filter: { prefix: 'temp/' },
      expiration: { days: 1 },
    },
  ],
});

// ── ECR ──
const webUiRepo = new aws.ecr.Repository(`${appName}-web-ui`, {
  name: `${appName}/web-ui`,
  imageTagMutability: 'MUTABLE',
  imageScanningConfiguration: { scanOnPush: true },
});

const workersRepo = new aws.ecr.Repository(`${appName}-workers`, {
  name: `${appName}/workers`,
  imageTagMutability: 'MUTABLE',
  imageScanningConfiguration: { scanOnPush: true },
});

// ── ECS Cluster ──
const cluster = new aws.ecs.Cluster(`${appName}-cluster`, {
  name: `${appName}-cluster`,
  settings: [{ name: 'containerInsights', value: 'enabled' }],
});

// ── ALB ──
const albSecurityGroup = new aws.ec2.SecurityGroup(`${appName}-alb-sg`, {
  vpcId,
  description: 'Security group for ALB',
  ingress: [{ protocol: 'tcp', fromPort: 80, toPort: 80, cidrBlocks: ['0.0.0.0/0'] }],
  egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
  tags: { Name: `${appName}-alb-sg` },
});

const alb = new aws.lb.LoadBalancer(`${appName}-alb`, {
  name: `${appName}-alb`,
  internal: false,
  loadBalancerType: 'application',
  securityGroups: [albSecurityGroup.id],
  subnets: publicSubnetIds,
  tags: { Name: `${appName}-alb` },
});

const targetGroup = new aws.lb.TargetGroup(`${appName}-web-ui-tg`, {
  name: `${appName}-web-ui-tg`,
  port: 3001,
  protocol: 'HTTP',
  targetType: 'ip',
  vpcId,
  healthCheck: {
    path: '/api/health',
    interval: 30,
    timeout: 5,
    healthyThreshold: 2,
    unhealthyThreshold: 3,
  },
});

new aws.lb.Listener(`${appName}-alb-listener`, {
  loadBalancerArn: alb.arn,
  port: 80,
  protocol: 'HTTP',
  defaultActions: [{ type: 'forward', targetGroupArn: targetGroup.arn }],
});

// ── IAM Roles ──
const taskExecutionRole = new aws.iam.Role(`${appName}-task-execution-role`, {
  name: `${appName}-task-execution-role`,
  assumeRolePolicy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Service: 'ecs-tasks.amazonaws.com' },
        Action: 'sts:AssumeRole',
      },
    ],
  }),
  managedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'],
});

new aws.iam.RolePolicy(`${appName}-task-execution-secrets`, {
  role: taskExecutionRole.id,
  policy: pulumi.all([nextauthSecretSm.arn, databaseUrlSm.arn]).apply(([nsArn, dbArn]) =>
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['secretsmanager:GetSecretValue'],
          Resource: [nsArn, dbArn],
        },
      ],
    }),
  ),
});

const taskRole = new aws.iam.Role(`${appName}-task-role`, {
  name: `${appName}-task-role`,
  assumeRolePolicy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Service: 'ecs-tasks.amazonaws.com' },
        Action: 'sts:AssumeRole',
      },
    ],
  }),
});

new aws.iam.RolePolicy(`${appName}-task-policy`, {
  role: taskRole.id,
  policy: appBucket.arn.apply((bucketArn) =>
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
          Resource: [bucketArn, `${bucketArn}/*`],
        },
        {
          Effect: 'Allow',
          Action: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          Resource: ['*'],
        },
      ],
    }),
  ),
});

// ── CloudWatch Log Groups ──
const webUiLogGroup = new aws.cloudwatch.LogGroup(`${appName}-web-ui-logs`, {
  name: `/ecs/${appName}/web-ui`,
  retentionInDays: 7,
});

const workersLogGroup = new aws.cloudwatch.LogGroup(`${appName}-workers-logs`, {
  name: `/ecs/${appName}/workers`,
  retentionInDays: 7,
});

// ── ECS Task Definitions ──
const ecsSecurityGroup = new aws.ec2.SecurityGroup(`${appName}-ecs-sg`, {
  vpcId,
  description: 'Security group for ECS tasks',
  ingress: [{ protocol: 'tcp', fromPort: 3001, toPort: 3001, securityGroups: [albSecurityGroup.id] }],
  egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
  tags: { Name: `${appName}-ecs-sg` },
});

const webUiTaskDef = new aws.ecs.TaskDefinition(`${appName}-web-ui-task`, {
  family: `${appName}-web-ui`,
  networkMode: 'awsvpc',
  requiresCompatibilities: ['FARGATE'],
  cpu: '256',
  memory: '512',
  executionRoleArn: taskExecutionRole.arn,
  taskRoleArn: taskRole.arn,
  runtimePlatform: { cpuArchitecture: 'ARM64', operatingSystemFamily: 'LINUX' },
  containerDefinitions: pulumi
    .all([webUiRepo.repositoryUrl, nextauthSecretSm.arn, databaseUrlSm.arn, webUiLogGroup.name])
    .apply(([repoUrl, nsArn, dbArn, logGroup]) =>
      JSON.stringify([
        {
          name: 'web-ui',
          image: `${repoUrl}:latest`,
          essential: true,
          portMappings: [{ containerPort: 3001, protocol: 'tcp' }],
          secrets: [
            { name: 'NEXTAUTH_SECRET', valueFrom: nsArn },
            { name: 'DATABASE_URL', valueFrom: dbArn },
          ],
          environment: [
            { name: 'NEXTAUTH_URL', value: appUrl },
            { name: 'AWS_REGION', value: region },
          ],
          logConfiguration: {
            logDriver: 'awslogs',
            options: { 'awslogs-group': logGroup, 'awslogs-region': region, 'awslogs-stream-prefix': 'ecs' },
          },
        },
      ]),
    ),
});

const workersTaskDef = new aws.ecs.TaskDefinition(`${appName}-workers-task`, {
  family: `${appName}-workers`,
  networkMode: 'awsvpc',
  requiresCompatibilities: ['FARGATE'],
  cpu: '256',
  memory: '512',
  executionRoleArn: taskExecutionRole.arn,
  taskRoleArn: taskRole.arn,
  runtimePlatform: { cpuArchitecture: 'ARM64', operatingSystemFamily: 'LINUX' },
  containerDefinitions: pulumi
    .all([workersRepo.repositoryUrl, databaseUrlSm.arn, workersLogGroup.name])
    .apply(([repoUrl, dbArn, logGroup]) =>
      JSON.stringify([
        {
          name: 'worker',
          image: `${repoUrl}:latest`,
          essential: true,
          secrets: [{ name: 'DATABASE_URL', valueFrom: dbArn }],
          environment: [
            { name: 'AWS_REGION', value: region },
            { name: 'WORKER_ARCH', value: 'vertical' },
          ],
          logConfiguration: {
            logDriver: 'awslogs',
            options: { 'awslogs-group': logGroup, 'awslogs-region': region, 'awslogs-stream-prefix': 'ecs' },
          },
        },
      ]),
    ),
});

// ── ECS Services ──
const webUiService = new aws.ecs.Service(`${appName}-web-ui-service`, {
  name: `${appName}-web-ui`,
  cluster: cluster.arn,
  taskDefinition: webUiTaskDef.arn,
  desiredCount: 1,
  launchType: 'FARGATE',
  networkConfiguration: {
    subnets: privateSubnetIds,
    securityGroups: [ecsSecurityGroup.id],
    assignPublicIp: false,
  },
  loadBalancers: [
    {
      targetGroupArn: targetGroup.arn,
      containerName: 'web-ui',
      containerPort: 3001,
    },
  ],
});

const workersService = new aws.ecs.Service(`${appName}-workers-service`, {
  name: `${appName}-workers`,
  cluster: cluster.arn,
  taskDefinition: workersTaskDef.arn,
  desiredCount: 1,
  launchType: 'FARGATE',
  networkConfiguration: {
    subnets: privateSubnetIds,
    securityGroups: [ecsSecurityGroup.id],
    assignPublicIp: false,
  },
});

// ── Auto Scaling ──
const webUiScalingTarget = new aws.appautoscaling.Target(`${appName}-web-ui-scaling-target`, {
  maxCapacity: 4,
  minCapacity: 1,
  resourceId: pulumi.interpolate`service/${cluster.name}/${webUiService.name}`,
  scalableDimension: 'ecs:service:DesiredCount',
  serviceNamespace: 'ecs',
});

new aws.appautoscaling.Policy(`${appName}-web-ui-cpu-scaling`, {
  name: `${appName}-web-ui-cpu-scaling`,
  policyType: 'TargetTrackingScaling',
  resourceId: webUiScalingTarget.resourceId,
  scalableDimension: webUiScalingTarget.scalableDimension,
  serviceNamespace: webUiScalingTarget.serviceNamespace,
  targetTrackingScalingPolicyConfiguration: {
    predefinedMetricSpecification: { predefinedMetricType: 'ECSServiceAverageCPUUtilization' },
    targetValue: 70,
  },
});

// ── Exports ──
export const rdsEndpoint = postgresInstance.address;
export const albDnsName = alb.dnsName;
export const ecsClusterName = cluster.name;
export const webUiRepoUrl = webUiRepo.repositoryUrl;
export const workersRepoUrl = workersRepo.repositoryUrl;
export const cognitoUserPoolId = userPool.id;
export const cognitoClientId = userPoolClient.id;
export const s3BucketName = appBucket.bucket;
