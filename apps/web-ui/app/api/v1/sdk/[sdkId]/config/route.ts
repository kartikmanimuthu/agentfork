import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, createLogger } from '@chatbot/shared';

const logger = createLogger('api:sdk:config');

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sdkId: string }> }
) {
  const { sdkId } = await params;

  try {
    const db = getPrismaClient();
    const widget = await db.sdkWidget.findFirst({
      where: { sdkId, status: 'active' },
      include: {
        apiKey: { select: { id: true, keyPrefix: true, status: true } },
      },
    });

    if (!widget) {
      return NextResponse.json(
        { error: { type: 'not_found', message: 'Widget not found or inactive' } },
        { status: 404 }
      );
    }

    // CORS origin validation
    const origin = req.headers.get('origin');
    if (widget.allowedOrigins.length > 0 && origin) {
      const allowed = widget.allowedOrigins.some(
        (o: string) => o === '*' || o === origin || origin.endsWith(o.replace('*.', '.'))
      );
      if (!allowed) {
        logger.warn({ sdkId, origin, allowedOrigins: widget.allowedOrigins }, 'Origin not allowed');
        return NextResponse.json(
          { error: { type: 'forbidden', message: 'Origin not allowed' } },
          { status: 403 }
        );
      }
    }

    // Verify linked API key is active
    if (!widget.apiKey || widget.apiKey.status !== 'active') {
      logger.error({ sdkId, apiKeyId: widget.apiKeyId }, 'Linked API key not found or inactive');
      return NextResponse.json(
        { error: { type: 'configuration_error', message: 'Widget API key is invalid' } },
        { status: 500 }
      );
    }

    const config = {
      agentId: widget.agentId,
      apiKeyPrefix: widget.apiKey.keyPrefix,
      theme: widget.theme,
      primaryColor: widget.primaryColor,
      secondaryColor: widget.secondaryColor,
      position: widget.position,
      headerText: widget.headerText,
      headerIcon: widget.headerIcon,
      botName: widget.botName,
      botAvatar: widget.botAvatar,
      welcomeMessage: widget.welcomeMessage,
      inputPlaceholder: widget.inputPlaceholder,
      preChatForm: widget.preChatForm,
      quickReplies: widget.quickReplies,
      proactiveRules: widget.proactiveRules,
      kbEnabled: widget.kbEnabled,
      fileUpload: widget.fileUpload,
      csatEnabled: widget.csatEnabled,
      csatType: widget.csatType,
    };

    const headers: Record<string, string> = {
      'Cache-Control': 'public, max-age=300',
    };

    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Content-Type';
    }

    return NextResponse.json(config, { headers });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err: err.message, sdkId }, 'Failed to fetch SDK config');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Failed to fetch config' } },
      { status: 500 }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '*';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
