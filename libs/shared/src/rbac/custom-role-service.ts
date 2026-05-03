import { getPrismaClient } from '../db/prisma-client';
import type { PermissionSet } from './types';
import { getAutoLevel } from './permissions';

const MAX_CUSTOM_ROLES = 10;
const PREDEFINED_NAMES = new Set(['owner', 'admin', 'member', 'viewer']);

export interface CustomRoleInput {
  name: string;
  permissions: PermissionSet;
}

export interface CustomRoleOutput {
  id: string;
  tenantId: string;
  name: string;
  permissions: PermissionSet;
  level: number;
  createdAt: Date;
  updatedAt: Date;
}

function castRole(raw: {
  id: string;
  tenantId: string;
  name: string;
  permissions: unknown;
  level: number;
  createdAt: Date;
  updatedAt: Date;
}): CustomRoleOutput {
  return { ...raw, permissions: raw.permissions as PermissionSet };
}

function validateInput(input: CustomRoleInput): void {
  if (PREDEFINED_NAMES.has(input.name.toLowerCase())) {
    throw new Error(`Cannot use predefined role name: ${input.name}`);
  }
  const totalActions = Object.values(input.permissions).flat().length;
  if (totalActions === 0) {
    throw new Error('At least one permission action is required');
  }
}

export async function createCustomRole(
  tenantId: string,
  input: CustomRoleInput,
): Promise<CustomRoleOutput> {
  validateInput(input);

  const prisma = getPrismaClient();
  const count = await prisma.customRole.count({ where: { tenantId } });
  if (count >= MAX_CUSTOM_ROLES) {
    throw new Error(`Maximum of ${MAX_CUSTOM_ROLES} custom roles per tenant reached`);
  }

  const level = getAutoLevel(input.permissions);

  try {
    const role = await prisma.customRole.create({
      data: {
        tenantId,
        name: input.name,
        permissions: input.permissions as object,
        level,
      },
    });
    return castRole(role);
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
      throw new Error(`Role name '${input.name}' already exists in this tenant`);
    }
    throw err;
  }
}

export async function getCustomRoles(tenantId: string): Promise<CustomRoleOutput[]> {
  const prisma = getPrismaClient();
  const roles = await prisma.customRole.findMany({
    where: { tenantId },
    orderBy: { name: 'asc' },
  });
  return roles.map(castRole);
}

export async function getCustomRole(tenantId: string, roleId: string): Promise<CustomRoleOutput | null> {
  const prisma = getPrismaClient();
  const role = await prisma.customRole.findFirst({ where: { id: roleId, tenantId } });
  return role ? castRole(role) : null;
}

export async function updateCustomRole(
  tenantId: string,
  roleId: string,
  input: CustomRoleInput,
): Promise<CustomRoleOutput> {
  validateInput(input);

  const prisma = getPrismaClient();
  const level = getAutoLevel(input.permissions);

  const role = await prisma.customRole.update({
    where: { id: roleId },
    data: {
      name: input.name,
      permissions: input.permissions as object,
      level,
    },
  });
  return castRole(role);
}

export async function deleteCustomRole(tenantId: string, roleId: string): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.customRole.delete({ where: { id: roleId } });
    await tx.userTenantRole.updateMany({
      where: { tenantId, role: deleted.name },
      data: { role: 'Viewer' },
    });
  });
}

export async function getCustomRolePermissions(
  roleName: string,
  tenantId: string,
): Promise<PermissionSet | null> {
  const prisma = getPrismaClient();
  const role = await prisma.customRole.findFirst({
    where: { tenantId, name: roleName },
  });
  return role ? (role.permissions as PermissionSet) : null;
}
