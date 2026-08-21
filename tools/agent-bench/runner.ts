/**
 * runner.ts — drives ONE arm and writes JSONL.
 *
 * Which arm this measures is decided entirely by which working tree it runs in
 * (spec §2.1): it deep-imports `resolveClawRuntime` through the tree's own
 * tsconfig path, so `~/Documents/chatflow` measures DeepAgents and
 * `~/Documents/chatflow-langgraph` measures the LangGraph graph. There is no
 * arm flag, and therefore no way to mislabel a result.
 *
 * Deliberately structural about the runtime it gets back: the two arms'
 * ClawRuntime types differ slightly (Arm A has only `mcpCleanup`; Arm B added
 * `cleanup`), so this file assumes as little as possible and never imports an
 * arm-specific type.
 *
 * Usage:
 *   bun run tools/agent-bench/runner.ts --arm=<arm> --out=<dir> [--reps=N] [--only=id,id]
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { HumanMessage } from '@langchain/core/messages';
import { resolveClawRuntime } from '@chatbot/claw-studio/agent/claw-runtime';
import { getPrismaClient } from '@chatbot/shared';
import { CORPUS, type BenchQuestion } from './questions/corpus';
import { provisionBenchEnv, resetBenchState, type BenchEnv } from './bench-env';
import { ARMS, type Arm, type RunRecord, type ToolCall } from './record';

// ── Controls (spec §3). Identical on both arms; changing one invalidates a
// comparison against results produced with a different value. ───────────────
const MAX_ITERATIONS = 12;
/**
 * null = do not send `temperature` at all.
 *
 * The design pinned 0 to cut variance, but the borrowed model
 * (global.anthropic.claude-sonnet-5) rejects it outright: "`temperature` is
 * deprecated for this model." Both arms therefore run at the model default,
 * which is fair — same model, same setting — but noisier, so results need more
 * repetitions than a temperature-0 run would.
 */
const TEMPERATURE: number | null = null;
const PROMPT_SURFACE = 'acting' as const;
const AUTO_APPROVE = true;

interface Args {
  arm: Arm;
  out: string;
  reps: number;
  repStart: number;
  only: string[] | null;
}

function parseArgs(): Args {
  const get = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
  const arm = get('arm');
  if (!arm || !(ARMS as readonly string[]).includes(arm)) {
    throw new Error(`--arm must be one of ${ARMS.join(' | ')}`);
  }
  const out = get('out');
  if (!out) throw new Error('--out=<dir> is required');
  const only = get('only');
  return {
    arm: arm as Arm,
    out,
    reps: Number(get('reps') ?? 1),
    // Label for this pass's repetitions. The matrix driver alternates arms one
    // rep at a time (spec §3.2) by invoking the runner repeatedly with an
    // increasing offset, so drift in provider latency hits both arms equally
    // instead of loading onto whichever ran second.
    repStart: Number(get('rep-start') ?? 0),
    only: only ? only.split(',').map((s) => s.trim()).filter(Boolean) : null,
  };
}

