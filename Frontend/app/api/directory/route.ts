import { NextResponse } from "next/server";
import { getDirectory } from "@/lib/sdk-server";
import { apiError } from "@/lib/api-errors";
import { clampNum, parseSeed } from "@/lib/ens-validate";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// Node runtime — SDK pulls in ethers + 0G storage which won't run on Edge.
export const runtime = "nodejs";
// Cache 30s — directory ranking isn't truly real-time and ENS/storage RPCs
// are quota-sensitive.
export const revalidate = 30;

export async function GET(req: Request) {
  const rl = rateLimit(`dir:${clientIp(req)}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }
  const url = new URL(req.url);
  const skill = url.searchParams.get("skill") ?? "summarize";
  const minScore = clampNum(asNum(url.searchParams.get("minScore")), 0, 1, 0);
  const lookback = clampNum(asNum(url.searchParams.get("lookback")), 1, 500, 50);
  const limit = clampNum(asNum(url.searchParams.get("limit")), 1, 100, 25);

  const seedParam = url.searchParams.get("seed");
  let seed: string[] | undefined;
  if (seedParam) {
    const parsed = parseSeed(seedParam, 50);
    if (!parsed) {
      const { body, status } = apiError(
        "BAD_INPUT",
        new Error("invalid seed"),
        "directory",
      );
      return NextResponse.json(body, { status });
    }
    seed = parsed;
  }

  try {
    const dir = getDirectory(seed);
    const ranked = await dir.query({ skill, minScore, lookback, limit });

    return NextResponse.json({
      query: { skill, minScore, lookback, limit, seed: seed ?? "default" },
      count: ranked.length,
      results: ranked.map((e) => ({
        ens: e.ens,
        inftTokenId: e.inftTokenId,
        repHead: e.repHead,
        score: e.score,
        card: {
          name: e.card.name,
          description: e.card.description,
          identity: e.card.identity,
          skills: e.card.skills,
        },
      })),
    });
  } catch (err) {
    const { body, status } = apiError("DIRECTORY_FAILED", err, "directory");
    return NextResponse.json(body, { status });
  }
}

function asNum(v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
