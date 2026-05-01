// agentdir directory --skill summarize [--min-score 0.5] [--limit 5]
// Walks the seeded ENS subname list, ranks by reputation, prints top N.
//
// Until subname enumeration ships (subgraph wiring), the seed comes
// from a hardcoded list of demo agents. Override with --seed
// "alice.agentdir.eth,bob.agentdir.eth".
import { Directory, Storage, makeSigner } from "@agentdir/sdk";
import { require_ } from "./env.js";

const DEFAULT_SEED = [
  "alice.agentdir.eth",
  "bob.agentdir.eth",
  "vasu.agentdir.eth",
  "irony.agentdir.eth",
];

export async function directory(args: {
  skill: string;
  minScore?: number;
  limit?: number;
  lookback?: number;
  seed?: string;
}) {
  const seed = args.seed ? args.seed.split(",").map((s) => s.trim()) : DEFAULT_SEED;
  const pk = require_("PRIVATE_KEY");
  const signer = makeSigner(pk);
  const storage = new Storage({ signer });
  const dir = new Directory({
    ens: { network: "sepolia" },
    storage,
    seed,
  });

  console.log(`[directory] skill=${args.skill}  candidates=${seed.length}`);
  const ranked = await dir.query({
    skill: args.skill,
    minScore: args.minScore,
    limit: args.limit,
    lookback: args.lookback,
  });

  if (ranked.length === 0) {
    console.log(`[directory] no agents matching skill='${args.skill}' (or all below minScore)`);
    return;
  }

  console.log("");
  for (const [i, e] of ranked.entries()) {
    const tag = e.card.skills.find((s) => s.id === args.skill);
    const price = tag?.pricing?.x402
      ? `${(tag.pricing.x402 as any).amount} ${(tag.pricing.x402 as any).token}`
      : "free";
    const sigil = e.score.score >= 0.7 ? "★" : e.score.score >= 0.3 ? "◆" : "·";
    console.log(
      `${(i + 1).toString().padStart(2)}. ${sigil} ${e.ens.padEnd(28)}` +
        `  score=${e.score.score.toFixed(3)} (${e.score.ok}/${e.score.n} successes)` +
        `  iNFT=#${e.inftTokenId ?? "?"}  price=${price}`
    );
  }
}
