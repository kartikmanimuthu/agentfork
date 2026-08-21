import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

// ============================================================================
// CONFIG
// ============================================================================

const config = new pulumi.Config();
// Use vpcCidrConfig to avoid duplicate identifier with the vpcCidr export below.
const vpcCidrConfig = config.get("vpcCidr") ?? "10.0.0.0/16";
const appName = config.get("appName") ?? "chatbot";
const availabilityZoneNames = config.getObject<string[]>("availabilityZoneNames") ?? ["us-east-1a", "us-east-1b"];

// ============================================================================
// VPC — 4-tier subnets with explicit CIDRs matching CDK allocation
// CDK allocates largest subnets first: Private /22 -> Public /24 -> Database /24 -> Intra /26
// Subnet CIDRs are derived from the configured vpcCidr (must be a /16), keeping
// the same relative layout CDK used for the original 10.0.0.0/16 deployment:
//   Private:  <net>.0.0/22, <net>.4.0/22
//   Public:   <net>.8.0/24, <net>.9.0/24
//   Database: <net>.10.0/24, <net>.11.0/24
//   Intra:    <net>.12.0/26, <net>.12.64/26
// For the default 10.0.0.0/16 this reproduces the original hardcoded values
// byte-for-byte (verified by hand).
// ============================================================================

function subnetCidrsFromVpcCidr(vpcCidr: string) {
    const match = vpcCidr.match(/^(\d+)\.(\d+)\.0\.0\/16$/);
    if (!match) {
        throw new Error(`vpcCidr must be a /16 in the form X.Y.0.0/16, got: ${vpcCidr}`);
    }
    const [firstOctet, secondOctet] = [Number(match[1]), Number(match[2])];
    if (firstOctet > 255 || secondOctet > 255) {
        throw new Error(`vpcCidr octets must be 0-255, got: ${vpcCidr}`);
    }
    const net = `${match[1]}.${match[2]}`;
    return {
        private: [`${net}.0.0/22`, `${net}.4.0/22`],
        public: [`${net}.8.0/24`, `${net}.9.0/24`],
        database: [`${net}.10.0/24`, `${net}.11.0/24`],
        intra: [`${net}.12.0/26`, `${net}.12.64/26`],
    };
}

const subnetCidrs = subnetCidrsFromVpcCidr(vpcCidrConfig);

const vpc = new awsx.ec2.Vpc(`${appName}-vpc`, {
    cidrBlock: vpcCidrConfig,
    availabilityZoneNames: availabilityZoneNames,
    enableDnsHostnames: true,
    enableDnsSupport: true,
    natGateways: { strategy: config.get("natStrategy") === "single" ? "Single" : "OnePerAz" },
    subnetSpecs: [
        {
            type: "Private",
            name: "private",
            cidrBlocks: subnetCidrs.private,
        },
        {
            type: "Public",
            name: "public",
            cidrBlocks: subnetCidrs.public,
        },
        {
            type: "Isolated",
            name: "database",
            cidrBlocks: subnetCidrs.database,
        },
        {
            type: "Isolated",
            name: "intra",
            cidrBlocks: subnetCidrs.intra,
        },
    ],
    tags: { Name: `${appName}-vpc` },
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

const s3Endpoint = new aws.ec2.VpcEndpoint(`${appName}-endpoint-s3`, {
    vpcId: vpc.vpcId,
    serviceName: pulumi.interpolate`com.amazonaws.${region}.s3`,
    vpcEndpointType: "Gateway",
    routeTableIds: endpointRouteTableIds,
    tags: { Name: `${appName}-endpoint-s3` },
});

// ============================================================================
// SUBNET GROUPS
// Both use Database tier subnets — matching CDK networkingStack.ts exactly.
// Explicit name= required: without it Pulumi appends a 7-char suffix which
// breaks any existing RDS/ElastiCache clusters referencing the group by name.
// ============================================================================

const dbSubnetGroup = new aws.rds.SubnetGroup(`${appName}-db-subnet-group`, {
    name: `${appName}-db-subnet-group`,
    description: "Subnet group for RDS databases",
    subnetIds: databaseSubnetIds,
    tags: { Name: `${appName}-db-subnet-group` },
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
export const availabilityZones = pulumi.output(availabilityZoneNames);
export const dbSubnetGroupName = dbSubnetGroup.name;
