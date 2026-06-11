import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as command from "@pulumi/command";
import * as random from "@pulumi/random";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// Hash a source directory recursively — used as a trigger so build commands
// only re-run when source files actually change.
function hashDirectory(dir: string): string {
    const hash = crypto.createHash("sha256");
    function walk(d: string) {
        if (!fs.existsSync(d)) return;
        const entries = fs.readdirSync(d, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
                if (["node_modules", "dist", ".next"].includes(entry.name)) continue;
                walk(full);
            } else {
                hash.update(entry.name);
                hash.update(fs.readFileSync(full));
            }
        }
    }
    walk(dir);
    return hash.digest("hex");
}

const repoRoot = path.resolve(__dirname, "../..");

// Account ID + region for resource name suffixes
const callerIdentity = aws.getCallerIdentityOutput({});
const accountId = callerIdentity.accountId;
const region = aws.config.region ?? "us-east-1";

// Pulumi config
const config = new pulumi.Config();
const appUrl = config.get("appUrl") ?? "https://placeholder.cloudfront.net";
const subscriptionEmails = config.get("subscriptionEmails") ?? "";
const appName = config.get("appName") ?? "chatbot";
// Bedrock API key (bearer token) for the bedrock-mantle OpenAI-compatible gateway —
// set via `pulumi config set --secret bedrockBearerToken <value>`. Optional: only
// needed for models routed through bedrock-mantle (e.g. moonshotai.*, deepseek.*) when tools are attached.
const bedrockBearerToken = config.getSecret("bedrockBearerToken");
// Postgres identifiers (dbName, username) only allow letters, numbers, underscores
const dbIdentifier = appName.replace(/-/g, "_");

// Dynamically generated — stored in AWS Secrets Manager, never in Pulumi config
const nextauthSecretRandom = new random.RandomPassword("nextauth-secret-random", {
    length: 32,
    special: false,
    keepers: { version: "1" },
});

const dbPasswordRandom = new random.RandomPassword("db-password-random", {
    length: 24,
    special: false,
    keepers: { version: "1" },
});

const encryptionKeyBytes = new random.RandomId("encryption-key-bytes", {
    byteLength: 32,
    keepers: { version: "1" },
});

const nextauthSecretSm = new aws.secretsmanager.Secret("nextauth-secret", {
    name: `${appName}/nextauth-secret`,
    description: "NextAuth.js secret for JWT signing",
    recoveryWindowInDays: 0,
});

new aws.secretsmanager.SecretVersion("nextauth-secret-version", {
    secretId: nextauthSecretSm.id,
    secretString: nextauthSecretRandom.result,
});

const encryptionKeySm = new aws.secretsmanager.Secret("encryption-key", {
    name: `${appName}/encryption-key`,
    description: "AES-256-GCM encryption key for data at rest (64-char hex)",
    recoveryWindowInDays: 0,
});

new aws.secretsmanager.SecretVersion("encryption-key-version", {
    secretId: encryptionKeySm.id,
    secretString: encryptionKeyBytes.hex,
});

const databaseUrlSm = new aws.secretsmanager.Secret("database-url", {
    name: `${appName}/database-url`,
    description: "Full PostgreSQL connection string for ECS tasks",
    recoveryWindowInDays: 0,
});

// Bedrock bearer token — only created if `bedrockBearerToken` config is set
let bedrockBearerTokenSm: aws.secretsmanager.Secret | undefined;
if (bedrockBearerToken) {
    bedrockBearerTokenSm = new aws.secretsmanager.Secret("bedrock-bearer-token", {
        name: `${appName}/bedrock-bearer-token`,
        description: "Bedrock API key (bearer token) for the bedrock-mantle gateway",
        recoveryWindowInDays: 0,
    });

    new aws.secretsmanager.SecretVersion("bedrock-bearer-token-version", {
        secretId: bedrockBearerTokenSm.id,
        secretString: bedrockBearerToken,
    });
}

// database-url-version is created after postgresInstance (needs .address output)

const nextauthSecret = nextauthSecretRandom.result;
const dbPassword = dbPasswordRandom.result;

// Phase 7+: Networking stack is deployed — use requireOutput() to enforce dependency.
// requireOutput() throws at preview time if networking stack is not deployed,
// preventing silent undefined values from propagating into compute resources.

// StackReference to networking project.
// Format for S3 backend: "organization/<project>/<stack>" (literal "organization" required)
const currentStack = pulumi.getStack();
const networking = new pulumi.StackReference(`organization/chatbot-networking/${currentStack}`);

// Networking outputs — all required (networking must be deployed before compute can preview)
const vpcId = networking.requireOutput("vpcId") as pulumi.Output<string>;
const vpcCidr = networking.requireOutput("vpcCidr") as pulumi.Output<string>;
const privateSubnetIds = networking.requireOutput("privateSubnetIds") as pulumi.Output<string[]>;
const publicSubnetIds = networking.requireOutput("publicSubnetIds") as pulumi.Output<string[]>;
const databaseSubnetIds = networking.requireOutput("databaseSubnetIds") as pulumi.Output<string[]>;
const intraSubnetIds = networking.requireOutput("intraSubnetIds") as pulumi.Output<string[]>;
const availabilityZones = networking.requireOutput("availabilityZones") as pulumi.Output<string[]>;
const dbSubnetGroupName = networking.requireOutput("dbSubnetGroupName") as pulumi.Output<string>;

// ============================================================================
// S3 BUCKETS
// ============================================================================

const appBucket = new aws.s3.BucketV2("app-bucket", {
    bucket: pulumi.interpolate`${appName}-${accountId}-${region}`,
    forceDestroy: false,
}, { retainOnDelete: true });

