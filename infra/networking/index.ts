import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

// ============================================================================
// CONFIG
// ============================================================================

const config = new pulumi.Config();
// Use vpcCidrConfig to avoid duplicate identifier with the vpcCidr export below.
const vpcCidrConfig = config.get("vpcCidr") ?? "10.0.0.0/16";

// ============================================================================
// VPC — 4-tier subnets with explicit CIDRs matching CDK allocation
// CDK allocates largest subnets first: Private /22 -> Public /24 -> Database /24 -> Intra /26
// Subnet CIDRs (calculated from CDK deterministic allocation, 10.0.0.0/16, 2 AZs):
//   Private:  10.0.0.0/22 (us-east-1a), 10.0.4.0/22 (us-east-1b)
//   Public:   10.0.8.0/24 (us-east-1a), 10.0.9.0/24 (us-east-1b)
//   Database: 10.0.10.0/24 (us-east-1a), 10.0.11.0/24 (us-east-1b)
//   Intra:    10.0.12.0/26 (us-east-1a), 10.0.12.64/26 (us-east-1b)
// ============================================================================

const vpc = new awsx.ec2.Vpc("chatbot-vpc", {
    cidrBlock: vpcCidrConfig,
    availabilityZoneNames: ["us-east-1a", "us-east-1b"],
    enableDnsHostnames: true,
    enableDnsSupport: true,
    natGateways: { strategy: "OnePerAz" },
    subnetSpecs: [
        {
            type: "Private",
            name: "private",
            cidrBlocks: ["10.0.0.0/22", "10.0.4.0/22"],
        },
        {
            type: "Public",
            name: "public",
            cidrBlocks: ["10.0.8.0/24", "10.0.9.0/24"],
        },
        {
            type: "Isolated",
            name: "database",
            cidrBlocks: ["10.0.10.0/24", "10.0.11.0/24"],
        },
        {
            type: "Isolated",
            name: "intra",
            cidrBlocks: ["10.0.12.0/26", "10.0.12.64/26"],
        },
    ],
    tags: { Name: "chatbot-vpc" },
});

// ============================================================================
// SEPARATE DATABASE vs INTRA SUBNET IDs
// awsx.ec2.Vpc merges ALL Isolated subnets into isolatedSubnetIds — we cannot
// use that output directly. Filter vpc.subnets by Name tag instead.
// awsx names subnets as "<component>-<spec-name>-<index>":
//   chatbot-vpc-database-0, chatbot-vpc-database-1
//   chatbot-vpc-intra-0, chatbot-vpc-intra-1
// ============================================================================

const databaseSubnetIds: pulumi.Output<string[]> = vpc.subnets.apply(subnets =>
    pulumi.all(
        subnets.map(s =>
            pulumi.all([s.id, s.tags] as const).apply(([id, tags]) => ({
                id,
                name: (tags ?? {})["Name"] ?? "",
            }))
        )
    )
).apply(items =>
    items.filter(item => item.name.includes("-database-")).map(item => item.id)
);

const intraSubnetIds: pulumi.Output<string[]> = vpc.subnets.apply(subnets =>
    pulumi.all(
        subnets.map(s =>
            pulumi.all([s.id, s.tags] as const).apply(([id, tags]) => ({
                id,
                name: (tags ?? {})["Name"] ?? "",
            }))
        )
    )
).apply(items =>
    items.filter(item => item.name.includes("-intra-")).map(item => item.id)
);

// ============================================================================
// VPC GATEWAY ENDPOINTS
// awsx.ec2.Vpc does NOT support addGatewayEndpoint — use raw aws.ec2.VpcEndpoint.
// Route table IDs: look up route table for each private + isolated subnet,
// then deduplicate (private subnets in same AZ share a route table).
// ============================================================================

const endpointRouteTableIds = pulumi.all([
    vpc.privateSubnetIds,
    databaseSubnetIds,
    intraSubnetIds,
]).apply(([privateIds, dbIds, intraIds]) => {
    const allSubnetIds = [...privateIds, ...dbIds, ...intraIds];
    const routeTableOutputs = allSubnetIds.map(subnetId =>
        aws.ec2.getRouteTableOutput({ subnetId }).routeTableId
    );
    return pulumi.all(routeTableOutputs).apply(ids => [...new Set(ids)]);
});

const region = aws.config.region ?? "us-east-1";

const s3Endpoint = new aws.ec2.VpcEndpoint("chatbot-endpoint-s3", {
    vpcId: vpc.vpcId,
    serviceName: pulumi.interpolate`com.amazonaws.${region}.s3`,
    vpcEndpointType: "Gateway",
    routeTableIds: endpointRouteTableIds,
    tags: { Name: "chatbot-endpoint-s3" },
});

// ============================================================================
// SUBNET GROUPS
// Both use Database tier subnets — matching CDK networkingStack.ts exactly.
// Explicit name= required: without it Pulumi appends a 7-char suffix which
// breaks any existing RDS/ElastiCache clusters referencing the group by name.
// ============================================================================

const dbSubnetGroup = new aws.rds.SubnetGroup("chatbot-db-subnet-group", {
    name: "chatbot-db-subnet-group",
    description: "Subnet group for RDS databases",
    subnetIds: databaseSubnetIds,
    tags: { Name: "chatbot-db-subnet-group" },
});

// ============================================================================
// STACK OUTPUTS — match CDK CfnOutput keys exactly
// ============================================================================

export const vpcId = vpc.vpcId;
export const vpcCidr = vpc.vpc.cidrBlock;
export const publicSubnetIds = vpc.publicSubnetIds;
export const privateSubnetIds = vpc.privateSubnetIds;
export { databaseSubnetIds };
export { intraSubnetIds };
export const availabilityZones = pulumi.output(["us-east-1a", "us-east-1b"]);
export const dbSubnetGroupName = dbSubnetGroup.name;
