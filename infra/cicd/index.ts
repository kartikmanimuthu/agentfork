import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const appName = "chatbot";
const pipelineName = `${appName}-pipeline`;
const repoOwner = "kartikmanimuthu";
const repoName = "chatbot";
const branchName = "main";

const callerIdentity = aws.getCallerIdentityOutput({});
const accountId = callerIdentity.accountId;
const region = aws.config.region ?? "us-east-1";

// ---------------------------------------------------------------------------
// CodeStar Connection (GitHub)
// ---------------------------------------------------------------------------
const githubConnection = new aws.codestarconnections.Connection("github-connection", {
    name: `${appName}-connection`,
    providerType: "GitHub",
}, { retainOnDelete: true });

// ---------------------------------------------------------------------------
// S3 Artifact Bucket
// ---------------------------------------------------------------------------
const artifactBucket = new aws.s3.BucketV2("pipeline-artifacts", {
    bucket: pulumi.interpolate`${appName}-pipeline-artifacts-${accountId}-${region}`,
    forceDestroy: false,
}, { retainOnDelete: true });

new aws.s3.BucketPublicAccessBlock("pipeline-artifacts-pab", {
    bucket: artifactBucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
});

new aws.s3.BucketVersioningV2("pipeline-artifacts-versioning", {
    bucket: artifactBucket.id,
    versioningConfiguration: { status: "Enabled" },
});

// ---------------------------------------------------------------------------
// KMS Key for Artifact Encryption
// ---------------------------------------------------------------------------
const artifactKmsKey = new aws.kms.Key("pipeline-artifacts-key", {
    description: "KMS key for CodePipeline artifact encryption",
    deletionWindowInDays: 7,
    enableKeyRotation: true,
}, { retainOnDelete: true });

new aws.kms.Alias("pipeline-artifacts-key-alias", {
    name: pulumi.interpolate`alias/${appName}-pipeline-artifacts`,
    targetKeyId: artifactKmsKey.id,
});

// ---------------------------------------------------------------------------
// IAM Role (shared by CodePipeline + CodeBuild)
// ---------------------------------------------------------------------------
const codePipelineRole = new aws.iam.Role("codepipeline-role", {
    name: `${appName}-codepipeline-role`,
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
            {
                Effect: "Allow",
                Principal: { Service: "codepipeline.amazonaws.com" },
                Action: "sts:AssumeRole",
            },
            {
                Effect: "Allow",
                Principal: { Service: "codebuild.amazonaws.com" },
                Action: "sts:AssumeRole",
            },
        ],
    }),
});

new aws.kms.KeyPolicy("pipeline-artifacts-key-policy", {
    keyId: artifactKmsKey.id,
    policy: pulumi.all([artifactKmsKey.arn, accountId, codePipelineRole.arn]).apply(
        ([keyArn, accId, roleArn]) =>
            JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Sid: "Enable IAM User Permissions",
                        Effect: "Allow",
                        Principal: { AWS: `arn:aws:iam::${accId}:root` },
                        Action: "kms:*",
                        Resource: "*",
                    },
                    {
                        Sid: "Allow CodePipeline and CodeBuild",
                        Effect: "Allow",
                        Principal: { AWS: roleArn },
                        Action: [
                            "kms:Encrypt",
                            "kms:Decrypt",
                            "kms:ReEncrypt*",
                            "kms:GenerateDataKey*",
                            "kms:CreateGrant",
                            "kms:DescribeKey",
                        ],
                        Resource: "*",
                    },
                ],
            }),
    ),
});

// ---------------------------------------------------------------------------
// IAM Policy — CodePipeline Core
// ---------------------------------------------------------------------------
new aws.iam.RolePolicy("codepipeline-core-policy", {
    role: codePipelineRole.id,
    policy: pulumi.all([artifactBucket.arn, artifactKmsKey.arn, accountId, region, githubConnection.arn]).apply(
        ([bucketArn, keyArn, accId, reg, connArn]) =>
            JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Sid: "S3ArtifactAccess",
                        Effect: "Allow",
                        Action: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
                        Resource: [bucketArn, `${bucketArn}/*`],
                    },
                    {
                        Sid: "KMSArtifactEncryption",
                        Effect: "Allow",
                        Action: [
                            "kms:Encrypt",
                            "kms:Decrypt",
                            "kms:ReEncrypt*",
                            "kms:GenerateDataKey*",
                            "kms:DescribeKey",
                        ],
                        Resource: keyArn,
                    },
                    {
                        Sid: "CodeBuildAccess",
                        Effect: "Allow",
                        Action: [
                            "codebuild:StartBuild",
                            "codebuild:BatchGetBuilds",
                            "codebuild:BatchGetReports",
                        ],
                        Resource: `arn:aws:codebuild:${reg}:${accId}:project/${appName}-*`,
                    },
                    {
                        Sid: "CloudWatchLogs",
                        Effect: "Allow",
                        Action: [
                            "logs:CreateLogGroup",
                            "logs:CreateLogStream",
                            "logs:PutLogEvents",
                        ],
                        Resource: `arn:aws:logs:${reg}:${accId}:log-group:/aws/codebuild/${appName}-*:*`,
                    },
                    {
                        Sid: "CodeStarConnection",
                        Effect: "Allow",
                        Action: ["codestar-connections:UseConnection"],
                        Resource: connArn,
                    },
                ],
            }),
    ),
});

