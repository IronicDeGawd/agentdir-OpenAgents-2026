import { NextResponse } from "next/server";
import { getEnsResolver } from "@/lib/sdk-server";
import { parseAgentCard } from "@agentdir/sdk/agent-card";
import { apiError } from "@/lib/api-errors";
import { isValidEns } from "@/lib/ens-validate";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const revalidate = 30;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ ens: string }> }
) {
  const rl = rateLimit(`agent:${clientIp(req)}`, 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }
  const { ens } = await ctx.params;
  if (!isValidEns(ens)) {
    const { body, status } = apiError(
      "ENS_INVALID",
      new Error(`bad ens: ${String(ens).slice(0, 64)}`),
      "agent",
    );
    return NextResponse.json(body, { status });
  }

  try {
    const resolver = getEnsResolver();
    const bundle = await resolver.getRecordBundle(ens);
    const cardJson = bundle["org.a2a.agent-card"];

    if (!cardJson) {
      const { body, status } = apiError(
        "ENS_NOT_FOUND",
        new Error(`no agent-card text record for ${ens}`),
        "agent",
      );
      return NextResponse.json({ ...body, ens, bundle, card: null }, { status });
    }

    const card = parseAgentCard(cardJson);
    const axlPub = bundle["network.axl.pubkey"] ?? card.identity.axlPubkey;
    const verifyErrorRaw = axlPub
      ? await resolver.verifyIdentity(ens, axlPub)
      : "no axl pubkey";
    const verifyError = normalizeVerifyError(verifyErrorRaw);

    return NextResponse.json({
      ens,
      card,
      records: bundle,
      identity: {
        axlPubkey: axlPub,
        verified: verifyErrorRaw === null,
        verifyError,
      },
    });
  } catch (err) {
    const { body, status } = apiError("ENS_LOOKUP_FAILED", err, "agent");
    return NextResponse.json(body, { status });
  }
}

function normalizeVerifyError(raw: string | null): string | null {
  if (raw === null) return null;
  const s = raw.toLowerCase();
  if (s.includes("no axl")) return "missing AXL pubkey";
  if (s.includes("mismatch") || s.includes("does not match")) return "signature mismatch";
  if (s.includes("controller")) return "missing controller";
  if (s.includes("rpc") || s.includes("network")) return "rpc error";
  return "verification failed";
}
