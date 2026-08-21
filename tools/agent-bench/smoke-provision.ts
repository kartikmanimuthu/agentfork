import { provisionBenchEnv, resetBenchState, assertBenchTenant, BENCH_TENANT_NAME } from './bench-env';
import { getPrismaClient } from '@chatbot/shared';

const env = await provisionBenchEnv();
console.log('PROVISIONED', JSON.stringify(env, null, 1));

await assertBenchTenant(env.tenantId);
console.log('GUARD OK — tenant is', BENCH_TENANT_NAME);

await resetBenchState(env);
const db = getPrismaClient();
console.log('after reset →', {
  files: await db.clawFile.count({ where: { clawId: env.clawId } }),
  memories: await db.clawMemory.count({ where: { tenantId: env.tenantId } }),
});

// Prove the guard fails closed on a real tenant.
const other = await db.tenant.findFirst({ where: { name: { not: BENCH_TENANT_NAME } }, select: { id: true, name: true } });
if (other) {
  try {
    await assertBenchTenant(other.id);
    console.log('GUARD FAILED — it accepted a non-bench tenant!');
  } catch (e) {
    console.log('GUARD correctly refused tenant', JSON.stringify(other.name), '→', (e as Error).message.slice(0, 80));
  }
}
await db.$disconnect();
