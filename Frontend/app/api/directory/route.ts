import { NextResponse } from "next/server";
import { getDirectory } from "@/lib/sdk-server";

// Node runtime — SDK pulls in ethers + 0G storage which won't run on Edge.
export const runtime = "nodejs";
// Always live data; never serve a stale ranking.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const skill = url.searchParams.get("skill") ?? "summarize";
  const minScore = num(url.searchParams.get("minScore"));
  const lookback = num(url.searchParams.get("lookback"));
  const limit = num(url.searchParams.get("limit"));
  const seedParam = url.searchParams.get("seed");
  const seed = seedParam
    ? seedParam.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  try {
    const dir = getDirectory(seed);
    const ranked = await dir.query({
      skill,
      minScore,
      lookback,
      limit,
    });

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
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "directory query failed" },
      { status: 500 }
    );
  }
}

function num(v: string | null): number | undefined {
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
