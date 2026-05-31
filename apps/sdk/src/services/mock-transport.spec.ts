import { describe, it, expect } from 'vitest';
import { MockTransport } from './mock-transport';
import type { ScenarioKey } from './mock-scenarios';
import type { StreamEvent } from '../types';

async function drain(key: ScenarioKey): Promise<StreamEvent[]> {
  const t = new MockTransport(key);
  const out: StreamEvent[] = [];
  for await (const e of t.parseSSE()) out.push(e);
  return out;
}

describe('MockTransport scenarios', () => {
  it('thinking → ends with done and contains a thinking part_start', async () => {
    const e = await drain('thinking');
    expect(e.some((x) => x.type === 'part_start' && x.partType === 'thinking')).toBe(true);
    expect(e[e.length - 1].type).toBe('done');
  });

  it('menu → carries a menu part with options', async () => {
    const e = await drain('menu');
    const menu = e.find((x) => x.partType === 'menu');
    expect(menu?.part?.type).toBe('menu');
    expect(menu?.part?.type === 'menu' && menu.part.options.length).toBeGreaterThan(0);
  });

  it('files → emits two file parts', async () => {
    const e = await drain('files');
    expect(e.filter((x) => x.partType === 'file')).toHaveLength(2);
  });

  it('image → emits an image part', async () => {
    const e = await drain('image');
    expect(e.some((x) => x.partType === 'image')).toBe(true);
  });

  it('error → terminates with an error event', async () => {
    const e = await drain('error');
    expect(e[e.length - 1].type).toBe('error');
  });

  it('defaults to the thinking scenario when constructed with no arg', async () => {
    const t = new MockTransport();
    const out: StreamEvent[] = [];
    for await (const ev of t.parseSSE()) out.push(ev);
    expect(out.some((x) => x.partType === 'thinking')).toBe(true);
  });

  it('setScenario switches the active scenario', async () => {
    const t = new MockTransport('thinking');
    t.setScenario('menu');
    const out: StreamEvent[] = [];
    for await (const ev of t.parseSSE()) out.push(ev);
    expect(out.some((x) => x.partType === 'menu')).toBe(true);
  });
});
