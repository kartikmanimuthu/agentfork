'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { SecretInput } from '@/components/ui/secret-input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useValidateTranscriptionProvider } from '@/hooks/use-transcription-providers';
import type { TranscriptionProviderType } from '@/hooks/use-transcription-providers';

const PROVIDER_OPTIONS: { value: TranscriptionProviderType; label: string }[] = [
  { value: 'VLLM', label: 'vLLM' },
  { value: 'LITELLM', label: 'LiteLLM Gateway' },
  { value: 'OPENAI_COMPATIBLE', label: 'OpenAI Compatible' },
  { value: 'CUSTOM', label: 'Custom Endpoint' },
];

export interface TranscriptionProviderFormProps {
  defaultValues?: {
    name?: string;
    providerType?: TranscriptionProviderType;
    endpointUrl?: string;
    modelId?: string;
    isDefault?: boolean;
  };
  onSubmit: (values: {
    name: string;
    providerType: TranscriptionProviderType;
    contract: string;
    endpointUrl?: string;
    credentials: Record<string, string>;
    modelId?: string;
    models?: Array<{ id: string; name: string; capabilities: string[] }>;
    isDefault?: boolean;
  }) => void;
  loading?: boolean;
  submitLabel?: string;
}

function contractForProvider(providerType: TranscriptionProviderType): string {
  return providerType === 'CUSTOM' ? 'custom' : 'openai-audio';
}

