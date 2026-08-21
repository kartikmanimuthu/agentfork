import type { ResolvedCaching } from './caching-config';

export interface EligibilityInput {
  noCache: boolean;
  hasMcpTools: boolean;
  hasBuiltInTools: boolean;
  hasSession: boolean;
  hasAttachments: boolean;
  hasKbContext: boolean;
  semanticKillSwitch: boolean;
}

export interface EligibilityResult {
  exactBlockers: string[];
  semanticBlockers: string[];
  exactEnabled: boolean;
  semanticEnabled: boolean;
}

export function computeCacheEligibility(
  caching: ResolvedCaching,
  input: EligibilityInput,
  exactTtlSeconds: number,
  semanticTtlSeconds: number,
): EligibilityResult {
  const hasTools = input.hasMcpTools || input.hasBuiltInTools;

  const exactBlockers: string[] = [];
  if (input.noCache) exactBlockers.push('no_cache');
  if (hasTools && !caching.exact.overrides.withTools) exactBlockers.push('tools');
  if (input.hasSession && !caching.exact.overrides.inSessions) exactBlockers.push('session');

  // Attachments and KB context gate the semantic tier only: the exact key already
  // includes both, so it cannot mismatch on them.
  const semanticBlockers: string[] = [];
  if (input.noCache) semanticBlockers.push('no_cache');
  if (hasTools && !caching.semantic.overrides.withTools) semanticBlockers.push('tools');
  if (input.hasSession && !caching.semantic.overrides.inSessions) semanticBlockers.push('session');
  if (input.hasAttachments && !caching.semantic.overrides.withAttachments)
    semanticBlockers.push('attachments');
  if (input.hasKbContext && !caching.semantic.overrides.withKnowledgeBase)
    semanticBlockers.push('kb_context');
  if (!caching.semantic.embeddingModel) semanticBlockers.push('no_embedding_model');
  if (!input.semanticKillSwitch) semanticBlockers.push('kill_switch');

  return {
    exactBlockers,
    semanticBlockers,
    exactEnabled: exactBlockers.length === 0 && caching.exact.enabled && exactTtlSeconds > 0,
    semanticEnabled:
      semanticBlockers.length === 0 && caching.semantic.enabled && semanticTtlSeconds > 0,
  };
}