new aws.s3.BucketLifecycleConfigurationV2("app-bucket-lifecycle", {
    bucket: appBucket.id,
    rules: [
        {
            id: "conversation-exports-expire-7d",
            status: "Enabled",
            filter: { prefix: "conversation-exports/" },
            expiration: { days: 7 },
        },
        {
            id: "temp-expire-1d",
            status: "Enabled",
            filter: { prefix: "temp/" },
            expiration: { days: 1 },
        },
        {
            id: "agent-temp-expire-1d",
            status: "Enabled",
            filter: { prefix: "agent-temp/" },
            expiration: { days: 1 },
        },
    ],
});


// ============================================================================
// COGNITO AUTHENTICATION
// ============================================================================

// UserPool — self-signup enabled, email sign-in, case-insensitive
const userPool = new aws.cognito.UserPool("web-ui-user-pool", {
    name: `${appName}-user-pool`,
    autoVerifiedAttributes: ["email"],
    usernameAttributes: ["email"],
    usernameConfiguration: { caseSensitive: false },
    passwordPolicy: {
        minimumLength: 8,
        requireNumbers: true,
        requireLowercase: true,
        requireSymbols: false,
        requireUppercase: false,
        temporaryPasswordValidityDays: 7,
    },
    accountRecoverySetting: {
        recoveryMechanisms: [{ name: "verified_email", priority: 1 }],
    },
    schemas: [
        { name: "email", attributeDataType: "String", required: true, mutable: true },
        { name: "name", attributeDataType: "String", required: false, mutable: true },
        { name: "given_name", attributeDataType: "String", required: false, mutable: true },
        { name: "family_name", attributeDataType: "String", required: false, mutable: true },
    ],
});

// UserPoolDomain — hosted UI domain prefix
const userPoolDomain = new aws.cognito.UserPoolDomain("web-ui-user-pool-domain", {
    userPoolId: userPool.id,
    domain: pulumi.interpolate`${appName}-auth-${accountId}`,
});

// UserPoolClient — OAuth code grant, secret required for NextAuth
const userPoolClient = new aws.cognito.UserPoolClient("web-ui-user-pool-client", {
    name: `${appName}-app-client`,
    userPoolId: userPool.id,
    generateSecret: true,
    explicitAuthFlows: [
        "ALLOW_USER_PASSWORD_AUTH",
        "ALLOW_USER_SRP_AUTH",
        "ALLOW_REFRESH_TOKEN_AUTH",
    ],
    allowedOauthFlows: ["code"],
    allowedOauthFlowsUserPoolClient: true,
    allowedOauthScopes: ["openid", "email", "profile", "aws.cognito.signin.user.admin"],
    callbackUrls: [
        "http://localhost:3005/api/auth/callback/cognito",
        `${appUrl}/api/auth/callback/cognito`,
    ],
    logoutUrls: ["http://localhost:3005", appUrl],
    preventUserExistenceErrors: "ENABLED",
    enableTokenRevocation: true,
    accessTokenValidity: 1,
    idTokenValidity: 1,
    refreshTokenValidity: 30,
    tokenValidityUnits: {
        accessToken: "hours",
        idToken: "hours",
        refreshToken: "days",
    },
    supportedIdentityProviders: ["COGNITO"],
});

// IdentityPool — links UserPoolClient to federated identity
const identityPool = new aws.cognito.IdentityPool("web-ui-identity-pool", {
    identityPoolName: `${appName}-identity-pool`,
    allowUnauthenticatedIdentities: false,
    cognitoIdentityProviders: [{
        clientId: userPoolClient.id,
        providerName: userPool.endpoint,
    }],
});

// AuthenticatedRole — Cognito federated principal
const authenticatedRole = new aws.iam.Role("web-ui-authenticated-role", {
    name: `${appName}-authenticated-role`,
    assumeRolePolicy: identityPool.id.apply(poolId =>
        JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Principal: { Federated: "cognito-identity.amazonaws.com" },
                Action: "sts:AssumeRoleWithWebIdentity",
                Condition: {
                    StringEquals: { "cognito-identity.amazonaws.com:aud": poolId },
                    "ForAnyValue:StringLike": { "cognito-identity.amazonaws.com:amr": "authenticated" },
                },
            }],
        })
    ),
});

// Inline policy — cognito-sync + mobile analytics
new aws.iam.RolePolicy("web-ui-auth-cognito-sync-policy", {
    role: authenticatedRole.id,
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Action: ["mobileanalytics:PutEvents", "cognito-sync:*", "cognito-identity:*"],
            Resource: ["*"],
        }],
    }),
});


// Wire authenticated role to identity pool
new aws.cognito.IdentityPoolRoleAttachment("web-ui-identity-pool-role-attachment", {
    identityPoolId: identityPool.id,
    roles: { authenticated: authenticatedRole.arn },
});

// ============================================================================
// SNS TOPIC
// ============================================================================

const snsTopic = new aws.sns.Topic("scheduler-sns-topic", {
    name: `${appName}-sns-topic`,
});

// Email subscriptions from config (comma-separated, skip empty)
const emails = subscriptionEmails.split(",").map((e: string) => e.trim()).filter((e: string) => e.length > 0);
emails.forEach((email: string, i: number) => {
    new aws.sns.TopicSubscription(`sns-email-sub-${i}`, {
        topic: snsTopic.arn,
        protocol: "email",
        endpoint: email,
    });
});

// ============================================================================
// RDS POSTGRESQL
// ============================================================================

