import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
}

let prismaClient: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV === 'production') {
    if (!prismaClient) {
      prismaClient = new PrismaClient({ log: ['error'] });
    }
    return prismaClient;
  }

  if (!globalThis.__prismaClient) {
    globalThis.__prismaClient = new PrismaClient({ log: ['query', 'error', 'warn'] });
  }
  return globalThis.__prismaClient;
}

export async function disconnectPrisma(): Promise<void> {
  const client = prismaClient ?? globalThis.__prismaClient;
  if (client) {
    await client.$disconnect();
  }
}
