'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
// Client-safe guardrails config/schema/types come from @chatbot/shared/client, NOT @chatbot/guardrails.
// The guardrails barrel transitively imports @chatbot/ai (via refusal-response.ts) → pdf-parse → Node
// 'fs', which breaks client bundling. The config schema's canonical home is shared (client-safe).
import { defaultGuardrailsConfig, guardrailsConfigSchema, type GuardrailsConfig } from '@chatbot/shared/client';
import type { SimpleAgentConfig } from '@chatbot/agent-studio';

interface Props {
  config: SimpleAgentConfig;
  onSave: (config: SimpleAgentConfig) => Promise<void>;
  saving?: boolean;
}

/**
 * Deep-merge a partial stored guardrails config over the full defaults.
 *
 * Zod v4 has a nested-default cascade gap: `.default({})` on a parent object is
 * returned verbatim without re-parsing the nested schemas, so
 * `guardrailsConfigSchema.parse(partial)` does NOT reliably fill nested
 * defaults. An agent saved before full defaults (or from an older UI) can have
 * a partial `config.guardrails` like `{ enabled: true }` with no `input`/`output`/
 * `judge`/`audit`. Rendering such a partial directly throws because the
 * component reads `gr.input.piiRedaction.enabled` etc.
 *
 * This helper guarantees every nested field is present from defaults while
 * letting stored values override. Arrays are treated as leaf values (override
 * wins when present in the stored config).
 */
function mergeGuardrailsConfig(base: GuardrailsConfig, override: unknown): GuardrailsConfig {
  if (!override || typeof override !== 'object') return base;
  const o = override as Record<string, unknown>;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(o)) {
    const bv = (base as Record<string, unknown>)[key];
    const ov = o[key];
    if (
      ov !== null &&
      typeof ov === 'object' &&
      !Array.isArray(ov) &&
      bv !== null &&
      typeof bv === 'object' &&
      !Array.isArray(bv)
    ) {
      out[key] = mergeGuardrailsConfig(bv as GuardrailsConfig, ov);
    } else if (ov !== undefined) {
      out[key] = ov;
    }
  }
  return out as GuardrailsConfig;
}

export function GuardrailsTab({ config, onSave, saving }: Props) {
  const initialConfig = config.guardrails
    ? mergeGuardrailsConfig(defaultGuardrailsConfig(), config.guardrails)
    : defaultGuardrailsConfig();
  const [gr, setGr] = useState<GuardrailsConfig>(initialConfig);

  const update = (patch: Partial<GuardrailsConfig>) => setGr((p) => ({ ...p, ...patch }));
  const updateInput = (patch: Partial<GuardrailsConfig['input']>) =>
    setGr((p) => ({ ...p, input: { ...p.input, ...patch } }));
  const updateOutput = (patch: Partial<GuardrailsConfig['output']>) =>
    setGr((p) => ({ ...p, output: { ...p.output, ...patch } }));

  const save = async () => {
    const parsed = guardrailsConfigSchema.safeParse(gr);
    if (!parsed.success) {
      toast.error('Invalid guardrail config: ' + parsed.error.issues[0]?.message);
      return;
    }
    await onSave({ ...config, guardrails: parsed.data });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Guardrails</CardTitle>
            <CardDescription>
              Input/output moderation, PII/secret redaction, and topic fences for this agent.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="gr-enabled" className="text-sm">
              Enabled
            </Label>
            <Switch
              id="gr-enabled"
              checked={gr.enabled}
              onCheckedChange={(v) => update({ enabled: v })}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Input section */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">Input</h3>
          <div className="flex items-center justify-between">
            <Label>PII redaction</Label>
            <Switch
              checked={gr.input.piiRedaction.enabled}
              onCheckedChange={(v) =>
                updateInput({ piiRedaction: { ...gr.input.piiRedaction, enabled: v } })
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Secret detection</Label>
            <Switch
              checked={gr.input.secretDetection.enabled}
              onCheckedChange={(v) =>
                updateInput({ secretDetection: { ...gr.input.secretDetection, enabled: v } })
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Injection detection</Label>
            <Switch
              checked={gr.input.injectionDetection.enabled}
              onCheckedChange={(v) =>
                updateInput({
                  injectionDetection: { ...gr.input.injectionDetection, enabled: v },
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Banned phrases (comma-separated)</Label>
            <Input
              value={gr.input.bannedPhrases.phrases.join(', ')}
              onChange={(e) =>
                updateInput({
                  bannedPhrases: {
                    ...gr.input.bannedPhrases,
                    phrases: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          </div>
        </section>
        <Separator />
        {/* Output section */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">Output</h3>
          <div className="flex items-center justify-between">
            <Label>PII redaction</Label>
            <Switch
              checked={gr.output.piiRedaction.enabled}
              onCheckedChange={(v) =>
                updateOutput({ piiRedaction: { ...gr.output.piiRedaction, enabled: v } })
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Secret detection</Label>
            <Switch
              checked={gr.output.secretDetection.enabled}
              onCheckedChange={(v) =>
                updateOutput({ secretDetection: { ...gr.output.secretDetection, enabled: v } })
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Toxicity check</Label>
            <Switch
              checked={gr.output.toxicity.enabled}
              onCheckedChange={(v) => updateOutput({ toxicity: { ...gr.output.toxicity, enabled: v } })}
            />
          </div>
        </section>
        <Separator />
        {/* Judge + refusal + audit */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">Judge &amp; Audit</h3>
          <div className="flex items-center justify-between">
            <Label>LLM judge</Label>
            <Switch
              checked={gr.judge.enabled}
              onCheckedChange={(v) => update({ judge: { ...gr.judge, enabled: v } })}
            />
          </div>
          <div className="space-y-1">
            <Label>Judge model (optional — defaults to small classifier)</Label>
            <Input
              value={gr.judge.model ?? ''}
              onChange={(e) => update({ judge: { ...gr.judge, model: e.target.value || undefined } })}
              placeholder="e.g. anthropic.claude-haiku"
            />
          </div>
          <div className="space-y-1">
            <Label>Refusal message</Label>
            <Textarea
              value={gr.refusalMessage ?? ''}
              onChange={(e) => update({ refusalMessage: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Audit: log blocks</Label>
            <Switch
              checked={gr.audit.logBlocks}
              onCheckedChange={(v) => update({ audit: { ...gr.audit, logBlocks: v } })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Audit: log flags</Label>
            <Switch
              checked={gr.audit.logFlags}
              onCheckedChange={(v) => update({ audit: { ...gr.audit, logFlags: v } })}
            />
          </div>
        </section>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save guardrails'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}