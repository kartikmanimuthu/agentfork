'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ProviderModelSelect } from '@/components/llm-providers/provider-model-select';
import {
  resolveCachingConfig,
  CACHE_OVERRIDE_LABELS,
  MAX_CACHE_TTL_SECONDS,
  getThresholdBand,
  getPresetThreshold,
  presetForThreshold,
  WIDEST_THRESHOLD_MIN,
  WIDEST_THRESHOLD_MAX,
  type ThresholdPreset,
} from '@chatbot/shared/client';
import type { SimpleAgentConfig } from '@chatbot/agent-studio';

const PRESET_OPTIONS: ReadonlyArray<{ value: ThresholdPreset; label: string; description: string }> = [
  { value: 'strict', label: 'Strict', description: 'Only near-identical wording.' },
  { value: 'balanced', label: 'Balanced', description: 'Recommended.' },
  { value: 'loose', label: 'Loose', description: 'More hits, more risk of a wrong answer.' },
];

const exactOverridesSchema = z.object({
  withTools: z.boolean(),
  inSessions: z.boolean(),
});

const semanticOverridesSchema = exactOverridesSchema.extend({
  withAttachments: z.boolean(),
  withKnowledgeBase: z.boolean(),
});

const schema = z.object({
  exactEnabled: z.boolean(),
  exactTtlSeconds: z.number().int().min(0).max(MAX_CACHE_TTL_SECONDS),
  exactOverrides: exactOverridesSchema,
  semanticEnabled: z.boolean(),
  semanticEmbeddingModel: z.string().optional(),
  // Widest band across all embedding models — the per-model band is enforced by the
  // preset options here and by sanitiseThreshold on the server.
  semanticThreshold: z.number().min(WIDEST_THRESHOLD_MIN).max(WIDEST_THRESHOLD_MAX).optional(),
  semanticTtlSeconds: z.number().int().min(0).max(MAX_CACHE_TTL_SECONDS),
  semanticOverrides: semanticOverridesSchema,
});

type CachingFormValues = z.infer<typeof schema>;

interface CachingTabProps {
  config: SimpleAgentConfig;
  onSave: (config: SimpleAgentConfig) => void | Promise<void>;
  saving?: boolean;
}

type OverrideKey = keyof z.infer<typeof semanticOverridesSchema>;

type OverrideFieldName =
  | 'exactOverrides.withTools'
  | 'exactOverrides.inSessions'
  | 'semanticOverrides.withTools'
  | 'semanticOverrides.inSessions'
  | 'semanticOverrides.withAttachments'
  | 'semanticOverrides.withKnowledgeBase';

interface OverrideRow {
  description: string;
  alertTitle: string;
  alertDescription: string;
}

// Labels live in @chatbot/shared/client so the read-only agent page renders the same
// wording without importing this component.
const OVERRIDE_ROWS: Record<OverrideKey, OverrideRow> = {
  withTools: {
    description: 'Reuse an answer even when this agent has tools available.',
    alertTitle: 'The tool never runs.',
    alertDescription:
      'An answer saying a ticket was created will replay with no ticket created, and web search will not run.',
  },
  inSessions: {
    description: 'Reuse an answer even when the request is part of a multi-turn session.',
    alertTitle: 'Turns in a conversation look nearly identical.',
    alertDescription: "An earlier turn's answer can be replayed for a later, different question.",
  },
  withAttachments: {
    description: 'Reuse a semantic match even when the request includes attachments.',
    alertTitle: 'Attachments are not part of the semantic match.',
    alertDescription: 'The same question with a different file can return the earlier file’s answer.',
  },
  withKnowledgeBase: {
    description: 'Reuse a semantic match even when this agent retrieves knowledge base context.',
    alertTitle: 'Retrieved context is not part of the semantic match.',
    alertDescription: 'The stored answer was grounded in different context than the current question.',
  },
};

const EXACT_OVERRIDE_FIELDS: ReadonlyArray<{ name: OverrideFieldName; key: OverrideKey }> = [
  { name: 'exactOverrides.withTools', key: 'withTools' },
  { name: 'exactOverrides.inSessions', key: 'inSessions' },
];

const SEMANTIC_OVERRIDE_FIELDS: ReadonlyArray<{ name: OverrideFieldName; key: OverrideKey }> = [
  { name: 'semanticOverrides.withTools', key: 'withTools' },
  { name: 'semanticOverrides.inSessions', key: 'inSessions' },
  { name: 'semanticOverrides.withAttachments', key: 'withAttachments' },
  { name: 'semanticOverrides.withKnowledgeBase', key: 'withKnowledgeBase' },
];

