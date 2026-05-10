'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useForm } from '@tanstack/react-form';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useValidateProvider } from '@/hooks/use-llm-providers';
import type { ProviderType } from '@chatbot/shared';

const providerOptions: { value: ProviderType; label: string }[] = [
  { value: 'BEDROCK', label: 'Amazon Bedrock' },
  { value: 'OPENAI', label: 'OpenAI' },
  { value: 'ANTHROPIC', label: 'Anthropic' },
  { value: 'OLLAMA', label: 'Ollama' },
  { value: 'VLLM', label: 'vLLM' },
  { value: 'OPENAI_COMPATIBLE', label: 'OpenAI Compatible' },
];

export interface LlmProviderFormProps {
  defaultValues?: {
    name?: string;
    providerType?: ProviderType;
    region?: string;
    chatModel?: string;
    embeddingModel?: string;
    embeddingDimensions?: number;
    isDefault?: boolean;
  };
  onSubmit: (values: {
    name: string;
    providerType: ProviderType;
    region?: string;
    credentials: Record<string, string>;
    chatModel?: string;
    embeddingModel?: string;
    embeddingDimensions?: number;
    isDefault?: boolean;
  }) => void;
  loading?: boolean;
  submitLabel?: string;
}

export function LlmProviderForm({ defaultValues, onSubmit, loading, submitLabel = 'Save' }: LlmProviderFormProps) {
  const [step, setStep] = useState(1);
  const [discoveredModels, setDiscoveredModels] = useState<Array<{ id: string; name: string; capabilities: string[] }>>([]);
  const [validateError, setValidateError] = useState<string | null>(null);
  const validateMutation = useValidateProvider();

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? '',
      providerType: defaultValues?.providerType ?? 'BEDROCK',
      region: defaultValues?.region ?? '',
      accessKeyId: '',
      secretAccessKey: '',
      apiKey: '',
      baseUrl: '',
      chatModel: defaultValues?.chatModel ?? '',
      embeddingModel: defaultValues?.embeddingModel ?? '',
      embeddingDimensions: defaultValues?.embeddingDimensions ?? undefined,
      isDefault: defaultValues?.isDefault ?? false,
    },
    onSubmit: ({ value }) => {
      const credentials: Record<string, string> = {};
      if (value.accessKeyId) credentials.accessKeyId = value.accessKeyId;
      if (value.secretAccessKey) credentials.secretAccessKey = value.secretAccessKey;
      if (value.apiKey) credentials.apiKey = value.apiKey;
      if (value.baseUrl) credentials.baseUrl = value.baseUrl;

      onSubmit({
        name: value.name,
        providerType: value.providerType as ProviderType,
        region: value.region || undefined,
        credentials,
        chatModel: value.chatModel || undefined,
        embeddingModel: value.embeddingModel || undefined,
        embeddingDimensions: value.embeddingDimensions,
        isDefault: value.isDefault,
      });
    },
  });

  const providerType = form.getFieldValue('providerType');
  const chatModels = discoveredModels.filter((m) => m.capabilities.includes('chat'));
  const embeddingModels = discoveredModels.filter((m) => m.capabilities.includes('embedding'));

  const handleValidate = async () => {
    setValidateError(null);
    const credentials: Record<string, string> = {};
    const accessKeyId = form.getFieldValue('accessKeyId');
    const secretAccessKey = form.getFieldValue('secretAccessKey');
    const apiKey = form.getFieldValue('apiKey');
    const baseUrl = form.getFieldValue('baseUrl');

    if (accessKeyId) credentials.accessKeyId = accessKeyId;
    if (secretAccessKey) credentials.secretAccessKey = secretAccessKey;
    if (apiKey) credentials.apiKey = apiKey;
    if (baseUrl) credentials.baseUrl = baseUrl;

    try {
      const result = await validateMutation.mutateAsync({
        providerType: providerType as ProviderType,
        credentials,
        region: form.getFieldValue('region') || undefined,
      });
      if (result.success && result.models) {
        setDiscoveredModels(result.models);
        setStep(3);
      } else {
        setValidateError(result.error ?? 'Validation failed');
      }
    } catch (e) {
      setValidateError(e instanceof Error ? e.message : 'Validation failed');
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-6">
      {step === 1 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Step 1: Provider Type &amp; Name</h3>
          <form.Field name="name">
            {(field) => (
              <div className="grid gap-1.5">
                <Label htmlFor={field.name}>Name</Label>
                <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="My LLM Provider" />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field name="providerType">
            {(field) => (
              <div className="grid gap-1.5">
                <Label>Provider</Label>
                <Select value={field.state.value} onValueChange={(v) => field.handleChange(v as ProviderType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {providerOptions.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>

          {providerType === 'BEDROCK' && (
            <form.Field name="region">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label>Region</Label>
                  <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="us-east-1" />
                </div>
              )}
            </form.Field>
          )}

          <Button type="button" onClick={() => setStep(2)}>Next: Credentials</Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Step 2: Credentials</h3>
          <Button type="button" variant="ghost" size="sm" onClick={() => setStep(1)} className="mb-2">← Back</Button>

          {providerType === 'BEDROCK' && (
            <>
              <form.Field name="accessKeyId">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>Access Key ID</Label>
                    <Input type="password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="AKIA..." />
                    <p className="text-xs text-muted-foreground">Leave blank to use host AWS credentials</p>
                  </div>
                )}
              </form.Field>
              <form.Field name="secretAccessKey">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>Secret Access Key</Label>
                    <Input type="password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="******" />
                  </div>
                )}
              </form.Field>
            </>
          )}

          {(providerType === 'OPENAI' || providerType === 'ANTHROPIC') && (
            <form.Field name="apiKey">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label>API Key</Label>
                  <Input type="password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="sk-..." />
                </div>
              )}
            </form.Field>
          )}

          {(providerType === 'OLLAMA' || providerType === 'VLLM' || providerType === 'OPENAI_COMPATIBLE') && (
            <>
              <form.Field name="baseUrl">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>Base URL</Label>
                    <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder={providerType === 'OLLAMA' ? 'http://localhost:11434' : 'https://api.example.com/v1'} />
                  </div>
                )}
              </form.Field>
              <form.Field name="apiKey">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>API Key {providerType === 'OLLAMA' && <span className="text-muted-foreground">(optional)</span>}</Label>
                    <Input type="password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="sk-..." />
                  </div>
                )}
              </form.Field>
            </>
          )}

          {validateError && (
            <p className="text-sm text-destructive">{validateError}</p>
          )}

          <Button type="button" onClick={handleValidate} disabled={validateMutation.isPending}>
            {validateMutation.isPending ? 'Validating...' : 'Validate & Discover Models'}
          </Button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Step 3: Select Models</h3>
          <Button type="button" variant="ghost" size="sm" onClick={() => setStep(2)} className="mb-2">← Back</Button>

          {chatModels.length > 0 && (
            <form.Field name="chatModel">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label>Chat Model</Label>
                  <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                    <SelectTrigger><SelectValue placeholder="Select chat model" /></SelectTrigger>
                    <SelectContent>
                      {chatModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>
          )}

          {embeddingModels.length > 0 && (
            <form.Field name="embeddingModel">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label>Embedding Model</Label>
                  <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                    <SelectTrigger><SelectValue placeholder="Select embedding model" /></SelectTrigger>
                    <SelectContent>
                      {embeddingModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>
          )}

          <form.Field name="embeddingDimensions">
            {(field) => (
              <div className="grid gap-1.5">
                <Label>Embedding Dimensions</Label>
                <Input type="number" value={field.state.value ?? ''} onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined)} placeholder="1024" />
              </div>
            )}
          </form.Field>

          <form.Field name="isDefault">
            {(field) => (
              <div className="flex items-center gap-3">
                <Switch id={field.name} checked={field.state.value} onCheckedChange={(v) => field.handleChange(v)} />
                <Label htmlFor={field.name}>Set as default provider</Label>
              </div>
            )}
          </form.Field>

          <Button type="submit" disabled={loading}>{loading ? 'Saving...' : submitLabel}</Button>
        </div>
      )}
    </form>
  );
}
