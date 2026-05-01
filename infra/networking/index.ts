import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';

const config = new pulumi.Config();
const vpcCidrConfig = config.get('vpcCidr') ?? '10.0.0.0/16';
const appName = 'chatbot';

const vpc = new awsx.ec2.Vpc(`${appName}-vpc`, {
  cidrBlock: vpcCidrConfig,
  availabilityZoneNames: ['ap-south-1a', 'ap-south-1b'],
  enableDnsHostnames: true,
  enableDnsSupport: true,
  natGateways: { strategy: 'OnePerAz' },
  subnetSpecs: [
    { type: 'Private', name: 'private', cidrBlocks: ['10.0.0.0/22', '10.0.4.0/22'] },
    { type: 'Public', name: 'public', cidrBlocks: ['10.0.8.0/24', '10.0.9.0/24'] },
    { type: 'Isolated', name: 'database', cidrBlocks: ['10.0.10.0/24', '10.0.11.0/24'] },
    { type: 'Isolated', name: 'intra', cidrBlocks: ['10.0.12.0/26', '10.0.12.64/26'] },
  ],
  tags: { Name: `${appName}-vpc` },
});

const databaseSubnetIds: pulumi.Output<string[]> = vpc.subnets
  .apply((subnets) =>
    pulumi.all(
      subnets.map((s) =>
        pulumi.all([s.id, s.tags] as const).apply(([id, tags]) => ({
          id,
          name: (tags ?? {})['Name'] ?? '',
        })),
      ),
    ),
  )
  .apply((items) => items.filter((item) => item.name.includes('-database-')).map((item) => item.id));

const region = aws.config.region ?? 'ap-south-1';

const s3Endpoint = new aws.ec2.VpcEndpoint(`${appName}-endpoint-s3`, {
  vpcId: vpc.vpcId,
  serviceName: pulumi.interpolate`com.amazonaws.${region}.s3`,
  vpcEndpointType: 'Gateway',
  tags: { Name: `${appName}-endpoint-s3` },
});

const dbSubnetGroup = new aws.rds.SubnetGroup(`${appName}-db-subnet-group`, {
  name: `${appName}-db-subnet-group`,
  description: 'Subnet group for RDS databases',
  subnetIds: databaseSubnetIds,
  tags: { Name: `${appName}-db-subnet-group` },
});

export const vpcId = vpc.vpcId;
export const vpcCidr = vpc.vpc.cidrBlock;
export const publicSubnetIds = vpc.publicSubnetIds;
export const privateSubnetIds = vpc.privateSubnetIds;
export { databaseSubnetIds };
export const availabilityZones = pulumi.output(['ap-south-1a', 'ap-south-1b']);
export const dbSubnetGroupName = dbSubnetGroup.name;
