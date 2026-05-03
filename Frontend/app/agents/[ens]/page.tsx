import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";
import { getEnsResolver } from "@/lib/sdk-server";
import { parseAgentCard } from "@agentdir/sdk/agent-card";
import {
  AGENTDIR,
  ENS_APP,
  ETHERSCAN_ADDRESS,
  ZG_EXPLORER_ADDRESS,
} from "@/lib/agentdir";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PageProps = { params: Promise<{ ens: string }> };

export default async function AgentPage({ params }: PageProps) {
  const { ens } = await params;
  const decoded = decodeURIComponent(ens);
  const data = await loadAgent(decoded);

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
            <span className="text-foreground">{decoded}</span>
          </div>

          {data.kind === "error" ? (
            <ErrorPanel ens={decoded} message={data.message} />
          ) : data.kind === "not-found" ? (
            <NotFoundPanel ens={decoded} bundle={data.bundle} />
          ) : (
            <AgentBody ens={decoded} data={data} />
          )}
        </div>
      </section>

      <FooterSection />
    </main>
  );
}

type LoadResult =
  | { kind: "ok"; card: ReturnType<typeof parseAgentCard>; records: Record<string, string>; verified: boolean | null; verifyError: string | null; axlPub: string | null }
  | { kind: "not-found"; bundle: Record<string, string> }
  | { kind: "error"; message: string };

