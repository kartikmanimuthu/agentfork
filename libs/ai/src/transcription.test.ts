import { describe, it, expect, vi, afterEach } from 'vitest';
import { transcribeAudio } from './transcription';

const audio = Buffer.from('fake-audio-bytes');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('transcribeAudio', () => {
  it('returns a stub transcript when no endpoint is registered', async () => {
    const result = await transcribeAudio({ audio, mimeType: 'audio/wav' });
    expect(result.stub).toBe(true);
    expect(result.text).toContain('stub transcript');
    expect(result.language).toBe('en');
  });

  it('POSTs to the endpoint and parses { text }', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ text: 'hello world', language: 'en', duration: 3.2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const result = await transcribeAudio({
      endpointUrl: 'https://engine.example/transcribe',
      credentials: { apiKey: 'secret' },
      audio,
      mimeType: 'audio/wav',
      language: 'en',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://engine.example/transcribe');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer secret' });
    expect(result.text).toBe('hello world');
    expect(result.durationSec).toBe(3.2);
  });

  it('tolerates a { transcript } response shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ transcript: 'alt shape' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const result = await transcribeAudio({ endpointUrl: 'https://x/y', audio, mimeType: 'audio/mp3' });
    expect(result.text).toBe('alt shape');
  });

  it('sends maxSpeakers as a form field when diarize is true and maxSpeakers is provided', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ text: 'hi' }), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    await transcribeAudio({
      endpointUrl: 'https://maxspeakers-sent.example/y',
      audio,
      mimeType: 'audio/wav',
      diarize: true,
      maxSpeakers: 2,
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const form = (init as RequestInit).body as FormData;
    expect(form.get('maxSpeakers')).toBe('2');
  });

  it('does not send maxSpeakers when diarize is false, even if maxSpeakers is provided', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ text: 'hi' }), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    await transcribeAudio({
      endpointUrl: 'https://maxspeakers-no-diarize.example/y',
      audio,
      mimeType: 'audio/wav',
      diarize: false,
      maxSpeakers: 2,
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const form = (init as RequestInit).body as FormData;
    expect(form.get('maxSpeakers')).toBeNull();
  });

  it('parses outcome, matchedVariant, and matchConfidence when the engine reports a system announcement', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          text: 'कृपया बाद में पुनः प्रयास करें',
          outcome: 'system_announcement',
          matchedVariant: 'hi',
          matchConfidence: 0.97,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const result = await transcribeAudio({ endpointUrl: 'https://announcement-match.example/y', audio, mimeType: 'audio/wav' });

    expect(result.outcome).toBe('system_announcement');
    expect(result.matchedVariant).toBe('hi');
    expect(result.matchConfidence).toBe(0.97);
  });

  it('tolerates a response with no outcome/matchedVariant/matchConfidence fields (older engine deployments)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ text: 'hello world' }), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    const result = await transcribeAudio({ endpointUrl: 'https://no-outcome-field.example/y', audio, mimeType: 'audio/wav' });

    expect(result.outcome).toBeUndefined();
    expect(result.matchedVariant).toBeUndefined();
    expect(result.matchConfidence).toBeUndefined();
  });

  it('throws when the engine returns a non-2xx status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(
      transcribeAudio({ endpointUrl: 'https://x/y', audio, mimeType: 'audio/mp3' })
    ).rejects.toThrow(/500/);
  });

  it('rethrows an AbortError when the engine call times out', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError);
    await expect(
      transcribeAudio({ endpointUrl: 'https://x/y', audio, mimeType: 'audio/mp3', timeoutMs: 50 })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  describe('circuit breaker', () => {
    it('trips on a network-level failure, then fails fast without calling fetch again', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
      const endpointUrl = 'https://circuit-network-failure.example/y';

      await expect(transcribeAudio({ endpointUrl, audio, mimeType: 'audio/mp3' })).rejects.toThrow('fetch failed');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await expect(transcribeAudio({ endpointUrl, audio, mimeType: 'audio/mp3' })).rejects.toMatchObject({
        name: 'EngineCircuitOpenError',
      });
      // The second call was blocked before ever reaching fetch.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not trip on a non-2xx response — the engine is reachable, just erroring', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
      const endpointUrl = 'https://circuit-http-error.example/y';

      await expect(transcribeAudio({ endpointUrl, audio, mimeType: 'audio/mp3' })).rejects.toMatchObject({
        name: 'EngineHttpError',
      });
      await expect(transcribeAudio({ endpointUrl, audio, mimeType: 'audio/mp3' })).rejects.toMatchObject({
        name: 'EngineHttpError',
      });
      // Both calls actually reached fetch — the circuit never opened.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not trip on an AbortError timeout — ambiguous, could just be slow processing', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));
      const endpointUrl = 'https://circuit-abort.example/y';

      await expect(
        transcribeAudio({ endpointUrl, audio, mimeType: 'audio/mp3', timeoutMs: 50 })
      ).rejects.toMatchObject({ name: 'AbortError' });
      await expect(
        transcribeAudio({ endpointUrl, audio, mimeType: 'audio/mp3', timeoutMs: 50 })
      ).rejects.toMatchObject({ name: 'AbortError' });

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('allows a call through again once the cooldown window has elapsed', async () => {
      vi.useFakeTimers();
      try {
        const fetchMock = vi
          .spyOn(globalThis, 'fetch')
          .mockRejectedValueOnce(new TypeError('fetch failed'))
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ text: 'recovered' }), { status: 200, headers: { 'content-type': 'application/json' } })
          );
        const endpointUrl = 'https://circuit-recovery.example/y';

        await expect(transcribeAudio({ endpointUrl, audio, mimeType: 'audio/mp3' })).rejects.toThrow('fetch failed');

        // Still within the cooldown — blocked without calling fetch.
        await expect(transcribeAudio({ endpointUrl, audio, mimeType: 'audio/mp3' })).rejects.toMatchObject({
          name: 'EngineCircuitOpenError',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // Cooldown has now passed — the next call should go through for real.
        vi.advanceTimersByTime(21_000);
        const result = await transcribeAudio({ endpointUrl, audio, mimeType: 'audio/mp3' });
        expect(result.text).toBe('recovered');
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
