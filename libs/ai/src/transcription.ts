import pino from 'pino';
import { env } from './env';

const logger = pino({ name: 'ai:transcription' });

/**
 * Speech-to-text engine client.
 *
 * The tenant registers their own self-hosted model as a TranscriptionModel
 * (endpoint URL + credentials). This client is a thin, dependency-free HTTP
 * caller so that whatever model the user later hosts on their AWS instance
 * drops in without code changes — it only has to speak the contract below.
 *
 * Request  : multipart/form-data POST to `endpointUrl`
 *              - `file`     : the audio bytes
 *              - `language` : optional BCP-47/ISO language hint
 *            plus any headers derived from `credentials`.
 * Response : JSON `{ text, language?, duration?, segments? }`
 *            (also tolerates `{ transcript }` / `{ transcription }`).
 */

export interface TranscriptionSegment {
  start?: number;
  end?: number;
  text: string;
  confidence?: number;
  speaker?: string;
}

/**
 * How to call the engine:
 * - 'custom'       : POST multipart {file,language} to endpointUrl → { text } (indic-conformer, our server)
 * - 'openai-audio' : POST multipart {file,model,language} to <endpointUrl>/audio/transcriptions → { text }
 *                    (OpenAI Whisper API, vLLM-served whisper, any OpenAI-compatible ASR)
 */
export type TranscriptionContract = 'custom' | 'openai-audio';

export interface TranscribeAudioInput {
  /** Registered model endpoint. When empty, the dev stub is used (see env). */
  endpointUrl?: string | null;
  /** Which request/response contract the endpoint speaks (default 'custom'). */
  contract?: TranscriptionContract;
  /** Model id for 'openai-audio' contract (e.g. 'whisper-large-v3'). */
  model?: string | null;
  /** Decrypted credential map, e.g. { apiKey } or { authHeaderName, authHeaderValue }. */
  credentials?: Record<string, string> | null;
  /** Raw audio bytes. */
  audio: Buffer;
  mimeType: string;
  fileName?: string;
  language?: string;
  /** Per-speaker segmentation. Only honored by the 'custom' contract. */
  diarize?: boolean;
  /** Upper bound on expected speaker count, passed to the engine's diarization stage
   *  (e.g. pyannote's num_speakers/max_speakers). Only honored by the 'custom' contract,
   *  and only meaningful when diarize is true. */
  maxSpeakers?: number;
  /** Milliseconds before the request is aborted. */
  timeoutMs?: number;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationSec?: number;
  segments?: TranscriptionSegment[];
  /** True when the engine auto-detected the language (caller omitted it / sent "auto"). */
  languageDetected?: boolean;
  /** Confidence (0-1) of the detected language, when languageDetected is true. */
  languageDetectionConfidence?: number;
  /** True when the engine recognized this audio as a known non-conversational system
   *  announcement (e.g. a carrier "please try again later" message) instead of real
   *  speech. When 'system_announcement', `text` holds the known correct phrase for
   *  `matchedVariant` rather than an ASR transcript of real content. */
  outcome?: 'system_announcement' | 'transcribed';
  /** Which known language variant of the system announcement matched, when
   *  outcome is 'system_announcement' (e.g. 'hi', 'ta', 'en'). */
  matchedVariant?: string;
  /** Confidence (0-1) of the system-announcement match, when outcome is 'system_announcement'. */
  matchConfidence?: number;
  /** True when the placeholder stub produced this result (no real endpoint). */
  stub?: boolean;
}

/** Thrown when the engine responds with a non-2xx status. The engine IS reachable — this
 *  is an application-level error, never a reason to trip the circuit breaker below. */
export class EngineHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'EngineHttpError';
  }
}

/** Thrown immediately, without attempting the call, when the circuit breaker for this
 *  endpoint is open (a recent attempt failed at the network level — connection refused /
 *  host unreachable). Lets a whole backlog of queued jobs fail fast during an outage
 *  instead of each one individually waiting through its own timeout to discover it. */
export class EngineCircuitOpenError extends Error {
  constructor(host: string, retryAfterMs: number) {
    super(`Transcription engine at ${host} is currently unreachable (retry in ${Math.ceil(retryAfterMs / 1000)}s)`);
    this.name = 'EngineCircuitOpenError';
  }
}

// Per-endpoint circuit breaker state, in-process (the worker runs as a single instance —
// see infra: workers desiredCount is fixed at 1 — so in-memory state is sufficient, no
// shared/DB-backed store needed). Keyed by host so one tenant's broken engine can't block
// a different tenant's healthy one.
const circuitOpenUntil = new Map<string, number>();
const CIRCUIT_COOLDOWN_MS = 20_000;

function isCircuitOpen(host: string): number | null {
  const until = circuitOpenUntil.get(host);
  if (until === undefined) return null;
  const remaining = until - Date.now();
  if (remaining <= 0) {
    circuitOpenUntil.delete(host);
    return null;
  }
  return remaining;
}

function tripCircuit(host: string): void {
  circuitOpenUntil.set(host, Date.now() + CIRCUIT_COOLDOWN_MS);
}

function resetCircuit(host: string): void {
  circuitOpenUntil.delete(host);
}

/**
 * Translate a decrypted credential map into request headers.
 * - `{ authHeaderName, authHeaderValue }` → that header verbatim
 * - `{ apiKey }` or `{ token }`            → `Authorization: Bearer <value>`
 * - any other entry                        → sent as a literal header
 */
