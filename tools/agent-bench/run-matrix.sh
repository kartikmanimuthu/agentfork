#!/usr/bin/env bash
# run-matrix.sh — runs the full comparison, alternating arms one repetition at a time.
#
# Alternation matters (spec §3.2): running all of A then all of B would load any
# drift in Bedrock latency onto whichever arm ran second, and that drift is large
# — the same question measured 62s and 27s on the same arm minutes apart.
#
# The arm is decided by which working tree the runner executes in, so this script
# only has to change directory. The harness is rsynced into the Arm A tree first
# so both arms provably run identical measurement code.
#
# Usage: tools/agent-bench/run-matrix.sh [reps] [out-dir]
set -euo pipefail

REPS="${1:-5}"
OUT="${2:-/Users/H2952/Documents/chatflow/bench-results/$(date +%Y%m%d-%H%M%S)}"
B_TREE="/Users/H2952/Documents/chatflow"
A_TREE="/Users/H2952/Documents/chatflow-langgraph"

# Browsing is out of scope for the comparison; Arm A has no such tools at all.
export CLAW_BROWSER_ENABLED=false

mkdir -p "$OUT"
rsync -a --delete "$B_TREE/tools/agent-bench/" "$A_TREE/tools/agent-bench/"
echo "[matrix] harness synced; out=$OUT reps=$REPS"

for ((rep = 0; rep < REPS; rep++)); do
  echo "[matrix] ── repetition $rep ──"
  (cd "$A_TREE" && bun run tools/agent-bench/runner.ts --arm=langgraph  --out="$OUT" --reps=1 --rep-start="$rep") 2>&1 | grep -E '^\[bench' || true
  (cd "$B_TREE" && bun run tools/agent-bench/runner.ts --arm=deepagents --out="$OUT" --reps=1 --rep-start="$rep") 2>&1 | grep -E '^\[bench' || true
done

echo "[matrix] done → $OUT"
