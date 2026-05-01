import { getPrismaClient } from './prisma-client';

export const TENANT_SCOPED_MODELS = new Set([
  'Conversation',
  'AuditLog',
  'CustomRole',
  'UserTenantRole',
  'TenantConfig',
  'Invitation',
]);

export function getTenantClient(tenantId: string) {
  if (!tenantId) throw new Error('getTenantClient: tenantId is required');
  const base = getPrismaClient();
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model: string | undefined;
          operation: string;
          args: Record<string, any>;
          query: (args: Record<string, any>) => Promise<unknown>;
        }) {
          if (!TENANT_SCOPED_MODELS.has(model ?? '')) {
            return query(args);
          }

          if (['findMany', 'findFirst', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy'].includes(operation)) {
            args = { ...args, where: { ...args.where, tenantId } };
          }

          if (operation === 'create') {
            args = { ...args, data: { ...args.data, tenantId } };
          }

          if (operation === 'createMany') {
            if (Array.isArray(args.data)) {
              args = { ...args, data: args.data.map((d: Record<string, unknown>) => ({ ...d, tenantId })) };
            } else {
              args = { ...args, data: { ...args.data, tenantId } };
            }
          }

          if (operation === 'upsert') {
            args = { ...args, where: { ...args.where, tenantId }, create: { ...args.create, tenantId } };
          }

          if (['update', 'updateMany'].includes(operation)) {
            args = { ...args, where: { ...args.where, tenantId } };
          }

          if (['delete', 'deleteMany'].includes(operation)) {
            args = { ...args, where: { ...args.where, tenantId } };
          }

          return query(args);
        },
      },
    },
  });
}