export function TranscriptionProviderForm({
  defaultValues,
  onSubmit,
  loading,
  submitLabel = 'Save',
}: TranscriptionProviderFormProps) {
  const isEditMode = Boolean(defaultValues?.providerType);
  const [step, setStep] = useState(1);
  const [discoveredModels, setDiscoveredModels] = useState<Array<{ id: string; name: string; capabilities: string[] }>>([]);
  const [validateError, setValidateError] = useState<string | null>(null);
  const validateMutation = useValidateTranscriptionProvider();

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? '',
      providerType: (defaultValues?.providerType ?? 'VLLM') as TranscriptionProviderType,
      endpointUrl: defaultValues?.endpointUrl ?? '',
      apiKey: '',
      baseUrl: '',
      gatewayUrl: '',
      masterKey: '',
      modelId: defaultValues?.modelId ?? '',
      isDefault: defaultValues?.isDefault ?? false,
    },
    onSubmit: ({ value }) => {
      const credentials: Record<string, string> = {};
      if (value.apiKey) credentials.apiKey = value.apiKey;
      if (value.baseUrl) credentials.baseUrl = value.baseUrl;
      if (value.gatewayUrl) credentials.gatewayUrl = value.gatewayUrl;
      if (value.masterKey) credentials.masterKey = value.masterKey;

      const endpointUrl = value.endpointUrl || value.baseUrl || value.gatewayUrl || undefined;

      onSubmit({
        name: value.name,
        providerType: value.providerType,
        contract: contractForProvider(value.providerType),
        endpointUrl,
        credentials,
        modelId: value.modelId || undefined,
        models: discoveredModels.length > 0 ? discoveredModels : undefined,
        isDefault: value.isDefault,
      });
    },
  });

  const providerType = form.getFieldValue('providerType');
  const hasDiscovered = discoveredModels.length > 0;

  const handleValidate = async () => {
    setValidateError(null);
    const credentials: Record<string, string> = {};
    const apiKey = form.getFieldValue('apiKey');
    const baseUrl = form.getFieldValue('baseUrl');
    const gatewayUrl = form.getFieldValue('gatewayUrl');
    const masterKey = form.getFieldValue('masterKey');
    const endpointUrl = form.getFieldValue('endpointUrl');

    if (apiKey) credentials.apiKey = apiKey;
    if (baseUrl) credentials.baseUrl = baseUrl;
    if (gatewayUrl) credentials.gatewayUrl = gatewayUrl;
    if (masterKey) credentials.masterKey = masterKey;

    const effectiveEndpoint = endpointUrl || baseUrl || gatewayUrl || undefined;

    try {
      const result = await validateMutation.mutateAsync({
        providerType,
        endpointUrl: effectiveEndpoint,
        credentials,
      });
      if (result.success && result.models) {
        setDiscoveredModels(result.models);
        setStep(3);
      } else if (result.success) {
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
      {/* ─── Step 1: Provider Type & Name ───────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Step 1: Provider &amp; Name</h3>

          <form.Field
            name="name"
            validators={{ onChange: ({ value }) => (!value.trim() ? 'Name is required' : undefined) }}
          >
            {(field) => (
              <div className="grid gap-1.5">
                <Label htmlFor={field.name}>Name</Label>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="My Transcription Provider"
                />
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
                <Select
                  value={field.state.value}
                  onValueChange={(v) => field.handleChange(v as TranscriptionProviderType)}
                  disabled={isEditMode}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROVIDER_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isEditMode && (
                  <p className="text-xs text-muted-foreground">Provider type cannot be changed after creation.</p>
                )}
              </div>
            )}
          </form.Field>

          <form.Subscribe selector={(state) => state.values.name}>
            {(name) => (
              <Button type="button" onClick={() => setStep(2)} disabled={!name.trim()}>
                Next: Credentials
              </Button>
            )}
          </form.Subscribe>
        </div>
      )}

      {/* ─── Step 2: Credentials ─────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Step 2: Credentials</h3>
          <Button type="button" variant="ghost" size="sm" onClick={() => setStep(1)} className="mb-2">← Back</Button>

          {/* vLLM / OpenAI Compatible */}
          {(providerType === 'VLLM' || providerType === 'OPENAI_COMPATIBLE') && (
            <>
              <form.Field name="baseUrl">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>Base URL</Label>
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="https://api.example.com/v1"
                    />
                  </div>
                )}
              </form.Field>
              <form.Field name="apiKey">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>API Key <span className="text-muted-foreground">(optional)</span></Label>
                    <SecretInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="sk-..." />
                  </div>
                )}
              </form.Field>
            </>
          )}

          {/* LiteLLM Gateway */}
          {providerType === 'LITELLM' && (
            <>
              <p className="text-xs text-muted-foreground">
                Leave blank to use the platform&apos;s default gateway.
              </p>
              <form.Field name="gatewayUrl">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>Gateway URL <span className="text-muted-foreground">(optional)</span></Label>
                    <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="http://your-gateway:4000" />
                  </div>
                )}
              </form.Field>
              <form.Field name="masterKey">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>Master Key <span className="text-muted-foreground">(optional)</span></Label>
                    <SecretInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="sk-..." />
                  </div>
                )}
              </form.Field>
            </>
          )}

          {/* Custom Endpoint */}
          {providerType === 'CUSTOM' && (
            <>
              <form.Field name="endpointUrl">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>Endpoint URL</Label>
                    <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="https://asr.example.com/transcribe" />
                  </div>
                )}
              </form.Field>
              <form.Field name="apiKey">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>API Key / Token <span className="text-muted-foreground">(optional)</span></Label>
                    <SecretInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="Bearer token or API key" />
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

      {/* ─── Step 3: Model Selection ──────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Step 3: Select Model</h3>
          <Button type="button" variant="ghost" size="sm" onClick={() => setStep(2)} className="mb-2">← Back</Button>

          {!hasDiscovered && (
            <p className="text-sm text-muted-foreground">
              No models discovered automatically. Enter the model ID manually.
            </p>
          )}

          <form.Field name="modelId">
            {(field) => (
              <div className="grid gap-1.5">
                <Label>Transcription Model</Label>
                {hasDiscovered ? (
                  <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                    <SelectTrigger><SelectValue placeholder="Select a model" /></SelectTrigger>
                    <SelectContent className="max-h-72 overflow-y-auto">
                      {discoveredModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="e.g., whisper-large-v3"
                  />
                )}
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

          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
