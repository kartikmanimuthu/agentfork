import { NextResponse } from 'next/server';
import { createLogger, getPrismaClient, firstChatCapableModel } from '@chatbot/shared';
import { ClawConnectorConfigService, getConnectorRegistry } from '@chatbot/claw-studio';
import { UnauthenticatedError, resolveClawForSession } from '@/lib/claw-resolver';

const logger = createLogger('mission-control:api:agent:summary');

/**
 * Counts for the Agent page's tab badges and Overview tiles. Deliberately cheap:
 * plain counts plus connector config reads, never a runtime resolve (that would
 * connect every MCP server just to render a number).
 */
export async function GET() {
  try {
    const { tenantId, clawId } = await resolveClawForSession();
    const db = getPrismaClient();

    const [files, skillsEnabled, skillsTotal, memories, mcpActive, mcpTotal, claw, provider] =
      await Promise.all([
        db.clawFile.count({ where: { clawId } }),
        db.clawSkill.count({ where: { tenantId, isEnabled: true } }),
        db.clawSkill.count({ where: { tenantId } }),
        db.clawMemory.count({ where: { tenantId } }),
        db.mcpServer.count({ where: { tenantId, status: 'active' } }),
        db.mcpServer.count({ where: { tenantId } }),
        db.claw.findUnique({ where: { id: clawId } }),
        db.llmProvider.findFirst({ where: { tenantId, isDefault: true } }),
      ]);

    // `provider` above is the tenant's isDefault row, but `resolveClawRuntime`
    // runs on `claw.providerModelId` when one is set (claw-runtime.ts:252) — so
    // reporting the default here named the wrong model for any Claw pinned to a
    // specific provider, which is now every Claw whose model was switched from
    // the chat header. Resolved second rather than in the batch above because it
    // depends on `claw`, which that batch is what fetches.
    const pinnedProvider = claw?.providerModelId
      ? await db.llmProvider.findFirst({ where: { id: claw.providerModelId, tenantId } })
      : null;
    const activeProvider = pinnedProvider ?? provider;

    const configs = new ClawConnectorConfigService(tenantId);
    const channels = await Promise.all(
      getConnectorRegistry().list().map(async (connector) => {
        try {
          const masked = await configs.getMasked(connector.channelType);
          return {
            channel: connector.channelType,
            displayName: connector.displayName,
            configured: masked.configured,
            enabled: masked.enabled,
          };
        } catch (error) {
          // A missing ENCRYPTION_KEY must not blank the whole page.
          logger.warn({ error, channel: connector.channelType }, 'Could not read connector config');
          return {
            channel: connector.channelType,
            displayName: connector.displayName,
            configured: false,
            enabled: false,
          };
        }
      }),
    );

    return NextResponse.json({
      success: true,
      data: {
        files,
        skills: { enabled: skillsEnabled, total: skillsTotal },
        memories,
        mcp: { active: mcpActive, total: mcpTotal },
        channels,
        channelsEnabled: channels.filter((c) => c.enabled).length,
        autoApprove: claw?.autoApprove ?? false,
        // Seeds the chat header's model dropdown so it opens on the model that
        // is actually in use, rather than always reading "Claw's default".
        providerModelId: claw?.providerModelId ?? null,
        // Which model WITHIN that provider is pinned. A provider serves many
        // (the self-hosted gateway fronts the whole llm-powerhouse fleet), so
        // the provider id alone cannot seed the chat header's dropdown.
        chatModel:
          (typeof (claw?.settings as { chatModel?: unknown } | null)?.chatModel === 'string'
            ? ((claw!.settings as { chatModel: string }).chatModel)
            : null),
        // The tenant default, reported ALONGSIDE the pin rather than folded into
        // it. An unpinned Claw already runs on this provider — resolveClawRuntime
        // calls getDefaultConfig() when claw.providerModelId is null
        // (claw-runtime.ts:273) — but the header had no way to name it, so it
        // fell back to the generic "Default model" and looked unset.
        //
        // Kept as its own field because /api/chat PERSISTS any providerModelId the
        // client sends (route.ts:198). Folding the default into `providerModelId`
        // would make the first message silently pin this Claw to whichever provider
        // happened to be default then, so a later change in the LLM Providers tab
        // would stop reaching it — the opposite of following the default.
        defaultProviderModelId: provider?.id ?? null,
        // Mirrors buildConfig's own fallback, so the picker names the model the
        // runtime will actually use. Reading provider.chatModel alone showed
        // "Default model" for a provider saved without one — the exact case that
        // made users pick a model by hand on every fresh thread.
        defaultChatModel: provider?.chatModel ?? firstChatCapableModel(provider?.models) ?? null,
        provider: activeProvider
          ? {
              name: activeProvider.name,
              providerType: activeProvider.providerType,
              chatModel: activeProvider.chatModel ?? firstChatCapableModel(activeProvider.models),
            }
          : null,
      },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to build agent summary');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