// RDS Security Group — allow port 5432 from within VPC (ECS tasks + Lambdas)
const rdsSecurityGroup = new aws.ec2.SecurityGroup("rds-sg", {
    name: `${appName}-rds-sg`,
    description: "Security group for RDS PostgreSQL - VPC internal access",
    vpcId: vpcId,
    ingress: [{
        fromPort: 5432,
        toPort: 5432,
        protocol: "tcp",
        cidrBlocks: [vpcCidr],
        description: "PostgreSQL from VPC (ECS tasks)",
    }],
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
        description: "Allow all outbound",
    }],
});

// RDS PostgreSQL instance — postgres 16, db.t4g.micro, 20 GB gp3
const postgresInstance = new aws.rds.Instance("postgres", {
    identifier: `${appName}-postgres`,
    engine: "postgres",
    engineVersion: "16.9",
    instanceClass: "db.t4g.micro",
    dbName: dbIdentifier,
    username: `${dbIdentifier}_admin`,
    password: dbPassword,
    dbSubnetGroupName: dbSubnetGroupName,
    vpcSecurityGroupIds: [rdsSecurityGroup.id],
    multiAz: false,
    allocatedStorage: 20,
    storageType: "gp3",
    skipFinalSnapshot: true,
    deletionProtection: false,
    tags: { Name: `${appName}-postgres` },
}, { retainOnDelete: false });

// Store full connection string in Secrets Manager (needs postgresInstance.address)
new aws.secretsmanager.SecretVersion("database-url-version", {
    secretId: databaseUrlSm.id,
    secretString: pulumi.interpolate`postgresql://${dbIdentifier}_admin:${dbPasswordRandom.result}@${postgresInstance.address}:5432/${dbIdentifier}?sslmode=require&uselibpqcompat=true`,
});



// ============================================================================
// BASTION HOST (SSM Session Manager — no SSH, private subnet only)
// ============================================================================

// IAM role — SSM managed instance core only, no SSH key needed
const bastionRole = new aws.iam.Role("bastion-role", {
    name: `${appName}-bastion-role`,
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Principal: { Service: "ec2.amazonaws.com" },
            Action: "sts:AssumeRole",
        }],
    }),
    tags: { Name: `${appName}-bastion-role` },
});

new aws.iam.RolePolicyAttachment("bastion-ssm-policy", {
    role: bastionRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
});

const bastionInstanceProfile = new aws.iam.InstanceProfile("bastion-instance-profile", {
    name: `${appName}-bastion-profile`,
    role: bastionRole.name,
});

// No inbound rules — SSM agent initiates outbound connections to SSM endpoints
const bastionSg = new aws.ec2.SecurityGroup("bastion-sg", {
    name: `${appName}-bastion-sg`,
    description: "Bastion - SSM only, no inbound SSH",
    vpcId: vpcId,
    egress: [
        {
            fromPort: 443,
            toPort: 443,
            protocol: "tcp",
            cidrBlocks: ["0.0.0.0/0"],
            description: "HTTPS to SSM endpoints (via NAT or VPC endpoints)",
        },
        {
            fromPort: 5432,
            toPort: 5432,
            protocol: "tcp",
            cidrBlocks: [vpcCidr],
            description: "PostgreSQL tunnel to RDS",
        },
    ],
    tags: { Name: `${appName}-bastion-sg` },
});

// Latest Amazon Linux 2023 ARM64 AMI (SSM agent pre-installed)
const bastionAmi = aws.ec2.getAmiOutput({
    mostRecent: true,
    owners: ["amazon"],
    filters: [
        { name: "name", values: ["al2023-ami-*-arm64"] },
        { name: "architecture", values: ["arm64"] },
        { name: "virtualization-type", values: ["hvm"] },
    ],
});

// t4g.nano in first private subnet — no public IP, reachable only via SSM
const bastionInstance = new aws.ec2.Instance("bastion", {
    ami: bastionAmi.id,
    instanceType: "t4g.nano",
    subnetId: privateSubnetIds.apply(ids => ids[0]),
    iamInstanceProfile: bastionInstanceProfile.name,
    vpcSecurityGroupIds: [bastionSg.id],
    associatePublicIpAddress: false,
    tags: { Name: `${appName}-bastion` },
});

export const bastionInstanceId = bastionInstance.id;

// ============================================================================
// ECS + ALB + CLOUDFRONT
// ============================================================================

// ECR Repository — WebUI container images
const ecrRepository = new aws.ecr.Repository("web-ui-ecr-repo", {
    name: `${appName}-web-ui`,
    imageTagMutability: "MUTABLE",
    forceDelete: false,
});

// ECR public login — authenticate Docker to public.ecr.aws before building
// images so base image pulls (e.g. public.ecr.aws/docker/library/node) succeed.
const ecrPublicLogin = new command.local.Command("ecr-public-login", {
    create: "aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws",
    environment: {
        BUILDX_NO_DEFAULT_ATTESTATIONS: "1",
    },
});

// Explicit source hash — combines apps/web-ui/ + prisma/ + libs/ so any change to either
// produces a new imageTag, forcing a Docker rebuild + new ECS task definition revision.
const webUiSrcHash = crypto.createHash("sha256")
    .update(hashDirectory(path.join(repoRoot, "apps/web-ui")))
    .update(hashDirectory(path.join(repoRoot, "apps/sdk")))
    .update(hashDirectory(path.join(repoRoot, "prisma")))
    .update(hashDirectory(path.join(repoRoot, "libs")))
    .digest("hex")
    .substring(0, 12);

