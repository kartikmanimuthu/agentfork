import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { createLogger, AuditService } from '@chatbot/shared';
import {
  getIntegrationDescriptor,
  IntegrationConfigService,
  ConnectorEncryptionUnavailableError,
} from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:integrations:detail');

// Per-integration field whitelist for adding a NEW account. `.strict()` so a
// typo'd field name is a 400 rather than silently writing an ignored key.
// `accountId` is never accepted here — it's always derived from verify().
const fieldSchemas: Record<string, z.ZodType> = {
  github: z.object({ token: z.string().min(1) }).strict(),
  hubspot: z.object({ token: z.string().min(1) }).strict(),
  email: z
    .object({
      address: z.string().email(),
      appPassword: z.string().min(1),
      imapHost: z.string().optional(),
      imapPort: z.string().optional(),
      smtpHost: z.string().optional(),
      smtpPort: z.string().optional(),
    })
    .strict(),
  jira: z.object({ site: z.string().min(1), email: z.string().email(), apiToken: z.string().min(1) }).strict(),
  linear: z.object({ apiKey: z.string().min(1) }).strict(),
  gitlab: z.object({ baseUrl: z.string().optional(), token: z.string().min(1) }).strict(),
  confluence: z.object({ baseUrl: z.string().min(1), email: z.string().email(), apiToken: z.string().min(1) }).strict(),
  zendesk: z.object({ subdomain: z.string().min(1), email: z.string().email(), apiToken: z.string().min(1) }).strict(),
  clickup: z.object({ apiToken: z.string().min(1) }).strict(),
  asana: z.object({ token: z.string().min(1) }).strict(),
  attio: z.object({ accessToken: z.string().min(1) }).strict(),
  apollo: z.object({ apiKey: z.string().min(1), label: z.string().optional() }).strict(),
  hunter: z.object({ apiKey: z.string().min(1) }).strict(),
  close: z.object({ apiKey: z.string().min(1) }).strict(),
  stripe: z.object({ apiKey: z.string().min(1) }).strict(),
  quickbooks: z.object({ accessToken: z.string().min(1), realmId: z.string().min(1), environment: z.string().optional() }).strict(),
  docusign: z.object({ accessToken: z.string().min(1) }).strict(),
  dropbox: z.object({ accessToken: z.string().min(1) }).strict(),
  box: z.object({ accessToken: z.string().min(1) }).strict(),
  posthog: z.object({ baseUrl: z.string().optional(), apiKey: z.string().min(1), projectId: z.string().min(1) }).strict(),
  mixpanel: z.object({ username: z.string().min(1), secret: z.string().min(1), projectId: z.string().min(1) }).strict(),
  amplitude: z.object({ apiKey: z.string().min(1), secretKey: z.string().min(1) }).strict(),
  figma: z.object({ accessToken: z.string().min(1) }).strict(),
  canva: z.object({ accessToken: z.string().min(1) }).strict(),
  whatsapp: z.object({ accessToken: z.string().min(1), phoneNumberId: z.string().min(1) }).strict(),
};

async function resolve(params: Promise<{ integration: string }>) {
  const session = await getServerSession(authOptions);
  if (!session?.studio?.tenantId) {
    return { error: NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 }) };
  }
  const { integration } = await params;
  const descriptor = getIntegrationDescriptor(integration);
  if (!descriptor) {
    return { error: NextResponse.json({ success: false, error: 'Unknown integration' }, { status: 404 }) };
  }
  return {
    descriptor,
    tenantId: session.studio.tenantId,
    actor: session.studio.studioId,
  };
}

