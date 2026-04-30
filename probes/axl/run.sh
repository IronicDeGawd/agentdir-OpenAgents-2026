#!/usr/bin/env bash
# Phase-0 probe: AXL two-node send/recv + MCP roundtrip.
# Idempotent: re-running tears down previous artifacts.
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
WORK="$ROOT/.work"
AXL_DIR="$WORK/axl"
NODE_BIN="$AXL_DIR/node"
LOG_A="$WORK/node-a.log"
LOG_B="$WORK/node-b.log"
ROUTER_LOG="$WORK/router.log"
MCP_SERVICE_LOG="$WORK/mcp-service.log"
PIDS_FILE="$WORK/pids"

OPENSSL="${OPENSSL:-/opt/homebrew/opt/openssl/bin/openssl}"
[ -x "$OPENSSL" ] || OPENSSL="$(command -v openssl)"

PASS=0; FAIL=0
check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS  $name"; PASS=$((PASS+1))
  else
    echo "FAIL  $name"; FAIL=$((FAIL+1))
  fi
}

cleanup() {
  if [ -f "$PIDS_FILE" ]; then
    while read -r pid; do kill "$pid" 2>/dev/null || true; done < "$PIDS_FILE"
    rm -f "$PIDS_FILE"
  fi
}
trap cleanup EXIT

mkdir -p "$WORK"
: > "$WORK/.empty" 2>/dev/null && rm "$WORK/.empty"

# 1. Clone + build
if [ ! -d "$AXL_DIR/.git" ]; then
  echo "==> cloning axl"
  git clone --depth 1 https://github.com/gensyn-ai/axl.git "$AXL_DIR" >/dev/null 2>&1
fi
echo "==> building node binary"
( cd "$AXL_DIR" && GOTOOLCHAIN=go1.25.5 go build -o node ./cmd/node/ ) 2>&1 | tail -5
check "node binary built" test -x "$NODE_BIN"

# 2. Keys
echo "==> generating ed25519 keys"
"$OPENSSL" genpkey -algorithm ed25519 -out "$WORK/private-a.pem" 2>/dev/null
"$OPENSSL" genpkey -algorithm ed25519 -out "$WORK/private-b.pem" 2>/dev/null
check "key A generated" test -s "$WORK/private-a.pem"
check "key B generated" test -s "$WORK/private-b.pem"

# 3. Configs
# tcp_port must match on both sides — sender uses its own TCPPort to dial peer's gVisor stack.
cat > "$WORK/node-a.json" <<EOF
{ "PrivateKeyPath": "$WORK/private-a.pem", "Peers": [], "Listen": ["tls://0.0.0.0:9101"], "api_port": 9102, "tcp_port": 7100 }
EOF
cat > "$WORK/node-b.json" <<EOF
{ "PrivateKeyPath": "$WORK/private-b.pem", "Peers": ["tls://127.0.0.1:9101"], "api_port": 9112, "tcp_port": 7100 }
EOF

# 4. Start nodes
echo "==> starting nodes"
( cd "$AXL_DIR" && "$NODE_BIN" -config "$WORK/node-a.json" >"$LOG_A" 2>&1 ) &
echo $! >> "$PIDS_FILE"
sleep 1
( cd "$AXL_DIR" && "$NODE_BIN" -config "$WORK/node-b.json" >"$LOG_B" 2>&1 ) &
echo $! >> "$PIDS_FILE"
sleep 4

# 5. Topology
A_KEY=$(curl -s http://127.0.0.1:9102/topology 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin)['our_public_key'])" 2>/dev/null || echo "")
B_KEY=$(curl -s http://127.0.0.1:9112/topology 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin)['our_public_key'])" 2>/dev/null || echo "")
check "node A /topology" test -n "$A_KEY"
check "node B /topology" test -n "$B_KEY"
[ -n "$A_KEY" ] && echo "    A=$A_KEY"
[ -n "$B_KEY" ] && echo "    B=$B_KEY"

# 6. send/recv B→A — overlay tree needs a few seconds after peering
if [ -n "$A_KEY" ] && [ -n "$B_KEY" ]; then
  sleep 3   # let spanning tree converge
  curl -s -X POST http://127.0.0.1:9112/send -H "X-Destination-Peer-Id: $A_KEY" --data "hello-from-b" >/dev/null
  RESP=""
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    RESP=$(curl -s http://127.0.0.1:9102/recv)
    [ -n "$RESP" ] && break
    sleep 1
  done
  if [ "$RESP" = "hello-from-b" ]; then
    echo "PASS  send/recv B→A"; PASS=$((PASS+1))
  else
    echo "FAIL  send/recv B→A (got: '$RESP')"; FAIL=$((FAIL+1))
  fi
fi

# 7. MCP roundtrip — deferred. Requires Python pkg install + service script.
echo "SKIP  MCP roundtrip (deferred; see TODO)"
echo "SKIP  A2A agent-card fetch (deferred; see TODO)"

echo ""
echo "$PASS passed, $FAIL failed"
exit $((FAIL == 0 ? 0 : 1))
