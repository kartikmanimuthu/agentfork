import { getPrismaClient } from '@chatbot/shared';
import { TranscriptionUploadService } from '@chatbot/shared/server';
import fs from 'fs';
const db = getPrismaClient();
const svc = new TranscriptionUploadService('cms4vk4ve0001v8icz4jy80gb', db);
const result = await svc.createPresigned({
  apiKeyId: 'cms9y6q5a0001v82gkoly9tq2',
  fileName: 'stream-test.mp3',
  mimeType: 'audio/mpeg',
});
fs.writeFileSync(
  'C:/Users/N2092/AppData/Local/Temp/claude/c--Users-N2092-Desktop-tenant/1d627547-a5f5-484d-a83d-d5bf9c4a12f7/scratchpad/presign_fresh.json',
  JSON.stringify(result)
);
console.log('uploadId=' + result.uploadId);
process.exit(0);