function handleError(error: unknown, message: string) {
  if (error instanceof ConnectorEncryptionUnavailableError) {
    logger.error({ error }, message);
    return NextResponse.json({ success: false, error: error.message }, { status: 503 });
  }
  logger.error({ error }, message);
  return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ integration: string }> }) {
  try {
    const ctx = await resolve(params);
    if ('error' in ctx) return ctx.error;

    const accounts = await new IntegrationConfigService(ctx.tenantId, ctx.descriptor).listAccounts();

    return NextResponse.json({
      success: true,
      data: {
        name: ctx.descriptor.name,
        displayName: ctx.descriptor.displayName,
        description: ctx.descriptor.description,
        accountMode: ctx.descriptor.accountMode,
        authMode: ctx.descriptor.authMode,
        accounts,
      },
    });
  } catch (error) {
    return handleError(error, 'Failed to fetch integration accounts');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ integration: string }> }) {
  try {
    const ctx = await resolve(params);
    if ('error' in ctx) return ctx.error;

    if (ctx.descriptor.authMode === 'oauth') {
      return NextResponse.json(
        { success: false, error: 'Connect via OAuth, not manual credentials — use "Connect with…" on this integration\'s page.' },
        { status: 400 },
      );
    }

    const schema = fieldSchemas[ctx.descriptor.name];
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }
    const fields = parsed.data as Record<string, string>;

    // Live-verify before ever touching storage — for a single-account
    // integration this just proves the credential works; for multi-account,
    // the accountId itself is derived from this call's result, so there is no
    // valid storage key without it succeeding first.
    const verified = await ctx.descriptor.verify(fields);
    if (!verified.ok) {
      return NextResponse.json({ success: false, error: verified.error }, { status: 400 });
    }

    const accountId = ctx.descriptor.accountMode === 'single' ? 'default' : verified.meta?.accountId;
    if (!accountId) {
      logger.error({ integration: ctx.descriptor.name }, 'Multi-account integration verify() returned no accountId');
      return NextResponse.json({ success: false, error: 'Could not determine an account id for this connection' }, { status: 500 });
    }

    const configs = new IntegrationConfigService(ctx.tenantId, ctx.descriptor);
    await configs.saveAccount(accountId, fields, ctx.actor, { label: verified.meta?.label });

    AuditService.logUserAction({
      eventType: 'claw.integration.connected',
      action: 'Connected Claw Integration',
      resourceType: 'integration',
      resourceId: `${ctx.descriptor.name}:${accountId}`,
      resourceName: ctx.descriptor.displayName,
      user: ctx.actor,
      userType: 'user',
      status: 'success',
      severity: 'high',
      details: `Connected a new ${ctx.descriptor.displayName} account`,
      apiRoute: `POST /api/integrations/${ctx.descriptor.name}`,
      httpMethod: 'POST',
      // Field NAMES only, plus the structural accountId — never credential values.
      metadata: { tenantId: ctx.tenantId, integration: ctx.descriptor.name, accountId, fields: Object.keys(fields) },
      tenantId: ctx.tenantId,
    }).catch(() => {});

    return NextResponse.json({ success: true, data: await configs.getMaskedAccount(accountId) });
  } catch (error) {
    return handleError(error, 'Failed to connect integration account');
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ integration: string }> }) {
  try {
    const ctx = await resolve(params);
    if ('error' in ctx) return ctx.error;

    await new IntegrationConfigService(ctx.tenantId, ctx.descriptor).disconnectAll();

    AuditService.logUserAction({
      eventType: 'claw.integration.disconnected_all',
      action: 'Disconnected Claw Integration',
      resourceType: 'integration',
      resourceId: ctx.descriptor.name,
      resourceName: ctx.descriptor.displayName,
      user: ctx.actor,
      userType: 'user',
      status: 'success',
      severity: 'high',
      details: `Removed every connected ${ctx.descriptor.displayName} account`,
      apiRoute: `DELETE /api/integrations/${ctx.descriptor.name}`,
      httpMethod: 'DELETE',
      metadata: { tenantId: ctx.tenantId, integration: ctx.descriptor.name },
      tenantId: ctx.tenantId,
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error, 'Failed to disconnect integration');
  }
}