// Build and push WebUI Docker image automatically on source change
const webUiImage = new awsx.ecr.Image("web-ui-image", {
    repositoryUrl: ecrRepository.repositoryUrl,
    context: repoRoot,
    dockerfile: path.join(repoRoot, "apps/web-ui/Dockerfile"),
    platform: "linux/arm64",
    imageTag: webUiSrcHash,
    args: {
        BUILDX_NO_DEFAULT_ATTESTATIONS: "1",
    },
    cacheFrom: [pulumi.interpolate`${ecrRepository.repositoryUrl}:latest`],
}, { dependsOn: [ecrPublicLogin], retainOnDelete: true });

// ECS Cluster
const ecsCluster = new aws.ecs.Cluster("web-ui-ecs-cluster", {
    name: `${appName}-ecs-cluster`,
    settings: [{ name: "containerInsights", value: "enabled" }],
});

// WebUI CloudWatch Log Group
const webUiLogGroup = new aws.cloudwatch.LogGroup("web-ui-log-group", {
    name: `/ecs/${appName}-web-ui`,
    retentionInDays: 7,
});

// ECS Task Execution Role — ECR pull + CloudWatch logs
const ecsTaskExecutionRole = new aws.iam.Role("ecs-task-execution-role", {
    name: `${appName}-ecs-execution-role`,
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Principal: { Service: "ecs-tasks.amazonaws.com" },
            Action: "sts:AssumeRole",
        }],
    }),
});

new aws.iam.RolePolicyAttachment("ecs-task-execution-role-policy", {
    role: ecsTaskExecutionRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
});

new aws.iam.RolePolicy("ecs-execution-role-secrets-policy", {
    role: ecsTaskExecutionRole.id,
    policy: pulumi.all([
        nextauthSecretSm.arn,
        databaseUrlSm.arn,
        encryptionKeySm.arn,
        bedrockBearerTokenSm ? bedrockBearerTokenSm.arn : pulumi.output(undefined),
    ]).apply(
        ([nextauthArn, dbArn, encArn, bedrockBearerArn]) =>
            JSON.stringify({
                Version: "2012-10-17",
                Statement: [{
                    Effect: "Allow",
                    Action: ["secretsmanager:GetSecretValue"],
                    Resource: [nextauthArn, dbArn, encArn, ...(bedrockBearerArn ? [bedrockBearerArn] : [])],
                }],
            })
    ),
});

// ECS Task Role — application permissions
const ecsTaskRole = new aws.iam.Role("ecs-task-role", {
    name: `${appName}-ecs-task-role`,
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Principal: { Service: "ecs-tasks.amazonaws.com" },
            Action: "sts:AssumeRole",
        }],
    }),
});


// S3 — read/write on unified app bucket
new aws.iam.RolePolicy("ecs-task-s3-policy", {
    role: ecsTaskRole.id,
    policy: appBucket.arn.apply(arn =>
        JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: [
                    "s3:GetObject", "s3:PutObject", "s3:DeleteObject",
                    "s3:ListBucket", "s3:GetBucketLocation",
                ],
                Resource: [arn, `${arn}/*`],
            }],
        })
    ),
});

// Bedrock — InvokeModel
new aws.iam.RolePolicy("ecs-task-bedrock-policy", {
    role: ecsTaskRole.id,
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:ListFoundationModels"],
            Resource: ["*"],
        }],
    }),
});

// Cognito IDP — user management (invitations, admin ops)
new aws.iam.RolePolicy("ecs-task-cognito-idp-policy", {
    role: ecsTaskRole.id,
    policy: userPool.arn.apply(poolArn =>
        JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: [
                    "cognito-idp:AdminCreateUser",
                    "cognito-idp:AdminDeleteUser",
                    "cognito-idp:AdminGetUser",
                    "cognito-idp:AdminUpdateUserAttributes",
                    "cognito-idp:AdminSetUserPassword",
                    "cognito-idp:AdminAddUserToGroup",
                    "cognito-idp:AdminRemoveUserFromGroup",
                    "cognito-idp:ListUsers",
                    "cognito-idp:ListGroups",
                ],
                Resource: [poolArn],
            }],
        })
    ),
});

// CloudWatch Logs
new aws.iam.RolePolicy("ecs-task-logs-policy", {
    role: ecsTaskRole.id,
    policy: webUiLogGroup.arn.apply(logArn =>
        JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
                Resource: [logArn, `${logArn}:*`],
            }],
        })
    ),
});