function sh(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const hashArgs = (args: unknown) =>
  crypto.createHash('sha1').update(JSON.stringify(args ?? null)).digest('hex').slice(0, 12);

/**
 * Counts model usage at the LLM layer rather than from the transcript.
 *
 * Counting AIMessages in `state.values.messages` is NOT uniform across the
 * arms, which the first smoke run proved: Arm A synthesises its final answer as
 * a fresh AIMessage, so `usage_metadata` is lost (tokens reported as 0) and its
 * internal planner/evaluator/reflect calls never reach `messages` at all — it
 * reported 1 model call while taking 64% longer than Arm B on the same
 * question. LangChain callbacks fire for every model invocation inside either
 * graph, including internal ones, so this is the only measure that means the
 * same thing on both sides.
 */
interface LlmMeter {
  calls: number;
  input: number;
  output: number;
}

function createLlmMeter(): { meter: LlmMeter; handler: Record<string, unknown> } {
  const meter: LlmMeter = { calls: 0, input: 0, output: 0 };
  const handler = {
    handleLLMStart() {
      meter.calls += 1;
    },
    handleLLMEnd(output: {
      llmOutput?: { tokenUsage?: { promptTokens?: number; completionTokens?: number } };
      generations?: Array<Array<{ message?: { usage_metadata?: { input_tokens?: number; output_tokens?: number } } }>>;
    }) {
      const usage = output?.llmOutput?.tokenUsage;
      if (usage) {
        meter.input += usage.promptTokens ?? 0;
        meter.output += usage.completionTokens ?? 0;
        return;
      }
      // Bedrock/Anthropic via LangChain often carry usage on the message instead.
      for (const gen of output?.generations?.flat() ?? []) {
        meter.input += gen?.message?.usage_metadata?.input_tokens ?? 0;
        meter.output += gen?.message?.usage_metadata?.output_tokens ?? 0;
      }
    },
  };
  return { meter, handler };
}

/** Anything message-shaped enough to measure, without importing either arm's state type. */
interface MessageLike {
  constructor?: { name?: string };
  content?: unknown;
  tool_calls?: Array<{ name?: string; args?: unknown }>;
  usage_metadata?: { input_tokens?: number; output_tokens?: number };
  getType?: () => string;
}

function isAi(m: MessageLike): boolean {
  const t = typeof m.getType === 'function' ? m.getType() : undefined;
  return t ? t === 'ai' : m.constructor?.name === 'AIMessage';
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : typeof (c as { text?: string })?.text === 'string' ? (c as { text: string }).text : ''))
      .join('');
  }
  return '';
}

async function runOne(
  env: BenchEnv,
  question: BenchQuestion,
  repetition: number,
  arm: Arm,
): Promise<RunRecord> {
  // Fresh state for EVERY run: without this, question k conditions the agent
  // that answers k+1 and run order differs between arms (spec §3).
  await resetBenchState(env);

  const threadId = `bench-${arm}-${question.id}-r${repetition}-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  let timeToFirstTextMs: number | null = null;
  const toolCalls: ToolCall[] = [];
  const pendingToolStart = new Map<string, number>();
  let error: string | null = null;
  let runtime: { graph: unknown; config: unknown; cleanup?: unknown; mcpCleanup?: unknown } | null = null;
  const { meter, handler: meterHandler } = createLlmMeter();

  try {
    runtime = (await resolveClawRuntime({
      tenantId: env.tenantId,
      threadId,
      maxIterations: MAX_ITERATIONS,
      promptSurface: PROMPT_SURFACE,
      overrides: {
        autoApprove: AUTO_APPROVE,
        ...(TEMPERATURE === null ? {} : { temperature: TEMPERATURE }),
      },
    })) as never;

    const graph = (runtime as { graph: { stream: Function; getState: Function } }).graph;
    const config = (runtime as { config: object }).config;

    const stream = await graph.stream(
      { messages: [new HumanMessage(question.prompt)] },
      { ...config, streamMode: 'updates', callbacks: [meterHandler] },
    );

    for await (const chunk of stream as AsyncIterable<Record<string, { messages?: MessageLike[] }>>) {
      for (const update of Object.values(chunk ?? {})) {
        const messages = update?.messages ?? [];
        for (const m of messages) {
          if (isAi(m)) {
            if (timeToFirstTextMs === null && textOf(m.content).trim().length > 0) {
              timeToFirstTextMs = Date.now() - t0;
            }
            for (const call of m.tool_calls ?? []) {
              if (call?.name) pendingToolStart.set(`${call.name}:${hashArgs(call.args)}`, Date.now());
            }
          }
          // A ToolMessage closes the most recent matching request.
          const type = typeof m.getType === 'function' ? m.getType() : undefined;
          if (type === 'tool') {
            const name = (m as { name?: string }).name ?? 'unknown';
            const key = [...pendingToolStart.keys()].reverse().find((k) => k.startsWith(`${name}:`));
            const started = key ? pendingToolStart.get(key)! : t0;
            if (key) pendingToolStart.delete(key);
            const content = textOf(m.content);
            toolCalls.push({
              name,
              argsHash: key?.split(':')[1] ?? '',
              // Tools never throw here — they return a recoverable string — so a
              // failure is only visible as an "Error during …" payload.
              ok: !/^error\b|^error during/i.test(content.trim()),
              ms: Date.now() - started,
            });
          }
        }
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const totalMs = Date.now() - t0;

  // Post-run state gives the uniform model-call count and token totals: reading
  // either arm's own counter would compare different things (spec §4).
  let finalText = '';
  let interrupts = 0;
  try {
    const graph = (runtime as { graph: { getState: Function } } | null)?.graph;
    const config = (runtime as { config: object } | null)?.config;
    if (graph && config) {
      const state = await graph.getState(config);
      const messages: MessageLike[] = state?.values?.messages ?? [];
      for (const m of messages) {
        if (!isAi(m)) continue;
        const text = textOf(m.content).trim();
        if (text) finalText = text;
      }
      interrupts = (state?.tasks ?? []).flatMap((t: { interrupts?: unknown[] }) => t.interrupts ?? []).length;
    }
  } catch (e) {
    error ??= `state read failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  try {
    const rt = runtime as { cleanup?: () => Promise<void>; mcpCleanup?: () => Promise<void> } | null;
    await (rt?.cleanup ?? rt?.mcpCleanup)?.call(rt);
  } catch {
    // Teardown failure must not lose a completed measurement.
  }

  return {
    arm,
    questionId: question.id,
    repetition,
    startedAt,
    latency: { totalMs, timeToFirstTextMs },
    modelCalls: meter.calls,
    tokens: { input: meter.input, output: meter.output },
    toolCalls,
    toolsOffered: [],
    finalText,
    interrupts,
    budgetExhausted: /model call limits exceeded/i.test(finalText) || meter.calls >= MAX_ITERATIONS,
    error,
  };
}

