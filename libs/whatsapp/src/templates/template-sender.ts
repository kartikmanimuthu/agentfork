import type { PrismaClient } from '@prisma/client';
import type { MetaWhatsAppClient } from '../client/meta-api';
import type { TemplateComponent } from '../client/types';

export interface SendTemplateInput {
  accountId: string;
  to: string;
  templateName: string;
  languageCode: string;
  components?: TemplateComponent[];
}

export class TemplateSender {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async send(input: SendTemplateInput, client: MetaWhatsAppClient): Promise<string> {
    const template = await (this.prisma as any).whatsAppTemplate.findFirst({
      where: {
        accountId: input.accountId,
        name: input.templateName,
        language: input.languageCode,
        status: 'APPROVED',
      },
    });

    if (!template) {
      throw new Error(`Template "${input.templateName}" (${input.languageCode}) not found or not approved`);
    }

    const result = await client.sendTemplateMessage(
      input.to,
      input.templateName,
      input.languageCode,
      input.components,
    );

    const messageId = result.messages[0].id;

    await (this.prisma as any).whatsAppMessage.create({
      data: {
        accountId: input.accountId,
        waMessageId: messageId,
        direction: 'outbound',
        contactPhone: input.to,
        type: 'template',
        content: {
          templateName: input.templateName,
          languageCode: input.languageCode,
          components: input.components,
        },
        status: 'sent',
      },
    });

    return messageId;
  }
}