// WebUI Task Definition — ARM64, FARGATE, 1024 CPU / 2048 MiB
// retainOnDelete: true — Pulumi must NOT deactivate old task definition revisions on replace.
const webUiTaskDef = new aws.ecs.TaskDefinition("web-ui-task-def", {
    family: `${appName}-web-ui-task`,
    cpu: "1024",
    memory: "2048",
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    executionRoleArn: ecsTaskExecutionRole.arn,
    taskRoleArn: ecsTaskRole.arn,
    runtimePlatform: {
        cpuArchitecture: "ARM64",
        operatingSystemFamily: "LINUX",
    },
    containerDefinitions: pulumi.all([
        userPool.id,
        userPoolClient.id,
        userPoolClient.clientSecret,
        appBucket.bucket,
        webUiLogGroup.name,
        accountId,
        webUiImage.imageUri,
        nextauthSecretSm.arn,
        databaseUrlSm.arn,
        encryptionKeySm.arn,
        bedrockBearerTokenSm ? bedrockBearerTokenSm.arn : pulumi.output(undefined),
    ]).apply(([
        cognitoPoolId, cognitoClientId, cognitoClientSecret,
        appBucketN,
        webUiLogGroupN, acctId, imageUri,
        nextauthSecretArn, databaseUrlArn, encryptionKeyArn,
        bedrockBearerTokenArn,
    ]) => JSON.stringify([{
        name: "WebUIContainer",
        image: imageUri,
        essential: true,
        portMappings: [{ containerPort: 3005, hostPort: 3005, protocol: "tcp" }],
        logConfiguration: {
            logDriver: "awslogs",
            options: {
                "awslogs-group": webUiLogGroupN,
                "awslogs-region": region,
                "awslogs-stream-prefix": "web-ui",
            },
        },
        secrets: [
            { name: "NEXTAUTH_SECRET", valueFrom: nextauthSecretArn },
            { name: "DATABASE_URL", valueFrom: databaseUrlArn },
            { name: "ENCRYPTION_KEY", valueFrom: encryptionKeyArn },
            ...(bedrockBearerTokenArn ? [{ name: "AWS_BEARER_TOKEN_BEDROCK", valueFrom: bedrockBearerTokenArn }] : []),
        ],
        environment: [
            { name: "NODE_ENV", value: "production" },
            { name: "PORT", value: "3005" },
            { name: "AWS_REGION", value: region },
            { name: "NEXT_PUBLIC_AWS_REGION", value: region },
            { name: "COGNITO_USER_POOL_ID", value: cognitoPoolId },
            { name: "COGNITO_APP_CLIENT_ID", value: cognitoClientId },
            { name: "COGNITO_APP_CLIENT_SECRET", value: cognitoClientSecret },
            { name: "COGNITO_ISSUER", value: `https://cognito-idp.${region}.amazonaws.com/${cognitoPoolId}` },
            { name: "NEXTAUTH_URL", value: appUrl },
            { name: "APP_BUCKET_NAME", value: appBucketN },
            { name: "S3_BUCKET", value: appBucketN },
            { name: "DATA_DIR", value: "/tmp" },
            { name: "BEDROCK_CHAT_MODEL", value: process.env.BEDROCK_CHAT_MODEL ?? "amazon.titan-embed-text-v2:0" },
            { name: "BEDROCK_EMBEDDING_MODEL", value: process.env.BEDROCK_EMBEDDING_MODEL ?? "amazon.titan-embed-text-v2:0" },
            { name: "LANGFUSE_ENABLED", value: "false" },
            { name: "LANGFUSE_HOST", value: "https://cloud.langfuse.com" },
        ],
    }])),
}, { retainOnDelete: true });

// ============================================================================
// ALB + SECURITY GROUPS + TARGET GROUP + LISTENER
// ============================================================================

// Look up CloudFront managed prefix list (restricts ALB inbound to CloudFront only)
const cloudFrontPrefixList = aws.ec2.getManagedPrefixListOutput({
    name: "com.amazonaws.global.cloudfront.origin-facing",
});

// ALB Security Group — inbound port 80 from CloudFront managed prefix list only
const albSecurityGroup = new aws.ec2.SecurityGroup("alb-sg", {
    name: `${appName}-alb-sg`,
    description: "Security group for WebUI ALB - CloudFront origin only",
    vpcId: vpcId,
    ingress: [{
        fromPort: 80,
        toPort: 80,
        protocol: "tcp",
        prefixListIds: [cloudFrontPrefixList.id],
        description: "HTTP from CloudFront managed prefix list",
    }],
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
        description: "Allow all outbound",
    }],
});

// ECS Service Security Group — inbound port 3005 from ALB security group only
const ecsServiceSecurityGroup = new aws.ec2.SecurityGroup("ecs-service-sg", {
    name: `${appName}-ecs-service-sg`,
    description: "Security group for WebUI ECS tasks - ALB traffic only",
    vpcId: vpcId,
    ingress: [{
        fromPort: 3005,
        toPort: 3005,
        protocol: "tcp",
        securityGroups: [albSecurityGroup.id],
        description: "Container port from ALB",
    }],
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
        description: "Allow all outbound",
    }],
});

// Application Load Balancer — internet-facing, idleTimeout 1200s for long streaming requests
const alb = new aws.lb.LoadBalancer("web-ui-alb", {
    name: `${appName}-alb`,
    internal: false,
    loadBalancerType: "application",
    securityGroups: [albSecurityGroup.id],
    subnets: publicSubnetIds,
    idleTimeout: 1200,
});

// Target Group — IP target type, port 3005, /api/health health check
const webUiTargetGroup = new aws.lb.TargetGroup("web-ui-tg", {
    port: 3005,
    protocol: "HTTP",
    targetType: "ip",
    vpcId: vpcId,
    deregistrationDelay: 30,
    healthCheck: {
        path: "/api/health",
        interval: 60,
        timeout: 5,
        healthyThreshold: 2,
        unhealthyThreshold: 3,
        matcher: "200",
    },
});

// HTTP Listener — port 80, forward to target group
const httpListener = new aws.lb.Listener("http-listener", {
    loadBalancerArn: alb.arn,
    port: 80,
    protocol: "HTTP",
    defaultActions: [{
        type: "forward",
        targetGroupArn: webUiTargetGroup.arn,
    }],
});

// ============================================================================
// ECS FARGATE SERVICE + AUTO SCALING
// ============================================================================

// ECS Fargate Service — forceNewDeployment, circuit breaker with rollback
const webUiService = new aws.ecs.Service("web-ui-service", {
    name: `${appName}-web-ui-service`,
    cluster: ecsCluster.arn,
    taskDefinition: webUiTaskDef.arn,
    desiredCount: 1,
    launchType: "FARGATE",
    forceNewDeployment: true,
    deploymentCircuitBreaker: {
        enable: true,
        rollback: true,
    },
    deploymentMinimumHealthyPercent: 100,
    deploymentMaximumPercent: 200,
    networkConfiguration: {
        subnets: privateSubnetIds,
        securityGroups: [ecsServiceSecurityGroup.id],
        assignPublicIp: false,
    },
    loadBalancers: [{
        targetGroupArn: webUiTargetGroup.arn,
        containerName: "WebUIContainer",
        containerPort: 3005,
    }],
}, { dependsOn: [httpListener] });

