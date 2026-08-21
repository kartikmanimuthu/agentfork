import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createLogger, AuditService } from '@chatbot/shared';
import { getIntegrationDescriptor, verifyOAuthState, completeOAuthCallback } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';
import { env } from '@/lib/env';

const logger = createLogger('mission-control:api:integrations:oauth:callback');

function origin(): string {
  return env.NEXT_PUBLIC_MISSION_CONTROL_URL.replace(/\/+$/, '');
}

function redirectUriFor(integration: string): string {
  return `${origin()}/api/integrations/${integration}/oauth/callback`;
}

/**
 * Every response here is a redirect — the provider sends the browser here
 * directly, there's no fetch() caller to hand a JSON body to. OAuth-mode
 * integrations have no detail page of their own (see integration-accounts-form.tsx),
 * so every outcome — success or failure — lands back on the integrations list,
 * which reads `connected`/`error`/`integration` off the URL and toasts once.
 */
function errorRedirect(integration: string, error: string): NextResponse {
  const url = new URL(`${origin()}/integrations`);
  url.searchParams.set('error', error);
  url.searchParams.set('integration', integration);
  return NextResponse.redirect(url);
}

function successRedirect(integration: string): NextResponse {
  const url = new URL(`${origin()}/integrations`);
  url.searchParams.set('connected', integration);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ integration: string }> }) {
  const { integration } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      // Concatenated, not new URL('/login', origin()) — a leading slash resets to the
      // host root and would drop the basePath, landing on web-ui instead.
      const loginUrl = new URL(`${origin()}/login`);
      loginUrl.searchParams.set('callbackUrl', '/integrations');
      return NextResponse.redirect(loginUrl);
    }

    const descriptor = getIntegrationDescriptor(integration);
    if (!descriptor || descriptor.authMode !== 'oauth' || !descriptor.oauth) {
      return errorRedirect(integration, 'unknown_integration');
    }

    const url = req.nextUrl;
    const providerError = url.searchParams.get('error');
    if (providerError) {
      // The user declined consent (or the provider otherwise refused) — no
      // code was ever issued, so there's nothing to exchange.
      logger.info({ integration, providerError }, 'OAuth provider returned an error before any code was issued');
      return errorRedirect(integration, providerError === 'access_denied' ? 'cancelled' : providerError);
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      return errorRedirect(integration, 'missing_code_or_state');
    }
    if (!verifyOAuthState(integration, state)) {
      logger.warn({ integration }, 'OAuth callback state failed verification');
      return errorRedirect(integration, 'invalid_state');
    }

    const tenantId = session.studio.tenantId;
    const actor = session.studio.studioId;

    const result = await completeOAuthCallback(descriptor, tenantId, actor, code, redirectUriFor(integration));
    if (!result.ok) {
      return errorRedirect(integration, result.error ?? 'oauth_failed');
    }

    AuditService.logUserAction({
      eventType: 'claw.integration.connected',
      action: 'Connected Claw Integration',
      resourceType: 'integration',
      resourceId: `${descriptor.name}:${result.accountId}`,
      resourceName: descriptor.displayName,
      user: actor,
      userType: 'user',
      status: 'success',
      severity: 'high',
      details: `Connected a new ${descriptor.displayName} account via OAuth`,
      apiRoute: `GET /api/integrations/${descriptor.name}/oauth/callback`,
      httpMethod: 'GET',
      metadata: { tenantId, integration: descriptor.name, accountId: result.accountId },
      tenantId,
    }).catch(() => {});

    return successRedirect(integration);
  } catch (error) {
    logger.error({ error, integration }, 'OAuth callback failed');
    return errorRedirect(integration, 'internal_error');
  }
}