export function CachingTab({ config, onSave, saving }: CachingTabProps) {
  const [semanticError, setSemanticError] = useState<string | null>(null);
  const resolved = resolveCachingConfig(config);

  const form = useForm({
    defaultValues: {
      exactEnabled: resolved.exact.enabled,
      exactTtlSeconds: resolved.exact.ttlSeconds,
      exactOverrides: { ...resolved.exact.overrides },
      semanticEnabled: resolved.semantic.enabled,
      semanticEmbeddingModel: resolved.semantic.embeddingModel,
      semanticThreshold: resolved.semantic.threshold,
      semanticTtlSeconds: resolved.semantic.ttlSeconds,
      semanticOverrides: { ...resolved.semantic.overrides },
    } as CachingFormValues,
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      if (value.semanticEnabled && value.semanticTtlSeconds > 0) {
        if (!value.semanticEmbeddingModel) {
          setSemanticError('Choose an embedding model before turning the semantic cache on.');
          return;
        }
        const res = await fetch('/api/agents/embedding-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeddingModel: value.semanticEmbeddingModel }),
        });
        const body = await res.json();
        if (!body.ok) {
          setSemanticError(body.error ?? 'That embedding model could not be verified.');
          return;
        }
      }
      setSemanticError(null);
      // Only the resolved `caching` shape is ever written back; the deprecated
      // cacheTtlMinutes/semanticCache fields are dropped so a save from this tab
      // migrates an old-shape config to the new one.
      onSave({
        ...config,
        caching: {
          exact: {
            enabled: value.exactEnabled,
            ttlSeconds: value.exactTtlSeconds,
            overrides: value.exactOverrides,
          },
          semantic: {
            enabled: value.semanticEnabled,
            ttlSeconds: value.semanticTtlSeconds,
            embeddingModel: value.semanticEmbeddingModel ?? '',
            threshold:
              value.semanticThreshold ?? getThresholdBand(value.semanticEmbeddingModel ?? '').default,
            overrides: value.semanticOverrides,
          },
          overrides: undefined,
        },
        cacheTtlMinutes: undefined,
        semanticCache: undefined,
      });
    },
  });

  const renderAdvanced = (fields: ReadonlyArray<{ name: OverrideFieldName; key: OverrideKey }>) => (
    <div className="grid gap-3 border-t pt-3">
      <div className="grid gap-0.5">
        <Label>Advanced</Label>
        <p className="text-xs text-muted-foreground">
          Overrides for conditions that normally block this cache entirely.
        </p>
      </div>

      {fields.map(({ name, key }) => {
        const row = OVERRIDE_ROWS[key];
        return (
          <form.Field key={name} name={name}>
            {(field) => (
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-4">
                  <div className="grid gap-0.5">
                    <Label htmlFor={field.name}>{CACHE_OVERRIDE_LABELS[key]}</Label>
                    <p className="text-xs text-muted-foreground">{row.description}</p>
                  </div>
                  <Switch
                    id={field.name}
                    checked={field.state.value}
                    onCheckedChange={(checked) => field.handleChange(checked)}
                  />
                </div>
                {field.state.value && (
                  <Alert variant="destructive">
                    <AlertTitle>{row.alertTitle}</AlertTitle>
                    <AlertDescription>{row.alertDescription}</AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </form.Field>
        );
      })}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Caching</CardTitle>
        <CardDescription>
          Control how this agent reuses earlier answers instead of calling the model again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
          className="space-y-4"
        >
          <form.Field name="exactEnabled">
            {(field) => (
              <div className="grid gap-3 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div className="grid gap-0.5">
                    <Label htmlFor={field.name}>Prompt cache</Label>
                    <p className="text-xs text-muted-foreground">
                      Reuses an answer only when the question is byte-identical.
                    </p>
                  </div>
                  <Switch
                    id={field.name}
                    checked={field.state.value}
                    onCheckedChange={(checked) => field.handleChange(checked)}
                  />
                </div>

                {field.state.value && (
                  <>
                    <form.Field name="exactTtlSeconds">
                      {(ttlField) => (
                        <div className="grid gap-1.5">
                          <Label htmlFor={ttlField.name}>TTL (seconds)</Label>
                          <Input
                            id={ttlField.name}
                            type="number"
                            min={0}
                            max={MAX_CACHE_TTL_SECONDS}
                            // String, not number: React compares node.value loosely, so
                            // "032" != 32 coerces to false and it never rewrites the DOM.
                            value={String(ttlField.state.value ?? 0)}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              ttlField.handleChange(Number.isFinite(n) && n > 0 ? n : 0);
                            }}
                            onBlur={ttlField.handleBlur}
                          />
                          <p className="text-xs text-muted-foreground">
                            Max {MAX_CACHE_TTL_SECONDS} seconds (7 days). 0 disables the prompt cache.
                          </p>
                          {ttlField.state.meta.errors.length > 0 && (
                            <p className="text-xs text-destructive">{String(ttlField.state.meta.errors[0])}</p>
                          )}
                        </div>
                      )}
                    </form.Field>

                    {renderAdvanced(EXACT_OVERRIDE_FIELDS)}
                  </>
                )}
              </div>
            )}
          </form.Field>

          <form.Field name="semanticEnabled">
            {(field) => (
              <div className="grid gap-3 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div className="grid gap-0.5">
                    <Label htmlFor={field.name}>Semantic cache</Label>
                    <p className="text-xs text-muted-foreground">
                      Reuse an answer when a new question means the same thing as an earlier one.
                    </p>
                  </div>
                  <Switch
                    id={field.name}
                    checked={field.state.value}
                    onCheckedChange={(checked) => field.handleChange(checked)}
                  />
                </div>

                {field.state.value && (
                  <>
                    <form.Field name="semanticEmbeddingModel">
                      {(modelField) => (
                        <div className="grid gap-1.5">
                          <Label>Embedding model</Label>
                          <ProviderModelSelect
                            capability="embedding"
                            value={modelField.state.value ?? ''}
                            onChange={(v) => {
                              modelField.handleChange(v);
                              if (form.getFieldValue('semanticThreshold') == null) {
                                form.setFieldValue('semanticThreshold', getThresholdBand(v).default);
                              }
                            }}
                            placeholder="Select an embedding model"
                          />
                        </div>
                      )}
                    </form.Field>

                    <form.Subscribe selector={(state) => state.values.semanticEmbeddingModel}>
                      {(embeddingModel) => {
                        // A strictness value means nothing until the cache has an embedding model.
                        if (!embeddingModel) {
                          return (
                            <p className="text-xs text-muted-foreground">
                              Choose an embedding model to set how closely a new question must match.
                            </p>
                          );
                        }
                        const band = getThresholdBand(embeddingModel);
                        return (
                          <form.Field name="semanticThreshold">
                            {(thresholdField) => {
                              const value = thresholdField.state.value ?? band.default;
                              const selected = presetForThreshold(embeddingModel, value);
                              const active = PRESET_OPTIONS.find((o) => o.value === selected);
                              const pct = (n: number) =>
                                band.max === band.min ? 0 : ((n - band.min) / (band.max - band.min)) * 100;

                              return (
                                <div className="grid gap-1.5">
                                  <div className="flex items-center justify-between">
                                    <Label>Match strictness</Label>
                                    <span className="text-xs text-muted-foreground">
                                      {active?.label} · {value.toFixed(2)}
                                    </span>
                                  </div>

                                  <Slider
                                    min={band.min}
                                    max={band.max}
                                    step={0.01}
                                    value={[value]}
                                    onValueChange={(vals) => {
                                      const v = Array.isArray(vals) ? vals[0] : (vals as number);
                                      thresholdField.handleChange(Number(v.toFixed(2)));
                                    }}
                                  />

                                  {/* Preset markers sit at their real positions on the scale, so the
                                      uneven spacing shows how narrow the useful band actually is. */}
                                  <div className="relative h-9 text-xs">
                                    {PRESET_OPTIONS.map((option) => {
                                      const at = getPresetThreshold(embeddingModel, option.value);
                                      const left = pct(at);
                                      // Clamp the shift so end markers stay inside the track instead of
                                      // hanging off it: centred normally, flush at either edge.
                                      const shift = left <= 2 ? '0%' : left >= 98 ? '-100%' : '-50%';
                                      return (
                                        <button
                                          key={option.value}
                                          type="button"
                                          onClick={() => thresholdField.handleChange(at)}
                                          style={{ left: `${left}%`, transform: `translateX(${shift})` }}
                                          className={cn(
                                            'absolute top-0 flex flex-col items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                            option.value === selected
                                              ? 'text-foreground font-medium'
                                              : 'text-muted-foreground',
                                          )}
                                        >
                                          <span aria-hidden className="h-1.5 w-px bg-border" />
                                          {option.label}
                                        </button>
                                      );
                                    })}
                                  </div>

                                  <p className="text-xs text-muted-foreground">{active?.description}</p>
                                </div>
                              );
                            }}
                          </form.Field>
                        );
                      }}
                    </form.Subscribe>

                    <form.Field name="semanticTtlSeconds">
                      {(ttlField) => (
                        <div className="grid gap-1.5">
                          <Label htmlFor={ttlField.name}>TTL (seconds)</Label>
                          <Input
                            id={ttlField.name}
                            type="number"
                            min={0}
                            max={MAX_CACHE_TTL_SECONDS}
                            // String, not number: React compares node.value loosely, so
                            // "032" != 32 coerces to false and it never rewrites the DOM.
                            value={String(ttlField.state.value ?? 0)}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              ttlField.handleChange(Number.isFinite(n) && n > 0 ? n : 0);
                            }}
                            onBlur={ttlField.handleBlur}
                          />
                          <p className="text-xs text-muted-foreground">
                            Max {MAX_CACHE_TTL_SECONDS} seconds (7 days). 0 disables the semantic cache.
                          </p>
                          {ttlField.state.meta.errors.length > 0 && (
                            <p className="text-xs text-destructive">{String(ttlField.state.meta.errors[0])}</p>
                          )}
                        </div>
                      )}
                    </form.Field>

                    <p className="text-xs text-muted-foreground">
                      Answers are only reused for one-off questions. This agent will not reuse an answer when it
                      uses tools, when the request is part of an ongoing conversation, or when the caller asks for a
                      fresh answer, unless overridden below.
                    </p>

                    {renderAdvanced(SEMANTIC_OVERRIDE_FIELDS)}
                  </>
                )}

                {semanticError && <p className="text-xs text-destructive">{semanticError}</p>}
              </div>
            )}
          </form.Field>

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? 'Saving...' : 'Save Caching'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