// Auto Scaling Target — min 2, max 10
const scalingTarget = new aws.appautoscaling.Target("web-ui-scaling-target", {
    maxCapacity: 10,
    minCapacity: 2,
    resourceId: pulumi.interpolate`service/${ecsCluster.name}/${webUiService.name}`,
    scalableDimension: "ecs:service:DesiredCount",
    serviceNamespace: "ecs",
});

// CPU Scaling Policy — target 70%
new aws.appautoscaling.Policy("web-ui-cpu-scaling", {
    name: `${appName}-web-ui-cpu-scaling`,
    policyType: "TargetTrackingScaling",
    resourceId: scalingTarget.resourceId,
    scalableDimension: scalingTarget.scalableDimension,
    serviceNamespace: scalingTarget.serviceNamespace,
    targetTrackingScalingPolicyConfiguration: {
        predefinedMetricSpecification: {
            predefinedMetricType: "ECSServiceAverageCPUUtilization",
        },
        targetValue: 70,
    },
});

// Memory Scaling Policy — target 75%
new aws.appautoscaling.Policy("web-ui-memory-scaling", {
    name: `${appName}-web-ui-memory-scaling`,
    policyType: "TargetTrackingScaling",
    resourceId: scalingTarget.resourceId,
    scalableDimension: scalingTarget.scalableDimension,
    serviceNamespace: scalingTarget.serviceNamespace,
    targetTrackingScalingPolicyConfiguration: {
        predefinedMetricSpecification: {
            predefinedMetricType: "ECSServiceAverageMemoryUtilization",
        },
        targetValue: 75,
    },
});

// ============================================================================
// STACK OUTPUTS
// ============================================================================

// ECS + ECR exports
export const ecsClusterArn = ecsCluster.arn;
export const ecsClusterName = ecsCluster.name;
export const ecrRepositoryUri = ecrRepository.repositoryUrl;
export const webUiTaskDefinitionArn = webUiTaskDef.arn;

export const networkingVpcId = vpcId;
export const networkingVpcCidr = vpcCidr;

// S3 bucket exports
export const appBucketName = appBucket.bucket;
export const appBucketArn = appBucket.arn;

// Cognito exports
export const cognitoUserPoolId = userPool.id;
export const cognitoUserPoolArn = userPool.arn;
export const cognitoUserPoolClientId = userPoolClient.id;
export const cognitoUserPoolClientSecret = pulumi.secret(userPoolClient.clientSecret);
export const cognitoIdentityPoolId = identityPool.id;
export const cognitoDomainPrefix = pulumi.interpolate`${appName}-auth-${accountId}`;

// SNS exports
export const snsTopicArn = snsTopic.arn;

// ============================================================================
// RDS POSTGRESQL — IAM rds-db:connect policies
// ============================================================================

new aws.iam.RolePolicy("ecs-task-rds-connect-policy", {
    role: ecsTaskRole.id,
    policy: postgresInstance.arn.apply(rdsArn => JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Action: ["rds-db:connect"], Resource: [rdsArn] }],
    })),
});

// RDS PostgreSQL exports
export const postgresEndpoint = postgresInstance.address;


// ============================================================================
// CLOUDFRONT DISTRIBUTION
// ============================================================================

// Stable origin verify secret — random.RandomString does NOT change on every preview
const originVerifySecret = new random.RandomString("origin-verify-secret", {
    length: 32,
    special: false,
});

const cloudFrontDistribution = new aws.cloudfront.Distribution("web-ui-cloudfront", {
    enabled: true,
    comment: "Chatbot WebUI",
    defaultRootObject: "",
    httpVersion: "http2",
    isIpv6Enabled: true,
    priceClass: "PriceClass_All",

    origins: [{
        domainName: alb.dnsName,
        originId: "alb-origin",
        customOriginConfig: {
            httpPort: 80,
            httpsPort: 443,
            originProtocolPolicy: "http-only",
            originSslProtocols: ["TLSv1.2"],
            originReadTimeout: 60,
            originKeepaliveTimeout: 60,
        },
        customHeaders: [{
            name: "X-Origin-Verify",
            value: originVerifySecret.result,
        }],
    }],

    defaultCacheBehavior: {
        targetOriginId: "alb-origin",
        viewerProtocolPolicy: "redirect-to-https",
        allowedMethods: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
        cachedMethods: ["GET", "HEAD"],
        compress: true,
        // Caching disabled — forward all requests to ALB
        forwardedValues: {
            queryString: true,
            headers: ["*"],
            cookies: { forward: "all" },
        },
        minTtl: 0,
        defaultTtl: 0,
        maxTtl: 0,
    },

    restrictions: {
        geoRestriction: {
            restrictionType: "none",
        },
    },

    viewerCertificate: {
        cloudfrontDefaultCertificate: true,
    },
});

// ============================================================================
// PG-BOSS WORKERS ECS SERVICE
// ============================================================================

// ECR Repository — Workers container images
const workersEcrRepo = new aws.ecr.Repository("workers-ecr-repo", {
    name: `${appName}-workers`,
    imageTagMutability: "MUTABLE",
    forceDelete: false,
});

