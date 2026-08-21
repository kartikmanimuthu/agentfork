'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { SecretInput } from '@/components/ui/secret-input';
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
  { value: 'LITELLM', label: 'LiteLLM Gateway' },
];

/**
 * Secret credential fields, in the order they can appear. A configured secret is
 * shown as "Configured" and left blank; submitting blank keeps the stored value,
 * because both `update()` and validation merge over what is already saved.
 */
const SECRET_FIELDS = ['apiKey', 'secretAccessKey', 'masterKey', 'accessKeyId'] as const;
type SecretField = (typeof SECRET_FIELDS)[number];

export interface LlmProviderFormProps {
  defaultValues?: {
    name?: string;
    providerType?: ProviderType;
    region?: string;
    chatModel?: string;
    embeddingModel?: string;
    embeddingDimensions?: number;
    maxBudgetUsd?: number;
    isDefault?: boolean;
    /** Non-secret endpoints, prefilled so they can be EDITED rather than retyped. */
    baseUrl?: string;
    gatewayUrl?: string;
    /**
     * The saved credentials, so the operator can SEE and edit the key they already
     * entered rather than being told one exists. Supplied only by the edit page,
     * which fetches the provider with `withSecrets` — every other caller leaves
     * this undefined and the fields fall back to the "Configured" placeholder.
     */
    secrets?: Record<string, string>;
  };
  /**
   * Which secrets the provider already has stored (names only, from the API's
   * `configuredSecrets`). Fields named here render as "Configured — leave blank
   * to keep" instead of an empty box that reads as "cleared".
   */
  configuredSecrets?: string[];
  /**
   * The provider being edited. Sent with validation so the server can merge the
   * stored secrets under whatever was retyped — without it, re-discovering
   * models after changing only the base URL goes out with no API key.
   */
  providerId?: string;
  onSubmit: (values: {
    name: string;
    providerType: ProviderType;
    region?: string;
    credentials: Record<string, string>;
    chatModel?: string;
    embeddingModel?: string;
    embeddingDimensions?: number;
    maxBudgetUsd?: number;
    models?: Array<{ id: string; name: string; capabilities: string[] }>;
    isDefault?: boolean;
  }) => void;
  loading?: boolean;
  submitLabel?: string;
}

/**
 * Endpoints that are effectively fixed for a provider family, prefilled when that
 * family is selected. These already existed as placeholders, which look identical
 * but submit nothing — a self-hosted provider saved with an empty base URL fails
 * at the first model call, and for OpenAI-compatible providers `ChatOpenAI`
 * silently falls back to api.openai.com instead of erroring.
 *
 * Absent on purpose:
 *  - OPENAI — the SDK's own default is correct, and a hardcoded version-pinned
 *    URL here would be a worse guess than no value at all.
 *  - LITELLM — the gateway URL is deployment-specific and lives in server env
 *    (`LITELLM_GATEWAY_URL`); the browser has nothing to base a guess on.
 *  - BEDROCK — region-based, no endpoint field.
 */
const DEFAULT_BASE_URLS: Partial<Record<ProviderType, string>> = {
  OLLAMA: 'http://localhost:11434',
  VLLM: 'http://localhost:8000/v1',
  // ANTHROPIC deliberately absent. Its Base URL field is never rendered, and
  // libs/ai routes `anthropic` through OpenAICompatibleProvider — createOpenAI
  // POSTs to `${baseUrl}/chat/completions`, so `https://api.anthropic.com` would
  // resolve to a 404 path (the OpenAI-compatible route is /v1/chat/completions)
  // and reproduce the MODEL_NOT_FOUND failure this prefill exists to prevent.
  // Prefilling a field the user cannot see also gives them no way to correct it.
};

