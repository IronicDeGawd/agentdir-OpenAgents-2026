# @agentdir/cli

Local-first CLI tying SDK + agent + contracts together.

## Commands

```
agentdir whoami [--handle alice]
agentdir mint --handle alice --ens alice.agentdir.eth [--uri ...]
agentdir publish --handle alice --ens alice.<name>.eth [--rep-head <root>]
agentdir call --from alice --to <peerPubkey> --skill summarize \
  --input '{"text":"..."}' [--axl-base http://127.0.0.1:9002]
agentdir rep --head <rootHash> [--limit 50] [--target <inftId>]
```

### `publish` setup

`publish` calls `setText` on the Sepolia PublicResolver
(`0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5`). Requires `PRIVATE_KEY` to
own the ENS name. To get one:

1. Open https://sepolia.app.ens.domains and connect with the wallet whose
   key sits in `.env.local`.
2. Register a name (e.g. `agentdir-test.eth`) — costs minimal Sepolia ETH.
3. After registration, run `agentdir publish --handle alice --ens
   alice.agentdir-test.eth` (or use the bare name).
4. Records become resolvable globally — verify with
   `pnpm probe:ens` against your name.

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
