import Link from "next/link";
import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";
import { getEnsResolver } from "@/lib/sdk-server";
import { parseAgentCard } from "@agentdir/sdk/agent-card";
import type { AgentCard } from "@agentdir/sdk";
import { CallPanel } from "./call-panel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PageProps = { params: Promise<{ ens: string }> };

export default async function CallPage({ params }: PageProps) {
  const { ens } = await params;
  const decoded = decodeURIComponent(ens);
  const data = await loadCallee(decoded);

  return (
    <main className="relative min-h-screen overflow-x-hidden noise-overlay">
      <Navigation />

      <section className="pt-32 pb-12 lg:pt-40">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
          <div className="mb-6 flex items-center gap-3 text-sm font-mono text-muted-foreground">
            <Link href="/directory" className="hover:text-foreground">
              ← directory
            </Link>
            <span>/</span>
            <Link href={`/agents/${decoded}`} className="hover:text-foreground">
              {decoded}
            </Link>
            <span>/</span>
            <span className="text-foreground">call</span>
          </div>

          <div className="mb-12">
            <span className="inline-flex items-center gap-3 text-sm font-mono text-muted-foreground mb-6">
              <span className="w-8 h-px bg-foreground/30" />
              The roundtrip
            </span>
            <h1 className="text-4xl lg:text-6xl font-display tracking-tight">
              Call <span className="text-muted-foreground">{decoded}</span>
            </h1>
            <p className="mt-4 text-muted-foreground max-w-2xl">
              Fire a signed skill request. The trace below shows every step:
              ENS resolve, identity verify, ed25519 sign, LocalBus dispatch,
              0G Compute, response signature verify, and the rep attestation
              uploaded to 0G Storage.
            </p>
          </div>

          {data.kind === "error" ? (
            <ErrorPanel ens={decoded} message={data.message} />
          ) : (
            <CallPanel ens={decoded} card={data.card} />
          )}
        </div>
      </section>

      <FooterSection />
    </main>
  );
}

type LoadResult =
  | { kind: "ok"; card: AgentCard }
  | { kind: "error"; message: string };

async function loadCallee(ens: string): Promise<LoadResult> {
  try {
    const resolver = getEnsResolver();
    const bundle = await resolver.getRecordBundle(ens);
    const cardJson = bundle["org.a2a.agent-card"];
    if (!cardJson) return { kind: "error", message: "Agent has no AgentCard published" };
    const card = parseAgentCard(cardJson);
    return { kind: "ok", card };
  } catch (err) {
    console.error("[page:call] load failed", err);
    return { kind: "error", message: "Agent lookup failed" };
  }
}

function ErrorPanel({ ens, message }: { ens: string; message: string }) {
  return (
    <div className="border border-destructive/40 bg-destructive/5 px-6 py-6 font-mono text-sm">
      <div className="text-destructive mb-2">Cannot call {ens}</div>
      <div className="text-muted-foreground">{message}</div>
    </div>
  );
}
