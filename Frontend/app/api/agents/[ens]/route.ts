import { NextResponse } from "next/server";
import { getEnsResolver } from "@/lib/sdk-server";
import { parseAgentCard } from "@agentdir/sdk/agent-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ens: string }> }
) {
  const { ens } = await ctx.params;
  if (!ens) {
    return NextResponse.json({ error: "missing ens param" }, { status: 400 });
  }

  try {
    const resolver = getEnsResolver();
    const bundle = await resolver.getRecordBundle(ens);
    const cardJson = bundle["org.a2a.agent-card"];

    if (!cardJson) {
      return NextResponse.json(
        {
          ens,
          bundle,
          card: null,
          error: "no org.a2a.agent-card text record",
        },
        { status: 404 }
      );
    }

    const card = parseAgentCard(cardJson);
    const axlPub = bundle["network.axl.pubkey"] ?? card.identity.axlPubkey;
    const verifyError = axlPub ? await resolver.verifyIdentity(ens, axlPub) : "no axl pubkey";

    return NextResponse.json({
      ens,
      card,
      records: bundle,
      identity: {
        axlPubkey: axlPub,
        verified: verifyError === null,
        verifyError,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "agent lookup failed" },
      { status: 500 }
    );
  }
}
