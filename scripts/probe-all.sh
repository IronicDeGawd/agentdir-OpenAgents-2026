#!/usr/bin/env bash
# Run every probe. Requires .env.local sourced.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f .env.local ]; then
  set -a; . ./.env.local; set +a
fi

PROBES=(
  "ens:pnpm -F probe-ens probe"
  "0g-compute:pnpm -F probe-0g-compute probe"
  "0g-storage:pnpm -F probe-0g-storage probe"
  "axl:bash probes/axl/run.sh"
  "keeperhub:bash probes/keeperhub/probe.sh"
  "uniswap:bash probes/uniswap/probe.sh"
)

PASS=()
FAIL=()
SKIP=()

for entry in "${PROBES[@]}"; do
  name="${entry%%:*}"
  cmd="${entry#*:}"
  echo ""
  echo "=========================================="
  echo "  PROBE: $name"
  echo "=========================================="
  if eval "$cmd"; then
    PASS+=("$name")
  else
    rc=$?
    if [ "$rc" -eq 2 ]; then SKIP+=("$name"); else FAIL+=("$name"); fi
  fi
done

echo ""
echo "=========================================="
echo "  SUMMARY"
echo "=========================================="
echo "PASS: ${PASS[*]:-(none)}"
echo "FAIL: ${FAIL[*]:-(none)}"
echo "SKIP: ${SKIP[*]:-(none)} (missing env vars)"
exit $((${#FAIL[@]} == 0 ? 0 : 1))
