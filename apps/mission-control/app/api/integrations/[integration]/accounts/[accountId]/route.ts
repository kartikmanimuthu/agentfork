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

const logger = createLogger('mission-control:api:integrations:account');

// Updating an EXISTING account: every field optional (blank/omitted keeps the
// stored value, per IntegrationConfigService.saveAccount's rule), plus the
// account-level `makeDefault` toggle. `.strict()` per field-name whitelist.
const updateSchemas: Record<string, z.ZodType> = {
  github: z.object({ token: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  hubspot: z.object({ token: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  email: z
    .object({
      address: z.string().email().optional(),
      appPassword: z.string().optional(),
      imapHost: z.string().optional(),
      imapPort: z.string().optional(),
      smtpHost: z.string().optional(),
      smtpPort: z.string().optional(),
      makeDefault: z.boolean().optional(),
    })
    .strict(),
  jira: z
    .object({
      site: z.string().optional(),
      email: z.string().email().optional(),
      apiToken: z.string().optional(),
      makeDefault: z.boolean().optional(),
    })
    .strict(),
  linear: z.object({ apiKey: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  gitlab: z.object({ baseUrl: z.string().optional(), token: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  confluence: z
    .object({
      baseUrl: z.string().optional(),
      email: z.string().email().optional(),
      apiToken: z.string().optional(),
      makeDefault: z.boolean().optional(),
    })
    .strict(),
  zendesk: z
    .object({
      subdomain: z.string().optional(),
      email: z.string().email().optional(),
      apiToken: z.string().optional(),
      makeDefault: z.boolean().optional(),
    })
    .strict(),
  clickup: z.object({ apiToken: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  asana: z.object({ token: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  attio: z.object({ accessToken: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  apollo: z.object({ apiKey: z.string().optional(), label: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  hunter: z.object({ apiKey: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  close: z.object({ apiKey: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  stripe: z.object({ apiKey: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  quickbooks: z
    .object({
      accessToken: z.string().optional(),
      realmId: z.string().optional(),
      environment: z.string().optional(),
      makeDefault: z.boolean().optional(),
    })
    .strict(),
  docusign: z.object({ accessToken: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  dropbox: z.object({ accessToken: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  box: z.object({ accessToken: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  posthog: z
    .object({
      baseUrl: z.string().optional(),
      apiKey: z.string().optional(),
      projectId: z.string().optional(),
      makeDefault: z.boolean().optional(),
    })
    .strict(),
  mixpanel: z
    .object({
      username: z.string().optional(),
      secret: z.string().optional(),
      projectId: z.string().optional(),
      makeDefault: z.boolean().optional(),
    })
    .strict(),
  amplitude: z.object({ apiKey: z.string().optional(), secretKey: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  figma: z.object({ accessToken: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  canva: z.object({ accessToken: z.string().optional(), makeDefault: z.boolean().optional() }).strict(),
  whatsapp: z
    .object({
      accessToken: z.string().optional(),
      phoneNumberId: z.string().optional(),
      makeDefault: z.boolean().optional(),
    })
    .strict(),
};

// OAuth-mode accounts have no user-editable credential fields — the only
// legal PUT body is the account-level default toggle. Credentials only ever
// change via reconnecting through `oauth/start`.
const oauthUpdateSchema = z.object({ makeDefault: z.boolean().optional() }).strict();

async function resolve(params: Promise<{ integration: string; accountId: string }>) {
  const session = await getServerSession(authOptions);
  if (!session?.studio?.tenantId) {
    return { error: NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 }) };
  }
  const { integration, accountId } = await params;
  const descriptor = getIntegrationDescriptor(integration);
  if (!descriptor) {
    return { error: NextResponse.json({ success: false, error: 'Unknown integration' }, { status: 404 }) };
  }
  return {
    descriptor,
    accountId,
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ integration: string; accountId: string }> },
) {
  try {
    const ctx = await resolve(params);
    if ('error' in ctx) return ctx.error;

    const schema = ctx.descriptor.authMode === 'oauth' ? oauthUpdateSchema : updateSchemas[ctx.descriptor.name];
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }
    const { makeDefault, ...fields } = parsed.data as Record<string, string | boolean | undefined>;

    const configs = new IntegrationConfigService(ctx.tenantId, ctx.descriptor);
    const existing = await configs.getMaskedAccount(ctx.accountId);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Account not found' }, { status: 404 });
    }

    await configs.saveAccount(ctx.accountId, fields, ctx.actor, { makeDefault: makeDefault === true });

    AuditService.logUserAction({
      eventType: 'claw.integration.updated',
      action: 'Updated Claw Integration Account',
      resourceType: 'integration',
      resourceId: `${ctx.descriptor.name}:${ctx.accountId}`,
      resourceName: ctx.descriptor.displayName,
      user: ctx.actor,
      userType: 'user',
      status: 'success',
      severity: 'high',
      details: `Updated ${ctx.descriptor.displayName} account credentials`,
      apiRoute: `PUT /api/integrations/${ctx.descriptor.name}/accounts/${ctx.accountId}`,
      httpMethod: 'PUT',
      metadata: {
        tenantId: ctx.tenantId,
        integration: ctx.descriptor.name,
        accountId: ctx.accountId,
        fields: Object.keys(fields),
      },
      tenantId: ctx.tenantId,
    }).catch(() => {});

    return NextResponse.json({ success: true, data: await configs.getMaskedAccount(ctx.accountId) });
  } catch (error) {
    return handleError(error, 'Failed to update integration account');
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ integration: string; accountId: string }> },
) {
  try {
    const ctx = await resolve(params);
    if ('error' in ctx) return ctx.error;

    const configs = new IntegrationConfigService(ctx.tenantId, ctx.descriptor);
    await configs.removeAccount(ctx.accountId);

    AuditService.logUserAction({
      eventType: 'claw.integration.disconnected',
      action: 'Disconnected Claw Integration Account',
      resourceType: 'integration',
      resourceId: `${ctx.descriptor.name}:${ctx.accountId}`,
      resourceName: ctx.descriptor.displayName,
      user: ctx.actor,
      userType: 'user',
      status: 'success',
      severity: 'high',
      details: `Removed a connected ${ctx.descriptor.displayName} account`,
      apiRoute: `DELETE /api/integrations/${ctx.descriptor.name}/accounts/${ctx.accountId}`,
      httpMethod: 'DELETE',
      metadata: { tenantId: ctx.tenantId, integration: ctx.descriptor.name, accountId: ctx.accountId },
      tenantId: ctx.tenantId,
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error, 'Failed to remove integration account');
  }
}
