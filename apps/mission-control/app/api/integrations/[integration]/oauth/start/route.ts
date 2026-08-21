import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createLogger } from '@chatbot/shared';
import { getIntegrationDescriptor, buildAuthorizeUrl, signOAuthState } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';
import { env } from '@/lib/env';

const logger = createLogger('mission-control:api:integrations:oauth:start');

function origin(): string {
  return env.NEXT_PUBLIC_MISSION_CONTROL_URL.replace(/\/+$/, '');
}

function redirectUriFor(integration: string): string {
  return `${origin()}/api/integrations/${integration}/oauth/callback`;
}

/**
 * Every response here is a full-page redirect — this route is reached via a
 * plain `<a href>` nav, not fetch(). OAuth-mode integrations have no detail
 * page of their own, so a failure here lands back on the integrations list,
 * which reads `error`/`integration` off the URL and toasts once.
 */
function errorRedirect(integration: string, error: string): NextResponse {
  const url = new URL(`${origin()}/integrations`);
  url.searchParams.set('error', error);
  url.searchParams.set('integration', integration);
  return NextResponse.redirect(url);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ integration: string }> }) {
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
    if (!descriptor) {
      return NextResponse.json({ success: false, error: 'Unknown integration' }, { status: 404 });
    }
    if (descriptor.authMode !== 'oauth' || !descriptor.oauth) {
      return NextResponse.json({ success: false, error: `${integration} does not use OAuth` }, { status: 400 });
    }

    try {
      descriptor.oauth.clientId();
      descriptor.oauth.clientSecret();
    } catch (error) {
      logger.warn({ error, integration }, 'OAuth start requested but the provider is not configured');
      return errorRedirect(integration, 'oauth_not_configured');
    }

    const state = signOAuthState(integration);
    const authorizeUrl = buildAuthorizeUrl(descriptor, redirectUriFor(integration), state);

    logger.info({ tenantId: session.studio.tenantId, integration }, 'Starting OAuth flow');
    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    logger.error({ error, integration }, 'OAuth start failed');
    return errorRedirect(integration, 'internal_error');
  }
}