async function main() {
  const args = parseArgs();
  const questions = args.only ? CORPUS.filter((q) => args.only!.includes(q.id)) : CORPUS;
  if (questions.length === 0) throw new Error('No questions selected.');

  fs.mkdirSync(args.out, { recursive: true });
  const jsonlPath = path.join(args.out, `${args.arm}.jsonl`);
  const manifestPath = path.join(args.out, `${args.arm}.manifest.json`);

  const env = await provisionBenchEnv();
  console.error(`[bench:${args.arm}] tenant=${env.tenantId} claw=${env.clawId} model=${env.model}`);
  console.error(`[bench:${args.arm}] ${questions.length} question(s) x ${args.reps} rep(s)`);

  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        arm: args.arm,
        startedAt: new Date().toISOString(),
        gitRef: sh('git rev-parse HEAD'),
        gitDirty: sh('git status --porcelain').length > 0,
        treePath: process.cwd(),
        controls: {
          maxIterations: MAX_ITERATIONS,
          temperature: TEMPERATURE,
          promptSurface: PROMPT_SURFACE,
          autoApprove: AUTO_APPROVE,
          model: env.model,
          repetitions: args.reps,
        },
        systemPrompt: '',
      },
      null,
      2,
    ),
  );

  for (let i = 0; i < args.reps; i += 1) {
    const rep = args.repStart + i;
    for (const question of questions) {
      const record = await runOne(env, question, rep, args.arm);
      fs.appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`);
      const status = record.error ? `ERROR ${record.error.slice(0, 60)}` : `${record.modelCalls} calls`;
      console.error(
        `[bench:${args.arm}] r${rep} ${question.id.padEnd(24)} ${String(record.latency.totalMs).padStart(6)}ms  ` +
          `${status}  tools=[${record.toolCalls.map((t) => t.name).join(',')}]`,
      );
    }
  }

  await getPrismaClient().$disconnect();
  console.error(`[bench:${args.arm}] wrote ${jsonlPath}`);
}

await main();