function buildAuthHeaders(credentials?: Record<string, string> | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!credentials) return headers;

  const { authHeaderName, authHeaderValue, apiKey, token, ...rest } = credentials;

  if (authHeaderName && authHeaderValue) {
    headers[authHeaderName] = authHeaderValue;
  } else if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  for (const [key, value] of Object.entries(rest)) {
    if (value) headers[key] = value;
  }
  return headers;
}

function parseResult(raw: unknown): TranscriptionResult {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const text =
      (typeof obj.text === 'string' && obj.text) ||
      (typeof obj.transcript === 'string' && obj.transcript) ||
      (typeof obj.transcription === 'string' && obj.transcription) ||
      '';
    const segments = Array.isArray(obj.segments)
      ? (obj.segments as TranscriptionSegment[])
      : undefined;
    const durationSec =
      typeof obj.duration === 'number'
        ? obj.duration
        : typeof obj.durationSec === 'number'
          ? obj.durationSec
          : undefined;
    return {
      text: String(text),
      language: typeof obj.language === 'string' ? obj.language : undefined,
      durationSec,
      segments,
      languageDetected: typeof obj.languageDetected === 'boolean' ? obj.languageDetected : undefined,
      languageDetectionConfidence:
        typeof obj.languageDetectionConfidence === 'number' ? obj.languageDetectionConfidence : undefined,
      outcome:
        obj.outcome === 'system_announcement' || obj.outcome === 'transcribed'
          ? (obj.outcome as 'system_announcement' | 'transcribed')
          : undefined,
      matchedVariant: typeof obj.matchedVariant === 'string' ? obj.matchedVariant : undefined,
      matchConfidence: typeof obj.matchConfidence === 'number' ? obj.matchConfidence : undefined,
    };
  }
  return { text: typeof raw === 'string' ? raw : '' };
}

/**
 * Transcribe an audio buffer. Falls back to a placeholder transcript when no
 * endpoint is registered and TRANSCRIPTION_ALLOW_STUB is not "false".
 */
export async function transcribeAudio(input: TranscribeAudioInput): Promise<TranscriptionResult> {
  const { endpointUrl, credentials, audio, mimeType, fileName, language, timeoutMs = 120_000 } = input;
  const contract: TranscriptionContract = input.contract ?? 'custom';

  if (!endpointUrl) {
    if (env.TRANSCRIPTION_ALLOW_STUB === 'false') {
      throw new Error('No transcription model endpoint is configured for this tenant');
    }
    return {
      text: `[stub transcript] received ${audio.length} bytes of ${mimeType}`,
      language: language ?? 'en',
      stub: true,
    };
  }

  // For the OpenAI-compatible ASR contract, target <base>/audio/transcriptions.
  const url =
    contract === 'openai-audio' && !/\/audio\/transcriptions\/?$/.test(endpointUrl)
      ? `${endpointUrl.replace(/\/$/, '')}/audio/transcriptions`
      : endpointUrl;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();

  // Fail fast if this endpoint was confirmed unreachable moments ago, instead of waiting
  // through another full attempt to rediscover the same outage. This is what lets an
  // entire backlog of queued jobs during a real outage resolve in seconds, not hours.
  const circuitRemainingMs = isCircuitOpen(host);
  if (circuitRemainingMs !== null) {
    clearTimeout(timer);
    logger.warn({ host, retryAfterMs: circuitRemainingMs }, 'Skipping call — circuit open for this engine');
    throw new EngineCircuitOpenError(host, circuitRemainingMs);
  }

  logger.info({ host, contract, mimeType, audioBytes: audio.length, timeoutMs }, 'Calling transcription engine');

  try {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(audio)], { type: mimeType });
    form.append('file', blob, fileName ?? 'audio');
    if (language) form.append('language', language);
    if (contract === 'openai-audio') {
      if (input.model) form.append('model', input.model);
      form.append('response_format', 'json');
    } else if (input.diarize) {
      form.append('diarize', 'true');
      if (input.maxSpeakers !== undefined) form.append('maxSpeakers', String(input.maxSpeakers));
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: buildAuthHeaders(credentials),
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new EngineHttpError(`Transcription engine returned ${response.status}: ${detail.slice(0, 500)}`, response.status);
    }

    resetCircuit(host);
    logger.info({ host, latencyMs: Date.now() - startedAt }, 'Transcription engine responded');

    const contentType = response.headers.get('content-type') ?? '';
    const raw = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
    return parseResult(raw);
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    if (err instanceof EngineHttpError) {
      // The engine IS reachable — it just returned an error. Not a connectivity problem,
      // so the circuit breaker stays closed.
      logger.error({ host, status: err.status, errorMessage: err.message, elapsedMs }, 'Transcription engine returned an error response');
    } else if (err instanceof Error && err.name === 'AbortError') {
      // AbortError only ever comes from OUR OWN timer firing — it means we gave up after
      // waiting the full timeoutMs with no response. This is ambiguous (could be genuine
      // processing time on long audio, or a silent network drop), so it deliberately does
      // NOT trip the circuit breaker — only a confirmed network-level failure does.
      logger.error({ host, timeoutMs, elapsedMs }, 'Transcription engine call timed out (aborted) — check connectivity if this recurs consistently');
    } else {
      // Everything else here is a network-level failure (connection refused, DNS failure,
      // TLS error, etc.) — the request never reached the engine at all. This is the
      // "instance is down" case: trip the circuit so subsequent jobs fail fast instead of
      // each independently waiting to rediscover the same outage.
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorName = err instanceof Error ? err.name : 'unknown';
      tripCircuit(host);
      logger.error({ host, errorName, errorMessage, elapsedMs, circuitOpenForMs: CIRCUIT_COOLDOWN_MS }, 'Transcription engine unreachable at the network level — circuit opened');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
