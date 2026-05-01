#!/usr/bin/env tsx
// agentdir CLI entrypoint. Tiny hand-rolled arg parser; one subcommand per file.
import { loadEnv } from "./env.js";
import { whoami } from "./cmd-whoami.js";
import { mint } from "./cmd-mint.js";
import { call } from "./cmd-call.js";
import { rep } from "./cmd-rep.js";
import { publish } from "./cmd-publish.js";
import { snapshot } from "./cmd-snapshot.js";
import { stateHistory } from "./cmd-state-history.js";

loadEnv();

const HELP = `agentdir <command> [flags]

Commands:
  whoami [--handle alice]
      Show local identity for <handle>.

  mint --handle alice --ens alice.agentdir.eth [--uri ipfs://...]
      Create/load local identity, mint AgentdirINFT on 0G Galileo, save tokenId.

  call --from alice --to <peerPubkey> --skill summarize --input '{"text":"..."}'
       [--axl-base http://127.0.0.1:9002] [--caller-inft <id>]
      Send a signed skill request and print verified response.

  rep --head <rootHash> [--limit 50] [--target <inftId>]
      Walk the reputation chain from head; optional success-rate score for target.

  publish --handle alice --ens alice.somename.eth [--rep-head <root>]
      Publish the agentdir text-record bundle (a2a-card, axl pubkey,
      iNFT pointer, rep head) to Sepolia ENS via the PublicResolver.
      Requires PRIVATE_KEY to own the name.

  snapshot --handle alice
      Manual memory snapshot rotation: serialize agent state to 0G Storage
      and anchor rootHash on the iNFT via setAgentStateRoot.

  state-history --handle alice [--limit 20] [--verify]
      Walk AgentStateUpdated events for the agent's iNFT. With --verify,
      download each snapshot blob and check the agent's signature.

Env (read from .env.local at repo root):
  PRIVATE_KEY        EVM key for on-chain ops + 0G storage uploads
  ZEROG_API_KEY      0G Compute Router key (only needed by agent runtime)
`;

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      out[k] = "true";
    } else {
      out[k] = v;
      i++;
    }
  }
  return out;
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    console.log(HELP);
    return;
  }
  const f = parseFlags(rest);

  switch (cmd) {
    case "whoami":
      await whoami({ handle: f.handle });
      return;
    case "mint":
      if (!f.handle || !f.ens) {
        console.error("mint requires --handle and --ens");
        process.exit(2);
      }
      await mint({ handle: f.handle, ens: f.ens, uri: f.uri });
      return;
    case "call":
      if (!f.from || !f.to || !f.skill || !f.input) {
        console.error("call requires --from, --to, --skill, --input");
        process.exit(2);
      }
      await call({
        from: f.from,
        to: f.to,
        skill: f.skill,
        input: f.input,
        axlBase: f["axl-base"],
        callerINFT: f["caller-inft"],
      });
      return;
    case "publish":
      if (!f.handle || !f.ens) {
        console.error("publish requires --handle and --ens");
        process.exit(2);
      }
      await publish({ handle: f.handle, ens: f.ens, repHead: f["rep-head"] });
      return;
    case "rep":
      if (!f.head) {
        console.error("rep requires --head");
        process.exit(2);
      }
      await rep({ head: f.head, limit: f.limit ? parseInt(f.limit, 10) : undefined, target: f.target });
      return;
    case "snapshot":
      if (!f.handle) {
        console.error("snapshot requires --handle");
        process.exit(2);
      }
      await snapshot({ handle: f.handle });
      return;
    case "state-history":
      if (!f.handle) {
        console.error("state-history requires --handle");
        process.exit(2);
      }
      await stateHistory({
        handle: f.handle,
        limit: f.limit ? parseInt(f.limit, 10) : undefined,
        verify: f.verify === "true",
      });
      return;
    default:
      console.error(`unknown command: ${cmd}`);
      console.log(HELP);
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
