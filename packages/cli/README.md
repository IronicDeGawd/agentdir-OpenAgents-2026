# @agentdir/cli

Local-first CLI tying SDK + agent + contracts together.

## Commands

```
agentdir whoami [--handle alice]
agentdir mint --handle alice --ens alice.agentdir.eth [--uri ...]
agentdir call --from alice --to <peerPubkey> --skill summarize \
  --input '{"text":"..."}' [--axl-base http://127.0.0.1:9002]
agentdir rep --head <rootHash> [--limit 50] [--target <inftId>]
```

## Demo (two agents on one machine)

```bash
# Terminal 1 — AXL node A on default ports
./node -config alice-axl.json

# Terminal 2 — AXL node B on different api/tcp ports (must share tcp_port with A)
./node -config bob-axl.json

# Terminal 3 — start bob's agent runtime
AGENT_HANDLE=bob AGENT_ENS_NAME=bob.agentdir.eth AXL_BASE=http://127.0.0.1:9112 \
  pnpm agent:start

# Terminal 4 — alice mints + calls bob's summarize skill
pnpm cli mint --handle alice --ens alice.agentdir.eth
BOB_PUB=<bob_axl_pubkey>  # from `pnpm cli whoami --handle bob`
pnpm cli call --from alice --to $BOB_PUB --skill summarize \
  --input '{"text":"long story short..."}'
```