export function LlmProviderForm({
  defaultValues,
  configuredSecrets,
  providerId,
  onSubmit,
  loading,
  submitLabel = 'Save',
}: LlmProviderFormProps) {
  const isEditMode = Boolean(defaultValues?.providerType);
  const storedSecrets = new Set(configuredSecrets ?? []);

  const [step, setStep] = useState(1);
  const [discoveredModels, setDiscoveredModels] = useState<Array<{ id: string; name: string; capabilities: string[] }>>([]);
  const [validateError, setValidateError] = useState<string | null>(null);
  const validateMutation = useValidateProvider();

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? '',
      providerType: defaultValues?.providerType ?? 'BEDROCK',
      region: defaultValues?.region ?? '',
      // Prefilled from the saved credentials when the caller supplied them, so an
      // operator changing the model does not have to retype a key they already
      // entered. Still safe to leave blank: `update()` merges over what is stored,
      // so a blank field means "keep" rather than "clear".
      accessKeyId: defaultValues?.secrets?.accessKeyId ?? '',
      secretAccessKey: defaultValues?.secrets?.secretAccessKey ?? '',
      apiKey: defaultValues?.secrets?.apiKey ?? '',
      baseUrl: defaultValues?.baseUrl ?? '',
      gatewayUrl: defaultValues?.gatewayUrl ?? '',
      masterKey: defaultValues?.secrets?.masterKey ?? '',
      chatModel: defaultValues?.chatModel ?? '',
      embeddingModel: defaultValues?.embeddingModel ?? '',
      embeddingDimensions: defaultValues?.embeddingDimensions ?? undefined,
      maxBudgetUsd: defaultValues?.maxBudgetUsd ?? undefined,
      isDefault: defaultValues?.isDefault ?? false,
    },
    onSubmit: ({ value }) => {
      const credentials: Record<string, string> = {};
      if (value.accessKeyId) credentials.accessKeyId = value.accessKeyId;
      if (value.secretAccessKey) credentials.secretAccessKey = value.secretAccessKey;
      if (value.apiKey) credentials.apiKey = value.apiKey;
      if (value.baseUrl) credentials.baseUrl = value.baseUrl;
      if (value.gatewayUrl) credentials.gatewayUrl = value.gatewayUrl;
      if (value.masterKey) credentials.masterKey = value.masterKey;

      onSubmit({
        name: value.name,
        providerType: value.providerType as ProviderType,
        region: value.region || undefined,
        credentials,
        chatModel: value.chatModel || undefined,
        embeddingModel: value.embeddingModel || undefined,
        embeddingDimensions: value.embeddingDimensions,
        maxBudgetUsd: value.maxBudgetUsd,
        models: discoveredModels.length > 0 ? discoveredModels : undefined,
        isDefault: value.isDefault,
      });
    },
  });

  /**
   * A stored secret the operator has not retyped. Such a field is left blank on
   * purpose: `update()` and `mergeStoredCredentials()` both merge over what is
   * saved, so blank means "keep", never "clear".
   */
  const isKeptSecret = (name: SecretField) =>
    isEditMode && storedSecrets.has(name) && !form.getFieldValue(name);

  const secretPlaceholder = (name: SecretField, fallback: string) =>
    isEditMode && storedSecrets.has(name) ? 'Configured — leave blank to keep' : fallback;

  const providerType = form.getFieldValue('providerType');
  const chatModels = discoveredModels.filter((m) => m.capabilities.includes('chat'));
  const embeddingModels = discoveredModels.filter((m) => m.capabilities.includes('embedding'));
  const hasAnyModels = discoveredModels.length > 0;

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
    const gatewayUrl = form.getFieldValue('gatewayUrl');
    const masterKey = form.getFieldValue('masterKey');
    if (gatewayUrl) credentials.gatewayUrl = gatewayUrl;
    if (masterKey) credentials.masterKey = masterKey;

    try {
      const result = await validateMutation.mutateAsync({
        providerType: providerType as ProviderType,
        credentials,
        region: form.getFieldValue('region') || undefined,
        // Edit mode sends only what was retyped; the server merges the stored
        // secrets underneath. Without this, re-discovering models after changing
        // just the base URL validated with no API key and failed.
        ...(providerId ? { providerId } : {}),
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
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }) => (!value.trim() ? 'Name is required' : undefined),
            }}
          >
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
                <Select
                  value={field.state.value}
                  onValueChange={(v) => {
                    field.handleChange(v as ProviderType);
                    // Only fills a base URL the user has not written in. Overwriting
                    // a typed endpoint on an accidental provider change would throw
                    // away the one value they cannot guess again.
                    const suggested = DEFAULT_BASE_URLS[v as ProviderType];
                    const current = form.getFieldValue('baseUrl');
                    const isPrefilled = Object.values(DEFAULT_BASE_URLS).includes(current);
                    // Only a value the user did not write themselves may be touched.
                    if (!current || isPrefilled) {
                      // `?? ''` is load-bearing: OPENAI, BEDROCK and LITELLM have no
                      // suggestion AND render no Base URL field, so leaving a stale
                      // prefill in place submitted it invisibly (`if (value.baseUrl)`
                      // below is unconditional). Picking Ollama then OpenAI would have
                      // stored baseUrl=http://localhost:11434 against OpenAI, sending
                      // every call to localhost — and edit mode disables the provider
                      // type, so it could not be corrected in place.
                      form.setFieldValue('baseUrl', suggested ?? '');
                    }
                  }}
                  disabled={isEditMode}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {providerOptions.map((p) => (
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

      {step === 2 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Step 2: Credentials</h3>
          <Button type="button" variant="ghost" size="sm" onClick={() => setStep(1)} className="mb-2">← Back</Button>

          {providerType === 'BEDROCK' && (
            <>
              <p className="text-xs text-muted-foreground">Leave all fields blank to use host AWS credentials.</p>
              <form.Field name="region">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>Region</Label>
                    <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="us-east-1" />
                  </div>
                )}
              </form.Field>
              <form.Field name="accessKeyId">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>Access Key ID</Label>
                    <SecretInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder={secretPlaceholder('accessKeyId', 'AKIA...')} />
                    {isKeptSecret('accessKeyId') && (
                      <p className="text-xs text-muted-foreground">Already configured. Leave blank to keep the saved value.</p>
                    )}
                  </div>
                )}
              </form.Field>
              <form.Field name="secretAccessKey">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>Secret Access Key</Label>
                    <SecretInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder={secretPlaceholder('secretAccessKey', '******')} />
                    {isKeptSecret('secretAccessKey') && (
                      <p className="text-xs text-muted-foreground">Already configured. Leave blank to keep the saved value.</p>
                    )}
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
                  <SecretInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder={secretPlaceholder('apiKey', 'sk-...')} />
                  {isKeptSecret('apiKey') && (
                    <p className="text-xs text-muted-foreground">Already configured. Leave blank to keep the saved value.</p>
                  )}
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
                    <Label>API Key {(providerType === 'OLLAMA' || providerType === 'VLLM' || providerType === 'OPENAI_COMPATIBLE') && <span className="text-muted-foreground">(optional)</span>}</Label>
                    <SecretInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder={secretPlaceholder('apiKey', 'sk-...')} />
                    {isKeptSecret('apiKey') && (
                      <p className="text-xs text-muted-foreground">Already configured. Leave blank to keep the saved value.</p>
                    )}
                  </div>
                )}
              </form.Field>
            </>
          )}

          {providerType === 'LITELLM' && (
            <>
              <p className="text-xs text-muted-foreground">
                Leave blank to use the platform&apos;s default gateway. We&apos;ll automatically provision an isolated API key for this tenant.
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
                    <Label>Gateway Admin Key <span className="text-muted-foreground">(optional)</span></Label>
                    <SecretInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder={secretPlaceholder('masterKey', 'sk-...')} />
                    {isKeptSecret('masterKey') && (
                      <p className="text-xs text-muted-foreground">Already configured. Leave blank to keep the saved value.</p>
                    )}
                  </div>
                )}
              </form.Field>
              <form.Field name="maxBudgetUsd">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>Monthly Budget (USD) <span className="text-muted-foreground">(optional)</span></Label>
                    <Input
                      type="number"
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined)}
                      placeholder="Leave blank for unlimited"
                    />
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

          {!hasAnyModels && (
            <p className="text-sm text-muted-foreground">
              No models were discovered automatically. You can enter model names manually below.
            </p>
          )}

          <form.Field name="chatModel">
            {(field) => (
              <div className="grid gap-1.5">
                <Label>Chat Model</Label>
                {chatModels.length > 0 ? (
                  <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                    <SelectTrigger><SelectValue placeholder="Select chat model" /></SelectTrigger>
                    <SelectContent className="max-h-72 overflow-y-auto">
                      {chatModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g., gemma-4-e4b-it-mlx" />
                )}
              </div>
            )}
          </form.Field>

          <form.Field name="embeddingModel">
            {(field) => (
              <div className="grid gap-1.5">
                <Label>Embedding Model</Label>
                {embeddingModels.length > 0 ? (
                  <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                    <SelectTrigger><SelectValue placeholder="Select embedding model" /></SelectTrigger>
                    <SelectContent className="max-h-72 overflow-y-auto">
                      {embeddingModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g., text-embedding-nomic-embed-text-v1.5" />
                )}
              </div>
            )}
          </form.Field>

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

          <form.Subscribe selector={(state) => [state.values.chatModel, state.values.embeddingModel]}>
            {([chatModelValue, embeddingModelValue]) => {
              const hasNeitherModel = !chatModelValue?.trim() && !embeddingModelValue?.trim();
              return (
                <>
                  {hasNeitherModel && (
                    <p className="text-xs text-destructive">Select at least one of Chat Model or Embedding Model.</p>
                  )}
                  <Button type="submit" disabled={loading || hasNeitherModel}>
                    {loading ? 'Saving...' : submitLabel}
                  </Button>
                </>
              );
            }}
          </form.Subscribe>
        </div>
      )}
    </form>
  );
}
