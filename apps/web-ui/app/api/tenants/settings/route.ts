import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getPrismaClient, getSessionTenantId, authorize, TenantConfigService, AuditService } from '@chatbot/shared';
import type { TenantLLMConfig } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().optional(),
  notifications: z.object({
    scheduleExecutions: z.boolean().optional(),
    memberInvites: z.boolean().optional(),
    systemAlerts: z.boolean().optional(),
  }).optional(),
  llmConfig: z.object({
    provider: z.enum(['bedrock', 'openai']),
    chatModel: z.string().optional(),
    embeddingModel: z.string().optional(),
    embeddingDimensions: z.number().optional(),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
  }).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Settings', authOptions);
    if (authError) return authError;

    const prisma = getPrismaClient();
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const configService = new TenantConfigService(tenantId);
    const [timezone, notifications, llmConfig] = await Promise.all([
      configService.get<string>('timezone'),
      configService.get<Record<string, boolean>>('notifications'),
      configService.get<TenantLLMConfig>('llmConfig'),
    ]);

    const sanitizedLlmConfig = llmConfig
      ? { ...llmConfig, apiKey: llmConfig.apiKey ? '••••••' : undefined }
      : null;

    return NextResponse.json({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      timezone: timezone ?? 'UTC',
      notifications: {
        scheduleExecutions: true,
        memberInvites: true,
        systemAlerts: true,
        ...notifications,
      },
      llmConfig: sanitizedLlmConfig,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Settings', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ?? 'system';

    const prisma = getPrismaClient();
    const { name, timezone, notifications } = parsed.data;

    const currentTenant = name ? await prisma.tenant.findUnique({ where: { id: tenantId } }) : null;
    const currentName = currentTenant?.name;

    if (name) {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { name },
      });
    }

    const configService = new TenantConfigService(tenantId);
    if (timezone !== undefined) {
      await configService.set('timezone', timezone, userId);
    }
    if (notifications !== undefined) {
      await configService.set('notifications', notifications, userId);
    }
    if (parsed.data.llmConfig !== undefined) {
      const existingLlmConfig = await configService.get<TenantLLMConfig>('llmConfig');
      const merged: TenantLLMConfig = {
        ...(existingLlmConfig ?? {}),
        ...parsed.data.llmConfig,
      };
      // If apiKey is missing, empty, or masked, keep existing
      if (
        !parsed.data.llmConfig.apiKey ||
        parsed.data.llmConfig.apiKey === '' ||
        parsed.data.llmConfig.apiKey === '••••••'
      ) {
        merged.apiKey = existingLlmConfig?.apiKey;
      }
      await configService.set('llmConfig', merged, userId);
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const [savedTimezone, savedNotifications, savedLlmConfig] = await Promise.all([
      configService.get<string>('timezone'),
      configService.get<Record<string, boolean>>('notifications'),
      configService.get<TenantLLMConfig>('llmConfig'),
    ]);

    const sanitizedLlmConfig = savedLlmConfig
      ? { ...savedLlmConfig, apiKey: savedLlmConfig.apiKey ? '••••••' : undefined }
      : null;

    AuditService.logUserAction({
      eventType: 'tenant.organization.updated',
      action: 'Updated Organization Settings',
      resourceType: 'tenant',
      resourceId: tenantId,
      resourceName: name || tenant?.name || tenantId,
      user: session?.user?.email || session?.user?.id || 'unknown',
      userType: 'user',
      status: 'success',
      severity: 'medium',
      details: `Updated organization settings for ${tenantId}`,
      apiRoute: 'PUT /api/tenants/settings',
      httpMethod: 'PUT',
      metadata: { tenantId, name, timezone, notifications, llmProvider: parsed.data.llmConfig?.provider },
      tenantId,
      changeSet: { before: { name: currentName }, after: { name: tenant?.name } },
    }).catch(() => {});

    return NextResponse.json({
      id: tenant?.id,
      name: tenant?.name,
      slug: tenant?.slug,
      status: tenant?.status,
      timezone: savedTimezone ?? 'UTC',
      notifications: {
        scheduleExecutions: true,
        memberInvites: true,
        systemAlerts: true,
        ...savedNotifications,
      },
      llmConfig: sanitizedLlmConfig,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