async function loadAgent(ens: string): Promise<LoadResult> {
  try {
    const resolver = getEnsResolver();
    const bundleRaw = await resolver.getRecordBundle(ens);
    const bundle: Record<string, string> = {};
    for (const [k, v] of Object.entries(bundleRaw)) {
      if (typeof v === "string") bundle[k] = v;
    }

    const cardJson = bundle["org.a2a.agent-card"];
    if (!cardJson) return { kind: "not-found", bundle };

    const card = parseAgentCard(cardJson);
    const axlPub = bundle["network.axl.pubkey"] ?? card.identity.axlPubkey ?? null;

    let verified: boolean | null = null;
    let verifyError: string | null = null;
    if (axlPub) {
      try {
        const err = await resolver.verifyIdentity(ens, axlPub);
        verified = err === null;
        verifyError = err;
      } catch (e) {
        console.error("[page:agent] verifyIdentity threw", e);
        verified = false;
        verifyError = "verification failed";
      }
    }

    return { kind: "ok", card, records: bundle, verified, verifyError: normalizeVerifyError(verifyError), axlPub };
  } catch (err) {
    console.error("[page:agent] fetch failed", err);
    return { kind: "error", message: "Agent lookup failed" };
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

function AgentBody({ ens, data }: { ens: string; data: Extract<LoadResult, { kind: "ok" }> }) {
  const { card, records, verified, verifyError, axlPub } = data;
  const tokenId = records["org.erc7857.tokenId"] ?? null;
  const inftContract = records["org.erc7857.contract"] ?? AGENTDIR.inft.address;
  const repHead = records["network.agentdir.rep-head"] ?? null;
  const bootstrap = records["network.axl.bootstrap"] ?? null;

  return (
    <>
      <div className="grid lg:grid-cols-12 gap-12 mb-16">
        <div className="lg:col-span-8">
          <h1 className="text-5xl lg:text-7xl font-display tracking-tight mb-6 break-all">
            {ens}
          </h1>
          {card.description ? (
            <p className="text-xl text-muted-foreground leading-relaxed max-w-2xl mb-8">
              {card.description}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <VerifiedBadge verified={verified} reason={verifyError} />
            <Badge>A2A v{card.protocolVersion}</Badge>
            {tokenId ? <Badge>iNFT #{tokenId}</Badge> : null}
            {bootstrap ? <Badge>{bootstrap}</Badge> : null}
            <Link
              href={`/call/${ens}`}
              className="inline-flex items-center gap-1 px-3 py-1 border border-foreground bg-foreground text-background text-xs font-mono hover:bg-foreground/90 transition-colors"
            >
              Call this agent
              <ArrowUpRight className="w-3 h-3" />
            </Link>
            {repHead ? (
              <Link
                href={`/agents/${ens}/rep`}
                className="inline-flex items-center gap-1 px-3 py-1 border border-foreground/20 text-xs font-mono hover:bg-foreground/5 transition-colors"
              >
                Walk rep chain
                <ArrowUpRight className="w-3 h-3" />
              </Link>
            ) : null}
          </div>
        </div>

        <div className="lg:col-span-4">
          <div className="border border-foreground/10 p-6">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground block mb-4">
              External
            </span>
            <ExternalLinks ens={ens} inftContract={inftContract} />
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-px bg-foreground/10 border border-foreground/10 mb-16">
        <Pane title="Identity">
          <Row k="ENS name" v={ens} />
          <Row k="AXL pubkey" v={axlPub ? short(axlPub) : "—"} mono full={axlPub ?? undefined} />
          <Row k="Token URL" v={card.url} mono />
          <Row k="Version" v={card.version} />
        </Pane>
        <Pane title="iNFT">
          <Row k="Standard" v="ERC-7857" />
          <Row k="Chain" v={`0G Galileo (${AGENTDIR.inft.chainId})`} />
          <Row k="Contract" v={short(inftContract)} mono full={inftContract} />
          <Row k="Token id" v={tokenId ? `#${tokenId}` : "—"} />
        </Pane>
      </div>

      <div className="mb-16">
        <h2 className="text-3xl lg:text-4xl font-display mb-8">
          Skills <span className="text-muted-foreground">({card.skills.length})</span>
        </h2>
        <div className="grid md:grid-cols-2 gap-px bg-foreground/10 border border-foreground/10">
          {card.skills.map((s) => {
            const price = s.pricing?.x402
              ? `${(s.pricing.x402 as any).amount} ${(s.pricing.x402 as any).token}`
              : "free";
            return (
              <div key={s.id} className="bg-background p-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{s.name || s.id}</span>
                  <span className="font-mono text-xs text-muted-foreground">{price}</span>
                </div>
                <div className="font-mono text-xs text-muted-foreground mb-3">{s.id}</div>
                {s.description ? (
                  <p className="text-sm text-muted-foreground leading-relaxed">{s.description}</p>
                ) : null}
                {s.tags?.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {s.tags.map((t) => (
                      <span key={t} className="text-[10px] font-mono px-2 py-0.5 border border-foreground/10 text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mb-24">
        <h2 className="text-3xl lg:text-4xl font-display mb-8">ENS text records</h2>
        <div className="border border-foreground/10 font-mono text-sm">
          {Object.entries(records).map(([k, v]) => (
            <div
              key={k}
              className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-2 lg:gap-6 px-6 py-4 border-b border-foreground/5 last:border-b-0"
            >
              <span className="text-muted-foreground">{k}</span>
              <span className="break-all">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function VerifiedBadge({ verified, reason }: { verified: boolean | null; reason: string | null }) {
  if (verified === true) {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1 border border-green-600/40 bg-green-500/5 text-green-700 dark:text-green-400 text-xs font-mono">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> verifyIdentity ✓
      </span>
    );
  }
  if (verified === false) {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1 border border-destructive/40 bg-destructive/5 text-destructive text-xs font-mono">
        verify failed: {reason ?? "unknown"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1 border border-foreground/10 text-muted-foreground text-xs font-mono">
      identity unverified
    </span>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-3 py-1 border border-foreground/10 text-xs font-mono text-muted-foreground">
      {children}
    </span>
  );
}

function ExternalLinks({ ens, inftContract }: { ens: string; inftContract: string }) {
  return (
    <ul className="space-y-2 text-sm">
      <li>
        <a
          href={ENS_APP(ens)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:underline underline-offset-4"
        >
          ENS app
          <ArrowUpRight className="w-3 h-3" />
        </a>
      </li>
      <li>
        <a
          href={ZG_EXPLORER_ADDRESS(inftContract)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:underline underline-offset-4"
        >
          iNFT contract on 0G
          <ArrowUpRight className="w-3 h-3" />
        </a>
      </li>
      <li>
        <a
          href={ETHERSCAN_ADDRESS(AGENTDIR.payments.wallet)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:underline underline-offset-4"
        >
          KH wallet (Sepolia)
          <ArrowUpRight className="w-3 h-3" />
        </a>
      </li>
    </ul>
  );
}

function Pane({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-background p-6 lg:p-8">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground block mb-4">
        {title}
      </span>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ k, v, mono, full }: { k: string; v: string; mono?: boolean; full?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground shrink-0">{k}</span>
      <span
        className={mono ? "font-mono text-right break-all" : "text-right"}
        title={full}
      >
        {v}
      </span>
    </div>
  );
}

function ErrorPanel({ ens, message }: { ens: string; message: string }) {
  return (
    <div className="border border-destructive/40 bg-destructive/5 p-8">
      <h1 className="text-3xl font-display mb-4">Couldn&apos;t load {ens}</h1>
      <p className="font-mono text-sm text-muted-foreground">{message}</p>
      <Link href="/directory" className="inline-block mt-6 underline underline-offset-4">
        ← back to directory
      </Link>
    </div>
  );
}

function NotFoundPanel({ ens, bundle }: { ens: string; bundle: Record<string, string> }) {
  const has = Object.keys(bundle).length > 0;
  return (
    <div className="border border-foreground/10 p-8">
      <h1 className="text-3xl font-display mb-4">No AgentCard at {ens}</h1>
      <p className="text-muted-foreground mb-6">
        The name resolves but doesn&apos;t publish an{" "}
        <span className="font-mono text-foreground">org.a2a.agent-card</span> text record.
      </p>
      {has ? (
        <>
          <p className="text-sm text-muted-foreground mb-3">Records found:</p>
          <pre className="font-mono text-xs bg-foreground/5 p-4 overflow-auto">
            {JSON.stringify(bundle, null, 2)}
          </pre>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No agentdir records published.</p>
      )}
    </div>
  );
}

function short(s: string): string {
  if (s.length <= 14) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}
