/**
 * report.ts — turns two arms' JSONL into a paired comparison.
 *
 * Deliberately conservative about declaring winners (spec §6). Latency is
 * compared per question and only called when the two arms' observed ranges do
 * not overlap; with 5 repetitions, a model whose `temperature` could not be
 * pinned, and measured 2.3x spread on identical input, overlapping ranges mean
 * "no signal", not "a small win".
 *
 * Usage: bun run tools/agent-bench/report.ts <results-dir>
 */

import fs from 'node:fs';
import path from 'node:path';
import { CORPUS_BY_ID, type QuestionCategory } from './questions/corpus';
import { parseRecords, type RunRecord } from './record';
import { scoreCompletion, type CompletionScore } from './scorers/completion';
import { scoreEfficiency } from './scorers/efficiency';
import { scoreRobustness } from './scorers/robustness';

/**
 * Tools DeepAgents force-installs that the LangGraph arm does not have and
 * cannot be given (spec §3.1). Printed beside every result because a completion
 * difference on multi-step questions may be attributable to these rather than
 * to the control loop.
 */
const DEEPAGENTS_ONLY_TOOLS = [
  'write_todos', 'task', 'ls', 'read_file', 'write_file', 'edit_file', 'glob', 'grep', 'execute',
  'start_async_task', 'check_async_task', 'update_async_task', 'cancel_async_task', 'list_async_tasks',
];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : 0;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rate = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(0)}%` : '—');

function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: bun run tools/agent-bench/report.ts <results-dir>');

  const arms = ['langgraph', 'deepagents'] as const;
  const records: Record<string, RunRecord[]> = {};
  for (const arm of arms) {
    const file = path.join(dir, `${arm}.jsonl`);
    if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
    records[arm] = parseRecords(fs.readFileSync(file, 'utf8'));
  }

  const completions: Record<string, CompletionScore[]> = {};
  for (const arm of arms) completions[arm] = records[arm].map(scoreCompletion);

  const line = '─'.repeat(78);
  console.log(`\n${line}\nAGENT LOOP COMPARISON — LangGraph vs DeepAgents\n${line}`);
  for (const arm of arms) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, `${arm}.manifest.json`), 'utf8'));
    console.log(
      `${arm.padEnd(11)} n=${records[arm].length}  model=${m.controls.model}  maxIter=${m.controls.maxIterations}  ref=${String(m.gitRef).slice(0, 8)}`,
    );
  }

  // ── headline ──────────────────────────────────────────────────────────────
  console.log(`\n${line}\nHEADLINE\n${line}`);
  console.log(
    `${'metric'.padEnd(24)}${'langgraph'.padStart(14)}${'deepagents'.padStart(14)}   better`,
  );
  const rows: Array<[string, number, number, 'low' | 'high']> = [];
  for (const arm of arms) {
    const r = records[arm];
    const c = completions[arm];
    rows.push(['completion rate %', 0, 0, 'high']); // placeholder, filled below
    void r;
    void c;
  }
  rows.length = 0;

  const stat = (arm: string) => {
    const r = records[arm];
    const c = completions[arm];
    return {
      completion: (c.filter((x) => x.passed).length / c.length) * 100,
      medianMs: median(r.map((x) => x.latency.totalMs)),
      p95Ms: pct(r.map((x) => x.latency.totalMs), 95),
      calls: mean(r.map((x) => x.modelCalls)),
      tokIn: mean(r.map((x) => x.tokens.input)),
      tokOut: mean(r.map((x) => x.tokens.output)),
      errors: r.filter((x) => x.error).length,
      budget: r.filter((x) => x.budgetExhausted).length,
    };
  };
  const A = stat('langgraph');
  const B = stat('deepagents');

  const show = (label: string, a: number, b: number, better: 'low' | 'high', fmt = (n: number) => n.toFixed(0)) => {
    const win = a === b ? 'tie' : (better === 'low' ? a < b : a > b) ? 'langgraph' : 'deepagents';
    console.log(`${label.padEnd(24)}${fmt(a).padStart(14)}${fmt(b).padStart(14)}   ${win}`);
  };
  show('completion rate %', A.completion, B.completion, 'high', (n) => n.toFixed(0));
  show('latency median (ms)', A.medianMs, B.medianMs, 'low');
  show('latency p95 (ms)', A.p95Ms, B.p95Ms, 'low');
  show('model calls (mean)', A.calls, B.calls, 'low', (n) => n.toFixed(1));
  show('tokens in (mean)', A.tokIn, B.tokIn, 'low');
  show('tokens out (mean)', A.tokOut, B.tokOut, 'low');
  show('errored runs', A.errors, B.errors, 'low');
  show('budget exhausted', A.budget, B.budget, 'low');

  // ── by category ───────────────────────────────────────────────────────────
  console.log(`\n${line}\nBY CATEGORY (completion rate, then median latency)\n${line}`);
  const cats = [...new Set([...CORPUS_BY_ID.values()].map((q) => q.category))] as QuestionCategory[];
  console.log(`${'category'.padEnd(16)}${'langgraph'.padStart(22)}${'deepagents'.padStart(22)}`);
  for (const cat of cats) {
    const cells = arms.map((arm) => {
      const ids = new Set([...CORPUS_BY_ID.values()].filter((q) => q.category === cat).map((q) => q.id));
      const c = completions[arm].filter((x) => ids.has(x.questionId));
      const r = records[arm].filter((x) => ids.has(x.questionId));
      return `${rate(c.filter((x) => x.passed).length, c.length).padStart(5)} ${String(median(r.map((x) => x.latency.totalMs))).padStart(7)}ms`;
    });
    console.log(`${cat.padEnd(16)}${cells[0].padStart(22)}${cells[1].padStart(22)}`);
  }

  // ── per question, paired ──────────────────────────────────────────────────
  console.log(`\n${line}\nPER QUESTION (paired; latency called only when ranges do not overlap)\n${line}`);
  console.log(`${'question'.padEnd(26)}${'LG pass'.padStart(8)}${'DA pass'.padStart(9)}${'LG med'.padStart(9)}${'DA med'.padStart(9)}   latency`);
  for (const q of CORPUS_BY_ID.values()) {
    const cells = arms.map((arm) => {
      const c = completions[arm].filter((x) => x.questionId === q.id);
      const r = records[arm].filter((x) => x.questionId === q.id);
      const lat = r.map((x) => x.latency.totalMs);
      return { pass: c.filter((x) => x.passed).length, n: c.length, lat, med: median(lat) };
    });
    const [a, b] = cells;
    const overlap = Math.min(...a.lat) <= Math.max(...b.lat) && Math.min(...b.lat) <= Math.max(...a.lat);
    const verdict = overlap ? 'inconclusive' : a.med < b.med ? 'langgraph' : 'deepagents';
    console.log(
      `${q.id.padEnd(26)}${`${a.pass}/${a.n}`.padStart(8)}${`${b.pass}/${b.n}`.padStart(9)}` +
        `${String(a.med).padStart(9)}${String(b.med).padStart(9)}   ${verdict}`,
    );
  }

  // ── failures ──────────────────────────────────────────────────────────────
  console.log(`\n${line}\nFAILURES (why completion did not pass)\n${line}`);
  for (const arm of arms) {
    const failures = completions[arm].filter((x) => !x.passed);
    if (!failures.length) {
      console.log(`${arm}: none`);
      continue;
    }
    const grouped = new Map<string, { count: number; reason: string }>();
    for (const f of failures) {
      const key = `${f.questionId}|${f.reason}`;
      grouped.set(key, { count: (grouped.get(key)?.count ?? 0) + 1, reason: f.reason });
    }
    console.log(`${arm}: ${failures.length}/${completions[arm].length} runs`);
    for (const [key, v] of [...grouped.entries()].sort()) {
      console.log(`   ${key.split('|')[0].padEnd(26)} x${v.count}  ${v.reason}`);
    }
  }

  // ── robustness ────────────────────────────────────────────────────────────
  console.log(`\n${line}\nROBUSTNESS (flaky = outcome changed across repetitions)\n${line}`);
  for (const arm of arms) {
    const flaky: string[] = [];
    let spreadMax = 0;
    let spreadQ = '';
    for (const q of CORPUS_BY_ID.values()) {
      const c = completions[arm].filter((x) => x.questionId === q.id);
      const lat = records[arm].filter((x) => x.questionId === q.id).map((x) => x.latency.totalMs);
      const s = scoreRobustness(c, lat);
      if (s.flaky) flaky.push(`${q.id}(${c.filter((x) => x.passed).length}/${c.length})`);
      if (s.latencySpreadRatio > spreadMax) {
        spreadMax = s.latencySpreadRatio;
        spreadQ = q.id;
      }
    }
    console.log(`${arm.padEnd(11)} flaky: ${flaky.length ? flaky.join(', ') : 'none'}`);
    console.log(`${''.padEnd(11)} worst latency spread: ${spreadMax.toFixed(1)}x on ${spreadQ}`);
  }

  // ── caveats ───────────────────────────────────────────────────────────────
  console.log(`\n${line}\nREAD THIS BEFORE QUOTING ANY NUMBER ABOVE\n${line}`);
  console.log(`* Tool surfaces are NOT equal and cannot be made equal. DeepAgents force-installs`);
  console.log(`  ${DEEPAGENTS_ONLY_TOOLS.length} tools the LangGraph arm has no equivalent of:`);
  console.log(`  ${DEEPAGENTS_ONLY_TOOLS.join(', ')}`);
  console.log(`  A multi-step completion difference may be those tools, not the loop.`);
  console.log(`* temperature could not be pinned (Sonnet 5 rejects it), so every run is sampled`);
  console.log(`  afresh. 5 repetitions is thin for that much variance.`);
  console.log(`* Completion uses expectedTools as a rubric. A run that succeeded by another route`);
  console.log(`  scores as a failure here — read the transcripts before trusting a delta.`);
  console.log(`* Raw tool-call COUNTS are inflated for deepagents: its graph re-emits earlier`);
  console.log(`  ToolMessages on later stream chunks (one run logged 28 calls, 4 distinct), while`);
  console.log(`  langgraph's were always distinct. Completion is unaffected (it tests tool NAMES),`);
  console.log(`  and modelCalls/tokens come from LangChain callbacks rather than the stream.`);
  console.log(`* Answer quality is NOT scored above. A fast wrong answer outranks a slow right one`);
  console.log(`  on every latency row.\n`);
}

main();
