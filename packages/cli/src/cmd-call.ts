// agentdir call --to <peerPubkey> --skill summarize --input '{"text":"..."}' [--from alice]
// Fires a SkillRequest, prints the verified response output.
import { AxlClient } from "@agentdir/sdk";
import { callSkill, loadOrCreate } from "@agentdir/agent";

export async function call(args: {
  from: string;
  to: string;
  skill: string;
  input: string;
  axlBase?: string;
  callerINFT?: string;
}) {
  const id = await loadOrCreate(args.from, null);
  const axl = new AxlClient(args.axlBase ?? "http://127.0.0.1:9002");

  let parsedInput: unknown;
  try {
    parsedInput = JSON.parse(args.input);
  } catch {
    console.error("--input must be valid JSON");
    process.exit(2);
  }

  console.log(`[call] from=${id.handle} (${id.axlPubkeyHex.slice(0, 8)}…) → to=${args.to.slice(0, 8)}…`);
  console.log(`[call] skill=${args.skill}`);

  const t0 = Date.now();
  const res = await callSkill({
    axl,
    destPubkey: args.to,
    callerPubkey: id.axlPubkeyHex,
    skill: args.skill,
    input: parsedInput,
    callerINFT: args.callerINFT ?? id.inftTokenId,
  });
  console.log(`[call] ok in ${Date.now() - t0}ms`);
  console.log(JSON.stringify(res.output, null, 2));
}
