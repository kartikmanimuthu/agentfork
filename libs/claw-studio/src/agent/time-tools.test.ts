import { describe, it, expect } from 'vitest';
import { createTimeTools } from './time-tools';

const FIXED = new Date('2026-08-18T09:30:00Z');
const tools = () => createTimeTools({ now: () => FIXED });
const call = async (args: Record<string, unknown>) => {
  const tool = tools().find((t) => t.name === 'get_current_time');
  if (!tool) throw new Error('get_current_time not registered');
  return (await tool.invoke(args)) as string;
};

describe('get_current_time', () => {
  // Claw had no way to learn the date: no time tool, and nothing in the system
  // prompt. So every "this week"/"this month" question sent it to web_fetch to
  // guess at public time APIs — worldtimeapi.org (connection reset), then
  // timeapi.io/get/time?city=London (404, wrong route shape). Three failed calls
  // and their outputs in context, for a fact the process already knows.
  it('reports UTC when no zone is given', async () => {
    const out = await call({});
    expect(out).toContain('2026-08-18');
    expect(out).toContain('UTC');
  });

  // The model stated "Monday, August 18, 2026" when the tool returned no weekday —
  // 2026-08-18 is a Tuesday. It had to invent the day name, and a 2-bit quantized
  // model inventing confidently is exactly the failure mode to design out rather
  // than prompt around. Return the weekday so there is nothing to guess.
  it('names the weekday, so the model never has to derive it', async () => {
    expect(await call({})).toContain('Tuesday');
    expect(await call({ timeZone: 'Asia/Tokyo' })).toContain('Tuesday');
  });

  it('names the weekday of the target zone, not of UTC', async () => {
    // 2026-08-18 23:30 UTC is already Wednesday the 19th in Tokyo (+09:00).
    const tools = createTimeTools({ now: () => new Date('2026-08-18T23:30:00Z') });
    const tool = tools.find((t) => t.name === 'get_current_time');
    const out = (await tool!.invoke({ timeZone: 'Asia/Tokyo' })) as string;
    expect(out).toContain('Wednesday');
    expect(out).toContain('2026-08-19');
  });

  it('converts to a named IANA zone, so DST is not left to the model to work out', async () => {
    // 09:30 UTC in August is 10:30 in London — BST, one hour ahead. A model doing
    // "UTC plus offset" arithmetic gets this wrong for half the year.
    const out = await call({ timeZone: 'Europe/London' });
    expect(out).toContain('10:30');
    expect(out).toContain('Europe/London');
  });

  it('handles a zone on the other side of UTC', async () => {
    const out = await call({ timeZone: 'Asia/Kolkata' });
    expect(out).toContain('15:00');
  });

  it('returns a recoverable error string for an unknown zone rather than throwing', async () => {
    // Tools must never throw — a thrown LangChain tool error aborts the whole
    // run. The leading "Error" also makes the timeline render it as a failure.
    const out = await call({ timeZone: 'Mars/Olympus_Mons' });
    expect(out).toMatch(/^Error/);
    expect(out).toContain('Mars/Olympus_Mons');
  });

  it('defaults the clock to the real one when no override is supplied', async () => {
    const tool = createTimeTools().find((t) => t.name === 'get_current_time');
    const out = (await tool!.invoke({})) as string;
    expect(out).toContain(String(new Date().getUTCFullYear()));
  });
});
