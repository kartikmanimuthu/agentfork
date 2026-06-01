import { getPrismaClient } from '@chatbot/shared/workers';
import PgBoss from 'pg-boss';
import { env } from '../env';

const db = getPrismaClient();

const doc = await db.document.findFirst({
  where: { status: 'PENDING' },
  include: { dataSource: { include: { knowledgeBase: true } } },
  orderBy: { createdAt: 'desc' },
});

if (!doc) {
  console.log('No pending documents found');
  await db.$disconnect();
  process.exit(0);
}

console.log('Re-queuing document:', doc.id, doc.fileName);

const boss = new PgBoss(env.DATABASE_URL);
await boss.start();

const jobId = await boss.send('document-ingestion', {
  documentId: doc.id,
  tenantId: doc.dataSource.knowledgeBase.tenantId,
  s3Key: doc.sourceKey,
  mimeType: doc.mimeType,
  knowledgeBaseId: doc.dataSource.knowledgeBaseId,
});

console.log('Job queued:', jobId);
await boss.stop();
await db.$disconnect();
