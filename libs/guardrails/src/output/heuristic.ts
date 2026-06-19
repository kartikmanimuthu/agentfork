import type { GuardrailsConfig } from '../config/schema';
import { secretDetectRule } from '../rules/secret-detect';
import type { RuleContext, RuleFinding } from '../rules/types';

export function outputLooksSuspicious(text: string, cfg: GuardrailsConfig): boolean {
  // Cheap banned-phrase hit
  if (cfg.output.bannedPhrases.phrases.length) {
    const hit = cfg.output.bannedPhrases.phrases.some((p) => {
      try { return new RegExp(p, 'i').test(text); } catch { return text.toLowerCase().includes(p.toLowerCase()); }
    });
    if (hit) return true;
  }
  // Cheap secret-pattern hit
  if (cfg.output.secretDetection.enabled) {
    const rc: RuleContext = { config: cfg, tenantId: '', agentId: '', phase: 'output' };
    const f = secretDetectRule.evaluate(text, rc) as RuleFinding;
    if (f.matched) return true;
  }
  // Cheap denied-subject hit
  if (cfg.output.topicFence.deniedSubjects?.length) {
    const hit = cfg.output.topicFence.deniedSubjects.some((s) => {
      try { return new RegExp(s, 'i').test(text); } catch { return text.toLowerCase().includes(s.toLowerCase()); }
    });
    if (hit) return true;
  }
  return false;
}