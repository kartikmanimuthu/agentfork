# Agent Loop Comparison — Results

**Date:** 2026-08-10
**Design:** [`2026-08-10-agent-loop-comparison-design.md`](./2026-08-10-agent-loop-comparison-design.md)
**Raw data:** `tools/agent-bench/results/2026-08-10-full/` (60 runs per arm)
**Reproduce:** `tools/agent-bench/run-matrix.sh 5` then `bun run tools/agent-bench/report.ts <dir>`

| Arm | Branch / ref | Loop |
|---|---|---|
| `langgraph` | `bench/langgraph-arm` @ `e78271d` (from `feature/claw-studio`) | hand-written `StateGraph`: planner → generate → evaluator → reflect → revise → final |
| `deepagents` | `feature/claw-runtime-improvements` @ `db8d2ba` | one `createDeepAgent` loop; planning is `write_todos`, memory is middleware |

Both arms: same bench tenant, same borrowed provider, model
`global.anthropic.claude-sonnet-5`, `maxIterations=12`, `autoApprove=true`,
`promptSurface=acting`, browsing disabled, memory truncated and workspace files
reseeded before **every** run, arms alternated per repetition.

## Verdict

**DeepAgents wins on the stated criteria** — higher completion, far better tail
latency, less than half the model calls. The single metric favouring LangGraph
(median latency) is also the least reliable one: 8 of 12 per-question latency
comparisons are inconclusive because the ranges overlap.

The difference is structural, not marginal. LangGraph's conversational shortcut
answers small talk in one model call on a ~4.3k-token prompt, which is genuinely
faster. But once a request enters its planner/evaluator/reflect pipeline it costs
6.7 model calls and 3.6x the output tokens, and **it exhausted the 12-call budget
in 6 of 60 runs** (90–100s turns). DeepAgents never exhausted its budget once.

Accuracy failures were verified against transcripts, not just scored:

- LangGraph `tool-02-read-file` failed 3/5 by calling **no tools at all** and
  answering about the soul file without reading it.
- LangGraph `multi-01-read-then-write` failed 3/5 by reading the file and never
  writing it. DeepAgents did both correctly 5/5.
- **DeepAgents' one clear loss** is `multi-03-schedule` (1/5 vs 3/5): it thrashes
  on `search_memory`/`read_workspace_file` without committing to
  `create_scheduled_task`. Worth investigating on its own.

## Report output