// Explicit source hash — combines apps/workers/ + prisma/ + libs/ so any change forces a rebuild.
const workersSrcHash = crypto.createHash("sha256")
    .update(hashDirectory(path.join(repoRoot, "apps/workers")))
    .update(hashDirectory(path.join(repoRoot, "prisma")))
    .update(hashDirectory(path.join(repoRoot, "libs")))
    .digest("hex")
    .substring(0, 12);

// Build and push Workers Docker image automatically on source change
const workersImage = new awsx.ecr.Image("workers-image", {
    repositoryUrl: workersEcrRepo.repositoryUrl,
    context: repoRoot,
    dockerfile: path.join(repoRoot, "apps/workers/Dockerfile"),
    platform: "linux/arm64",
    imageTag: workersSrcHash,
    args: {
        BUILDX_NO_DEFAULT_ATTESTATIONS: "1",
    },
    cacheFrom: [pulumi.interpolate`${workersEcrRepo.repositoryUrl}:latest`],
}, { dependsOn: [ecrPublicLogin], retainOnDelete: true });

const workersLogGroup = new aws.cloudwatch.LogGroup("workers-log-group", {
    name: `/ecs/${appName}-workers`,
    retentionInDays: 7,
});

const workersTaskRole = new aws.iam.Role("workers-task-role", {
    name: `${appName}-workers-task-role`,
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Principal: { Service: "ecs-tasks.amazonaws.com" },
            Action: "sts:AssumeRole",
        }],
    }),
});

new aws.iam.RolePolicy("workers-sns-policy", {
    role: workersTaskRole.id,
    policy: snsTopic.arn.apply(topicArn =>
        JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: ["sns:Publish"],
                Resource: [topicArn],
            }],
        })
    ),
});

new aws.iam.RolePolicy("workers-bedrock-policy", {
    role: workersTaskRole.id,
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Action: ["bedrock:InvokeModel"],
            Resource: ["*"],
        }],
    }),
});

new aws.iam.RolePolicy("workers-s3-policy", {
    role: workersTaskRole.id,
    policy: appBucket.arn.apply(arn =>
        JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
                    Resource: [arn, `${arn}/*`],
                },
                {
                    Effect: "Allow",
                    Action: ["s3:GetObject", "s3:ListBucket"],
                    Resource: ["*"],
                },
            ],
        })
    ),
});

// Ephemeral workers CloudWatch log group — short-lived job tasks
const ephemeralWorkersLogGroup = new aws.cloudwatch.LogGroup("ephemeral-workers-log-group", {
    name: `/ecs/${appName}-ephemeral-workers`,
    retentionInDays: 7,
});

new aws.iam.RolePolicy("workers-logs-policy", {
    role: workersTaskRole.id,
    policy: pulumi.all([workersLogGroup.arn, ephemeralWorkersLogGroup.arn]).apply(([logArn, ephLogArn]) =>
        JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
                Resource: [logArn, `${logArn}:*`, ephLogArn, `${ephLogArn}:*`],
            }],
        })
    ),
});

new aws.iam.RolePolicy("workers-rds-connect-policy", {
    role: workersTaskRole.id,
    policy: postgresInstance.arn.apply(dbArn =>
        JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: ["rds-db:connect"],
                Resource: [`${dbArn.replace(':rds:', ':rds-db:').replace(':db:', ':dbuser:')}/${appName}_admin`],
            }],
        })
    ),
});

// Ephemeral worker task definition — lightweight tasks for horizontal dispatch
const ephemeralWorkerTaskDef = new aws.ecs.TaskDefinition("ephemeral-worker-task-def", {
    family: `${appName}-ephemeral-worker-task`,
    cpu: "1024",
    memory: "4096",
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    executionRoleArn: ecsTaskExecutionRole.arn,
    taskRoleArn: workersTaskRole.arn,
    runtimePlatform: {
        cpuArchitecture: "ARM64",
        operatingSystemFamily: "LINUX",
    },
    containerDefinitions: pulumi.all([
        appBucket.bucket,
        ephemeralWorkersLogGroup.name,
        snsTopic.arn,
        workersImage.imageUri,
        databaseUrlSm.arn,
        encryptionKeySm.arn,
    ]).apply(([
        appBucketN,
        ephLogGroupN, snsTopicArn, imageUri, databaseUrlArn, encryptionKeyArn,
    ]) => JSON.stringify([{
        name: "WorkersContainer",
        image: imageUri,
        essential: true,
        logConfiguration: {
            logDriver: "awslogs",
            options: {
                "awslogs-group": ephLogGroupN,
                "awslogs-region": region,
                "awslogs-stream-prefix": "ephemeral",
            },
        },
        secrets: [
            { name: "DATABASE_URL", valueFrom: databaseUrlArn },
            { name: "ENCRYPTION_KEY", valueFrom: encryptionKeyArn },
        ],
        environment: [
            { name: "AWS_REGION", value: region },
            { name: "APP_BUCKET_NAME", value: appBucketN },
            { name: "S3_BUCKET", value: appBucketN },
            { name: "BEDROCK_CHAT_MODEL", value: process.env.BEDROCK_CHAT_MODEL ?? "amazon.titan-embed-text-v2:0" },
            { name: "BEDROCK_EMBEDDING_MODEL", value: process.env.BEDROCK_EMBEDDING_MODEL ?? "amazon.titan-embed-text-v2:0" },
            { name: "LOG_LEVEL", value: "info" },
            { name: "PLAYWRIGHT_BROWSERS_PATH", value: "/usr/local/share/playwright-browsers" },
            { name: "CRAWLEE_STORAGE_DIR", value: "/tmp/crawlee-storage" },
            { name: "CRAWLEE_MEMORY_MBYTES", value: "3072" },
        ],
    }])),
}, { retainOnDelete: true });

