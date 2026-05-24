import crypto from 'crypto';
import { createLogger } from '../logging/logger';

const logger = createLogger('sdk-widget-service');

export interface SdkWidgetDb {
  sdkWidget: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findFirst(args: { where: Record<string, unknown>; include?: Record<string, unknown> }): Promise<unknown | null>;
    findMany(args: { where: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<unknown[]>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
    delete(args: { where: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface CreateSdkWidgetInput {
  agentId: string;
  apiKeyId: string;
  name: string;
  primaryColor?: string;
  secondaryColor?: string;
  theme?: string;
  position?: string;
  headerText?: string;
  botName?: string;
  welcomeMessage?: string;
  inputPlaceholder?: string;
}

export class SdkWidgetService {
  constructor(
    private readonly tenantId: string,
    private readonly db: SdkWidgetDb
  ) {}

  private generateSdkId(): string {
    return `sdk_${crypto.randomBytes(6).toString('hex')}`;
  }

  async create(input: CreateSdkWidgetInput): Promise<unknown> {
    const sdkId = this.generateSdkId();
    logger.info({ tenantId: this.tenantId, agentId: input.agentId, sdkId }, 'Creating SDK widget');

    return this.db.sdkWidget.create({
      data: {
        tenantId: this.tenantId,
        sdkId,
        ...input,
      },
    });
  }

  async findBySdkId(sdkId: string): Promise<unknown | null> {
    return this.db.sdkWidget.findFirst({
      where: { sdkId, status: 'active' },
      include: { agent: true, apiKey: true },
    });
  }

  async findById(id: string): Promise<unknown | null> {
    return this.db.sdkWidget.findFirst({
      where: { id, tenantId: this.tenantId },
      include: { agent: true, apiKey: true },
    });
  }

  async update(id: string, data: Record<string, unknown>): Promise<unknown> {
    logger.info({ tenantId: this.tenantId, widgetId: id }, 'Updating SDK widget');
    return this.db.sdkWidget.update({
      where: { id },
      data,
    });
  }

  async listByTenant(): Promise<unknown[]> {
    return this.db.sdkWidget.findMany({
      where: { tenantId: this.tenantId },
      include: { agent: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async delete(id: string): Promise<unknown> {
    logger.info({ tenantId: this.tenantId, widgetId: id }, 'Deleting SDK widget');
    return this.db.sdkWidget.delete({ where: { id } });
  }
}
