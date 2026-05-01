// agentdir rep --head <rootHash> [--limit 50] [--target <inftId>]
// Walks the rep chain on 0G Storage from head, prints each attestation,
// scores by target.
import { RepChain, Storage, makeSigner } from "@agentdir/sdk";
import { require_ } from "./env.js";

export async function rep(args: { head: string; limit?: number; target?: string }) {
  const pk = require_("PRIVATE_KEY");
  const signer = makeSigner(pk);
  const storage = new Storage({ signer });
  const chain = new RepChain(storage);

  const list = await chain.walk(args.head, args.limit ?? 50);
  for (const a of list) {
    const sym = a.ok ? "✓" : "✗";
    console.log(
      `${sym}  ${new Date(a.ts * 1000).toISOString()}  ` +
        `caller=${a.callerINFT} → callee=${a.calleeINFT}  ` +
        `skill=${a.skill}  latency=${a.latencyMs}ms`
    );
  }
  if (args.target) {
    const s = RepChain.score(list, args.target);
    console.log(`\nscore(${args.target}): ${s.ok}/${s.n} = ${(s.ratio * 100).toFixed(1)}%`);
  }
}