// ---------------------------------------------------------------------------
// IAM Policy — Pulumi Deploy Permissions
// ---------------------------------------------------------------------------
new aws.iam.RolePolicy("pulumi-deploy-policy", {
    role: codePipelineRole.id,
    policy: pulumi.all([accountId, region]).apply(([accId, reg]) =>
        JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                { Sid: "EC2", Effect: "Allow", Action: "ec2:*", Resource: "*" },
                { Sid: "ECS", Effect: "Allow", Action: "ecs:*", Resource: "*" },
                { Sid: "Lambda", Effect: "Allow", Action: "lambda:*", Resource: "*" },
                { Sid: "RDS", Effect: "Allow", Action: "rds:*", Resource: "*" },
                { Sid: "Cognito", Effect: "Allow", Action: ["cognito-idp:*", "cognito-identity:*"], Resource: "*" },
                { Sid: "CloudFront", Effect: "Allow", Action: "cloudfront:*", Resource: "*" },
                {
                    Sid: "IAM",
                    Effect: "Allow",
                    Action: [
                        "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:ListRoles",
                        "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy",
                        "iam:ListRolePolicies", "iam:AttachRolePolicy", "iam:DetachRolePolicy",
                        "iam:CreatePolicy", "iam:DeletePolicy", "iam:GetPolicy", "iam:ListPolicies",
                        "iam:CreateInstanceProfile", "iam:DeleteInstanceProfile", "iam:GetInstanceProfile",
                        "iam:AddRoleToInstanceProfile", "iam:RemoveRoleFromInstanceProfile",
                        "iam:PassRole", "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole",
                        "iam:ListInstanceProfilesForRole", "iam:ListAttachedRolePolicies",
                    ],
                    Resource: "*",
                },
                { Sid: "S3", Effect: "Allow", Action: "s3:*", Resource: "*" },
                {
                    Sid: "SecretsManager",
                    Effect: "Allow",
                    Action: "secretsmanager:*",
                    Resource: `arn:aws:secretsmanager:${reg}:${accId}:secret:${appName}/*`,
                },
                { Sid: "SQS", Effect: "Allow", Action: "sqs:*", Resource: "*" },
                { Sid: "EventBridge", Effect: "Allow", Action: "events:*", Resource: "*" },
                { Sid: "CloudWatchLogsAll", Effect: "Allow", Action: "logs:*", Resource: "*" },
                { Sid: "ACM", Effect: "Allow", Action: "acm:*", Resource: "*" },
                { Sid: "ELB", Effect: "Allow", Action: "elasticloadbalancing:*", Resource: "*" },
                { Sid: "ECRAuthToken", Effect: "Allow", Action: "ecr:GetAuthorizationToken", Resource: "*" },
                {
                    Sid: "ECR",
                    Effect: "Allow",
                    Action: "ecr:*",
                    Resource: `arn:aws:ecr:${reg}:${accId}:repository/${appName}*`,
                },
                { Sid: "ECRPublic", Effect: "Allow", Action: "ecr-public:*", Resource: "*" },
                { Sid: "SSM", Effect: "Allow", Action: "ssm:*", Resource: "*" },
                { Sid: "SNS", Effect: "Allow", Action: "sns:*", Resource: "*" },
                { Sid: "Route53", Effect: "Allow", Action: "route53:*", Resource: "*" },
                { Sid: "KMS", Effect: "Allow", Action: "kms:*", Resource: "*" },
                { Sid: "AutoScaling", Effect: "Allow", Action: "autoscaling:*", Resource: "*" },
                {
                    Sid: "ResourceGroupsTagging",
                    Effect: "Allow",
                    Action: ["tag:GetResources", "tag:GetTagKeys", "tag:GetTagValues"],
                    Resource: "*",
                },
                {
                    Sid: "STS",
                    Effect: "Allow",
                    Action: ["sts:GetCallerIdentity", "sts:AssumeRole"],
                    Resource: "*",
                },
                { Sid: "CloudWatchMetrics", Effect: "Allow", Action: "cloudwatch:*", Resource: "*" },
            ],
        }),
    ),
});

// ---------------------------------------------------------------------------
// CodeBuild Projects
// ---------------------------------------------------------------------------
const buildspecPreview = `version: 0.2
env:
  variables:
    PULUMI_CONFIG_PASSPHRASE: ""
    AWS_DEFAULT_REGION: us-east-1
    NODE_OPTIONS: "--max-old-space-size=4096"
phases:
  install:
    runtime-versions:
      nodejs: 20
    commands:
      - curl -fsSL https://get.pulumi.com | sh
      - export PATH=$PATH:$HOME/.pulumi/bin
      - cd infra/networking && npm install && pulumi install && cd ../..
      - cd infra/compute && npm install && pulumi install && cd ../..
  build:
    commands:
      - cd infra/networking && pulumi preview --stack prod --non-interactive --diff
      - cd ../compute && pulumi preview --stack prod --non-interactive --diff`;

