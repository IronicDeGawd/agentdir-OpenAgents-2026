# Probe: AXL

Validates Gensyn AXL primitives `agentdir` uses for inter-agent transport.

## What it checks

1. Node binary builds (Go 1.25 toolchain).
2. ed25519 key generation works (macOS LibreSSL caveat handled).
3. Two local nodes start on different `api_port`+`tcp_port` and join overlay.
4. `/topology` returns each node's pubkey.
5. Node A → Node B `/send` raw bytes; Node B `/recv` returns body + `X-From-Peer-Id`.
6. MCP service register on Node B; Node A `POST /mcp/{B_key}/<service>` round-trips JSON-RPC `tools/list`.
7. A2A agent-card fetch from Node A → `/a2a/{B_key}` returns Node B's card.

## Why these

- agentdir paid skill calls = MCP-over-AXL with x402 envelope. MCP roundtrip mandatory.
- A2A card serving from AXL = the bridge from ENS-published card to live skill call.
- Send/recv = reputation gossip transport (fallback when stream unavailable).

## Run

```bash
cd probes/axl
./run.sh                  # builds, generates keys, starts 2 nodes, runs all checks, tears down
```

Requires: `go` (1.25.x preferred; if 1.26+, script sets `GOTOOLCHAIN=go1.25.5`), `openssl` from Homebrew (not LibreSSL), `python3`, `curl`.

## Pass criteria

All 7 checks emit `PASS`. `run.sh` exits 0.

## Fail modes → what it tells us

- `algorithm ed25519 not found` → using macOS LibreSSL; install Homebrew openssl.
- Build fails on Go 1.26 → `GOTOOLCHAIN=go1.25.5` not honored; install Go 1.25 explicitly.
- `/recv` empty after `/send` → same `tcp_port` collision; fix port config.
- MCP roundtrip 404 → router not started or service not registered.
- A2A card empty → A2A server not started.