// IAM policy for workers to dispatch ECS tasks (horizontal executor)
new aws.iam.RolePolicy("workers-ecs-dispatch-policy", {
    role: workersTaskRole.id,
    policy: pulumi.all([ephemeralWorkerTaskDef.arn, ecsCluster.arn, workersTaskRole.arn, ecsTaskExecutionRole.arn]).apply(
        ([taskDefArn, clusterArn, taskRoleArn, execRoleArn]) =>
            JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Effect: "Allow",
                        Action: ["ecs:RunTask"],
                        Resource: [taskDefArn],
                    },
                    {
                        Effect: "Allow",
                        Action: ["ecs:DescribeTasks"],
                        Resource: ["*"],
                        Condition: {
                            ArnEquals: {
                                "ecs:cluster": clusterArn,
                            },
                        },
                    },
                    {
                        Effect: "Allow",
                        Action: ["iam:PassRole"],
                        Resource: [taskRoleArn, execRoleArn],
                    },
                ],
            })
    ),
});

const workersSecurityGroup = new aws.ec2.SecurityGroup("workers-sg", {
    name: `${appName}-workers-sg`,
    description: "Security group for pg-boss workers - egress only",
    vpcId: vpcId,
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
        description: "Allow all outbound for AWS API calls + PostgreSQL",
    }],
});

const workersTaskDef = new aws.ecs.TaskDefinition("workers-task-def", {
    family: `${appName}-workers-task`,
    cpu: "1024",
    memory: "4096",
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    executionRoleArn: ecsTaskExecutionRole.arn,
    taskRoleArn: workersTaskRole.arn,
    runtimePlatform: {
        cpuArchitecture: "ARM64",
        operatingSystemFamily: "LINUX",
    },
    containerDefinitions: pulumi.all([
        appBucket.bucket,
        workersLogGroup.name,
        snsTopic.arn,
        workersImage.imageUri,
        ecsCluster.arn,
        ephemeralWorkerTaskDef.arn,
        workersSecurityGroup.id,
        privateSubnetIds.apply(ids => ids.join(",")),
        databaseUrlSm.arn,
        encryptionKeySm.arn,
    ]).apply(([
        appBucketN,
        workersLogGroupN, snsTopicArn, imageUri,
        clusterArn, ephTaskDefArn, workersSgId, subnetsJoined, databaseUrlArn, encryptionKeyArn,
    ]) => JSON.stringify([{
        name: "WorkersContainer",
        image: imageUri,
        essential: true,
        logConfiguration: {
            logDriver: "awslogs",
            options: {
                "awslogs-group": workersLogGroupN,
                "awslogs-region": region,
                "awslogs-stream-prefix": "workers",
            },
        },
        secrets: [
            { name: "DATABASE_URL", valueFrom: databaseUrlArn },
            { name: "ENCRYPTION_KEY", valueFrom: encryptionKeyArn },
        ],
        environment: [
            { name: "AWS_REGION", value: region },
            { name: "APP_BUCKET_NAME", value: appBucketN },
            { name: "S3_BUCKET", value: appBucketN },
            { name: "BEDROCK_CHAT_MODEL", value: process.env.BEDROCK_CHAT_MODEL ?? "amazon.titan-embed-text-v2:0" },
            { name: "BEDROCK_EMBEDDING_MODEL", value: process.env.BEDROCK_EMBEDDING_MODEL ?? "amazon.titan-embed-text-v2:0" },
            { name: "LOG_LEVEL", value: "info" },
            { name: "WORKER_ARCH", value: "vertical" },
            { name: "ECS_CLUSTER_ARN", value: clusterArn },
            { name: "WORKER_TASK_DEFINITION_ARN", value: ephTaskDefArn },
            { name: "PRIVATE_SUBNET_IDS", value: subnetsJoined },
            { name: "SECURITY_GROUP_IDS", value: workersSgId },
            { name: "TASK_TIMEOUT_MS", value: "900000" },
            { name: "PLAYWRIGHT_BROWSERS_PATH", value: "/usr/local/share/playwright-browsers" },
            { name: "CRAWLEE_STORAGE_DIR", value: "/tmp/crawlee-storage" },
            { name: "CRAWLEE_MEMORY_MBYTES", value: "3072" },
        ],
    }])),
}, { retainOnDelete: true });

const workersService = new aws.ecs.Service("workers-service", {
    name: `${appName}-workers-service`,
    cluster: ecsCluster.arn,
    taskDefinition: workersTaskDef.arn,
    desiredCount: 1,
    launchType: "FARGATE",
    forceNewDeployment: true,
    networkConfiguration: {
        subnets: privateSubnetIds,
        securityGroups: [workersSecurityGroup.id],
        assignPublicIp: false,
    },
});

// ============================================================================
// PHASE 10 STACK OUTPUTS — ECS + ALB + CloudFront
// ============================================================================

export const webUiServiceName = webUiService.name;
export const albDnsName = alb.dnsName;
export const albArn = alb.arn;
export const cloudFrontUrl = pulumi.interpolate`https://${cloudFrontDistribution.domainName}`;
export const cloudFrontDistributionId = cloudFrontDistribution.id;
export const originVerifySecretValue = pulumi.secret(originVerifySecret.result);

// Workers ECS exports
export const workersServiceName = workersService.name;
export const workersEcrRepoUrl = workersEcrRepo.repositoryUrl;
export const ephemeralWorkerTaskDefArn = ephemeralWorkerTaskDef.arn;
