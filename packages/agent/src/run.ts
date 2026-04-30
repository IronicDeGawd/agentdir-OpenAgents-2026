// Reference runtime entrypoint. `tsx src/run.ts` boots one agent.
// Reads .env.local at the repo root for secrets.

import { config } from "node:process";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { AxlClient, Compute, RepChain, Storage, makeSigner } from "@agentdir/sdk";
import { loadOrCreate } from "./identity.js";
import { Agent } from "./agent.js";
import { SkillRegistry, SUMMARIZE, SENTIMENT } from "./skills.js";

void config; // silence unused

// ── env loader (no dotenv dep) ──
const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "..", "..", "..", ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const HANDLE = process.env.AGENT_HANDLE ?? "alice";
const ENS_NAME = process.env.AGENT_ENS_NAME ?? `${HANDLE}.agentdir.eth`;
const AXL_BASE = process.env.AXL_BASE ?? "http://127.0.0.1:9002";

async function main() {
  if (!process.env.ZEROG_API_KEY) throw new Error("ZEROG_API_KEY missing");
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing");

  const id = await loadOrCreate(HANDLE, ENS_NAME);
  console.log(`[agent] handle=${id.handle} ens=${id.ensName}`);
  console.log(`[agent] axl-pubkey=${id.axlPubkeyHex}`);

  const axl = new AxlClient(AXL_BASE);
  try {
    const top = await axl.topology();
    console.log(`[agent] axl-node-pubkey=${top.our_public_key}`);
  } catch {
    console.warn(`[agent] WARN: AXL node not reachable at ${AXL_BASE}`);
  }

  const compute = new Compute({
    apiKey: process.env.ZEROG_API_KEY!,
    network: "testnet",
    model: process.env.ZEROG_MODEL ?? "qwen/qwen-2.5-7b-instruct",
  });

  const signer = makeSigner(process.env.PRIVATE_KEY!);
  const storage = new Storage({ signer });
  const rep = new RepChain(storage);

  const skills = new SkillRegistry().add(SUMMARIZE).add(SENTIMENT);

  const agent = new Agent({ identity: id, axl, compute, storage, rep, skills });
  console.log(`[agent] running. skills: ${skills.list().map((s) => s.id).join(", ")}`);

  process.on("SIGINT", () => {
    console.log("[agent] stopping...");
    agent.stop();
    process.exit(0);
  });

  await agent.start();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
