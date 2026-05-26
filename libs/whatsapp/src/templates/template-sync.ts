import type { PrismaClient } from '@prisma/client';

export class TemplateSyncService {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async syncFromMeta(accountId: string, accessToken: string, wabaId: string, apiVersion: string): Promise<number> {
    const response = await fetch(
      `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch templates: ${response.status}`);
    }

    const data = await response.json();
    const templates = data.data ?? [];
    let synced = 0;

    for (const tmpl of templates) {
      await (this.prisma as any).whatsAppTemplate.upsert({
        where: {
          accountId_name_language: { accountId, name: tmpl.name, language: tmpl.language },
        },
        update: { category: tmpl.category, status: tmpl.status, components: tmpl.components },
        create: {
          accountId,
          name: tmpl.name,
          language: tmpl.language,
          category: tmpl.category,
          status: tmpl.status,
          components: tmpl.components,
        },
      });
      synced++;
    }

    return synced;
  }
}