const buildspecDeploy = `version: 0.2
env:
  variables:
    PULUMI_CONFIG_PASSPHRASE: ""
    AWS_DEFAULT_REGION: us-east-1
    NODE_OPTIONS: "--max-old-space-size=4096"
phases:
  install:
    runtime-versions:
      nodejs: 20
    commands:
      - curl -fsSL https://get.pulumi.com | sh
      - export PATH=$PATH:$HOME/.pulumi/bin
      - cd infra/networking && npm install && pulumi install && cd ../..
      - cd infra/compute && npm install && pulumi install && cd ../..
  pre_build:
    commands:
      - (cd infra/networking && pulumi cancel --stack prod --yes) || true
      - (cd infra/compute && pulumi cancel --stack prod --yes) || true
  build:
    commands:
      - cd infra/networking && pulumi up --stack prod --yes --non-interactive
      - cd ../compute && pulumi up --stack prod --yes --non-interactive`;

const previewProject = new aws.codebuild.Project("chatbot-preview", {
    name: `${appName}-preview`,
    description: "Run Pulumi preview for networking and compute stacks",
    serviceRole: codePipelineRole.arn,
    buildTimeout: 20,
    artifacts: { type: "CODEPIPELINE" },
    environment: {
        type: "LINUX_CONTAINER",
        computeType: "BUILD_GENERAL1_LARGE",
        image: "aws/codebuild/standard:7.0",
        privilegedMode: true,
    },
    source: {
        type: "CODEPIPELINE",
        buildspec: buildspecPreview,
    },
});

const deployProject = new aws.codebuild.Project("chatbot-deploy", {
    name: `${appName}-deploy`,
    description: "Run Pulumi up for networking and compute stacks",
    serviceRole: codePipelineRole.arn,
    buildTimeout: 60,
    artifacts: { type: "CODEPIPELINE" },
    environment: {
        type: "LINUX_CONTAINER",
        computeType: "BUILD_GENERAL1_LARGE",
        image: "aws/codebuild/standard:7.0",
        privilegedMode: true,
    },
    source: {
        type: "CODEPIPELINE",
        buildspec: buildspecDeploy,
    },
});

// ---------------------------------------------------------------------------
// CodePipeline
// ---------------------------------------------------------------------------
const pipeline = new aws.codepipeline.Pipeline("chatbot-pipeline", {
    name: pipelineName,
    roleArn: codePipelineRole.arn,
    pipelineType: "V2",
    triggers: [{
        providerType: "CodeStarSourceConnection",
        gitConfiguration: {
            sourceActionName: "GitHubSource",
            pushes: [{
                branches: {
                    includes: ["main"],
                },
            }],
        },
    }],
    artifactStores: [{
        type: "S3",
        location: artifactBucket.id,
        encryptionKey: {
            id: artifactKmsKey.arn,
            type: "KMS",
        },
    }],
    stages: [
        {
            name: "Source",
            actions: [
                {
                    name: "GitHubSource",
                    category: "Source",
                    owner: "AWS",
                    provider: "CodeStarSourceConnection",
                    version: "1",
                    outputArtifacts: ["source_output"],
                    configuration: {
                        ConnectionArn: githubConnection.arn,
                        FullRepositoryId: `${repoOwner}/${repoName}`,
                        BranchName: branchName,
                    },
                },
            ],
        },
        {
            name: "Preview",
            actions: [
                {
                    name: "PreviewAction",
                    category: "Build",
                    owner: "AWS",
                    provider: "CodeBuild",
                    version: "1",
                    inputArtifacts: ["source_output"],
                    configuration: {
                        ProjectName: previewProject.name,
                    },
                },
            ],
        },
        {
            name: "Approval",
            actions: [
                {
                    name: "ApproveDeploy",
                    category: "Approval",
                    owner: "AWS",
                    provider: "Manual",
                    version: "1",
                    configuration: {
                        CustomData: "Review Pulumi preview output in CloudWatch Logs before approving.",
                    },
                },
            ],
        },
        {
            name: "Deploy",
            actions: [
                {
                    name: "DeployAction",
                    category: "Build",
                    owner: "AWS",
                    provider: "CodeBuild",
                    version: "1",
                    inputArtifacts: ["source_output"],
                    configuration: {
                        ProjectName: deployProject.name,
                    },
                },
            ],
        },
    ],
});

// ---------------------------------------------------------------------------
// Stack Outputs
// ---------------------------------------------------------------------------
export const artifactBucketName = artifactBucket.id;
export const artifactKmsKeyArn = artifactKmsKey.arn;
export const pipelineArn = pipeline.arn;
export const previewProjectName = previewProject.name;
export const deployProjectName = deployProject.name;
export const githubConnectionArn = githubConnection.arn;
