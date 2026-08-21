import { getPrismaClient } from '@chatbot/shared';
const db = getPrismaClient();
const providers = await db.llmProvider.findMany({
  select: { id: true, tenantId: true, name: true, providerType: true, region: true, chatModel: true, isDefault: true, updatedAt: true },
  orderBy: { updatedAt: 'desc' },
});
const claws = await db.claw.findMany({ select: { id: true, name: true, providerModelId: true, clawStudioId: true } });
const studios = await db.clawStudio.findMany({ select: { id: true, tenantId: true, studioId: true } });
const tenants = await db.tenant.findMany({ select: { id: true, name: true } });
const tname = (id: string) => tenants.find((t) => t.id === id)?.name ?? '?';
console.log('\nPROVIDERS');
for (const p of providers) console.log(` ${p.id}  tenant=${tname(p.tenantId).padEnd(18)} name=${String(p.name).padEnd(16)} type=${String(p.providerType).padEnd(10)} region=${String(p.region)} default=${p.isDefault} chatModel=${p.chatModel}`);
console.log('\nCLAWS');
for (const c of claws) {
  const s = studios.find((x) => x.id === c.clawStudioId);
  console.log(` ${c.id} name=${String(c.name).padEnd(12)} tenant=${tname(s?.tenantId ?? '')} providerModelId=${c.providerModelId}`);
}
await db.$disconnect();