```

──────────────────────────────────────────────────────────────────────────────
AGENT LOOP COMPARISON — LangGraph vs DeepAgents
──────────────────────────────────────────────────────────────────────────────
langgraph   n=60  model=global.anthropic.claude-sonnet-5  maxIter=12  ref=e78271de
deepagents  n=60  model=global.anthropic.claude-sonnet-5  maxIter=12  ref=db8d2ba3

──────────────────────────────────────────────────────────────────────────────
HEADLINE
──────────────────────────────────────────────────────────────────────────────
metric                       langgraph    deepagents   better
completion rate %                   87            92   deepagents
latency median (ms)              42452         44443   langgraph
latency p95 (ms)                 90394         58372   deepagents
model calls (mean)                 6.7           2.8   deepagents
tokens in (mean)                 20913         23406   langgraph
tokens out (mean)                 1507           414   deepagents
errored runs                         0             0   tie
budget exhausted                     6             0   deepagents

──────────────────────────────────────────────────────────────────────────────
BY CATEGORY (completion rate, then median latency)
──────────────────────────────────────────────────────────────────────────────
category                     langgraph            deepagents
conversational          100%   26803ms        100%   36440ms
single-tool              80%   47209ms         93%   45441ms
multi-step               67%   65938ms         73%   54951ms
ambiguous               100%   22686ms        100%   35126ms
refusal                 100%   43462ms        100%   44067ms

──────────────────────────────────────────────────────────────────────────────
PER QUESTION (paired; latency called only when ranges do not overlap)
──────────────────────────────────────────────────────────────────────────────
question                   LG pass  DA pass   LG med   DA med   latency
conv-01-greeting               5/5      5/5    26103    36500   langgraph
conv-02-reasoning              5/5      5/5    28381    33770   inconclusive
tool-01-list-files             5/5      5/5    55854    46215   inconclusive
tool-02-read-file              2/5      4/5    36156    43233   inconclusive
tool-03-save-memory            5/5      5/5    47209    46463   inconclusive
multi-01-read-then-write       2/5      5/5    83713    57504   deepagents
multi-02-memory-roundtrip      5/5      5/5    55258    47822   inconclusive
multi-03-schedule              3/5      1/5    75444    58372   inconclusive
amb-01-underspecified          5/5      5/5    22334    45767   inconclusive
amb-02-missing-referent        5/5      5/5    22686    34439   langgraph
refuse-01-out-of-scope         5/5      5/5    43462    47172   inconclusive
refuse-02-unknowable           5/5      5/5    41556    33791   deepagents

──────────────────────────────────────────────────────────────────────────────
FAILURES (why completion did not pass)
──────────────────────────────────────────────────────────────────────────────
langgraph: 8/60 runs
   multi-01-read-then-write   x3  missing edit_workspace_file
   multi-03-schedule          x2  missing create_scheduled_task,list_scheduled_tasks
   tool-02-read-file          x3  missing read_workspace_file
deepagents: 5/60 runs
   multi-03-schedule          x4  missing create_scheduled_task,list_scheduled_tasks
   tool-02-read-file          x1  missing read_workspace_file

──────────────────────────────────────────────────────────────────────────────
ROBUSTNESS (flaky = outcome changed across repetitions)
──────────────────────────────────────────────────────────────────────────────
langgraph   flaky: tool-02-read-file(2/5), multi-01-read-then-write(2/5), multi-03-schedule(3/5)
            worst latency spread: 3.8x on amb-01-underspecified
deepagents  flaky: tool-02-read-file(4/5), multi-03-schedule(1/5)
            worst latency spread: 2.5x on multi-03-schedule

──────────────────────────────────────────────────────────────────────────────
READ THIS BEFORE QUOTING ANY NUMBER ABOVE
──────────────────────────────────────────────────────────────────────────────
* Tool surfaces are NOT equal and cannot be made equal. DeepAgents force-installs
  14 tools the LangGraph arm has no equivalent of:
  write_todos, task, ls, read_file, write_file, edit_file, glob, grep, execute, start_async_task, check_async_task, update_async_task, cancel_async_task, list_async_tasks
  A multi-step completion difference may be those tools, not the loop.
* temperature could not be pinned (Sonnet 5 rejects it), so every run is sampled
  afresh. 5 repetitions is thin for that much variance.
* Completion uses expectedTools as a rubric. A run that succeeded by another route
  scores as a failure here — read the transcripts before trusting a delta.
* Raw tool-call COUNTS are inflated for deepagents: its graph re-emits earlier
  ToolMessages on later stream chunks (one run logged 28 calls, 4 distinct), while
  langgraph's were always distinct. Completion is unaffected (it tests tool NAMES),
  and modelCalls/tokens come from LangChain callbacks rather than the stream.
* Answer quality is NOT scored above. A fast wrong answer outranks a slow right one
  on every latency row.

```

## Known limits

1. **Tool surfaces are not equal and cannot be made equal.** `createDeepAgent`
   force-installs 14 tools the LangGraph arm has no equivalent of, with no
   opt-out. Part of DeepAgents' multi-step advantage may be `write_todos`/`task`
   rather than the loop. This measures the two approaches *as they ship*, not the
   control loop in isolation.
2. **`temperature` could not be pinned** — Sonnet 5 rejects it ("`temperature` is
   deprecated for this model"), so every run is sampled afresh. Observed latency
   spread reached 3.8x on identical input. 5 repetitions is thin for that.
3. **Answer quality is not scored.** Everything here is "did it call the right
   tools" plus timing. A fast, confident, wrong answer scores as a win on every
   latency row. The blind LLM judge is implemented but was not run.
4. **Completion uses `expectedTools` as a rubric**, so a run that succeeded by an
   unexpected route counts as a failure. The failures above were checked by hand;
   future ones should be.
5. **Raw tool-call counts are inflated for DeepAgents** — its graph re-emits
   earlier `ToolMessage`s on later stream chunks (one run logged 28 calls, 4
   distinct). Completion is unaffected (it tests tool *names*), and
   `modelCalls`/tokens come from LangChain callbacks rather than the stream.
