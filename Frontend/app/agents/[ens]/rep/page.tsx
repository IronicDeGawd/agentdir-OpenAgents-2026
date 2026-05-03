import Link from "next/link";
import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";
import { getEnsResolver, getRepChain } from "@/lib/sdk-server";
import type { RepAttestation } from "@agentdir/sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ ens: string }>;
  searchParams: Promise<{ limit?: string }>;
};

export default async function RepPage({ params, searchParams }: PageProps) {
  const { ens } = await params;
  const sp = await searchParams;
  const decoded = decodeURIComponent(ens);
  const limit = clampNum(sp.limit, 50, 1, 200);
  const data = await loadRep(decoded, limit);

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
            <span className="text-foreground">rep</span>
          </div>

          <h1 className="text-5xl lg:text-7xl font-display tracking-tight mb-4 break-all">
            Reputation chain
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mb-8 leading-relaxed">
            Append-only signed attestations on 0G Storage. Walk starts at the
            head pointer published as{" "}
            <span className="font-mono text-foreground">network.agentdir.rep-head</span>{" "}
            on {decoded}. Each entry references the previous via prevRoot.
          </p>

          {data.kind === "ok" ? (
            <RepBody decoded={decoded} data={data} limit={limit} />
          ) : data.kind === "no-head" ? (
            <NoHeadPanel ens={decoded} />
          ) : (
            <ErrorPanel ens={decoded} message={data.message} />
          )}
        </div>
      </section>

      <FooterSection />
    </main>
  );
}

type LoadResult =
  | { kind: "ok"; head: string; axlPub: string | null; entries: RepAttestation[] }
  | { kind: "no-head" }
  | { kind: "error"; message: string };

async function loadRep(ens: string, limit: number): Promise<LoadResult> {
  try {
    const resolver = getEnsResolver();
    const bundle = await resolver.getRecordBundle(ens);
    const head = bundle["network.agentdir.rep-head"] ?? null;
    const axlPub = bundle["network.axl.pubkey"] ?? null;
    if (!head) return { kind: "no-head" };

    const chain = getRepChain();
    const entries = await chain.walk(head, limit, axlPub ?? undefined);
    return { kind: "ok", head, axlPub, entries };
  } catch (err) {
    console.error("[page:rep] fetch failed", err);
    return { kind: "error", message: "Reputation lookup failed" };
  }
}

function RepBody({
  decoded,
  data,
  limit,
}: {
  decoded: string;
  data: Extract<LoadResult, { kind: "ok" }>;
  limit: number;
}) {
  const { head, axlPub, entries } = data;
  const okCount = entries.filter((e) => e.ok).length;
  const teeCount = entries.filter((e) => e.teeAttestation?.verified === true).length;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-foreground/10 border border-foreground/10 mb-12">
        <Stat label="Entries shown" value={String(entries.length)} />
        <Stat label="Successes" value={`${okCount}/${entries.length}`} />
        <Stat label="TEE-verified" value={`${teeCount}/${entries.length}`} />
        <Stat
          label="Sig verification"
          value={axlPub ? "ed25519 ✓" : "no axl pubkey"}
        />
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-3 text-xs font-mono text-muted-foreground">
        <span>head:</span>
        <span className="break-all text-foreground">{head}</span>
        <span className="opacity-50">·</span>
        <span>limit: {limit}</span>
        {limit !== 50 && (
          <>
            <span className="opacity-50">·</span>
            <Link
              href={`/agents/${decoded}/rep`}
              className="underline underline-offset-4 hover:text-foreground"
            >
              reset to 50
            </Link>
          </>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="border border-foreground/10 px-6 py-12 text-center">
          <p className="text-base">
            Head exists, but the chain returned no walkable entries.
          </p>
          <p className="font-mono text-xs text-muted-foreground mt-2">
            (Sig verify may have stopped at the first invalid entry.)
          </p>
        </div>
      ) : (
        <ol className="border border-foreground/10">
          {entries.map((att, idx) => (
            <RepRow key={`${att.prevRoot ?? "genesis"}-${idx}`} att={att} index={idx} />
          ))}
        </ol>
      )}
    </>
  );
}

function RepRow({ att, index }: { att: RepAttestation; index: number }) {
  const ts = new Date(att.ts * 1000);
  const tee = att.teeAttestation;
  return (
    <li className="px-6 py-5 border-b border-foreground/5 last:border-b-0 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-center">
      <div className="lg:col-span-1 font-mono text-sm text-muted-foreground">
        #{String(index + 1).padStart(2, "0")}
      </div>

      <div className="lg:col-span-2">
        {att.ok ? (
          <span className="inline-flex items-center gap-2 px-3 py-1 border border-green-600/40 bg-green-500/5 text-green-700 dark:text-green-400 text-xs font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> ok
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 px-3 py-1 border border-destructive/40 bg-destructive/5 text-destructive text-xs font-mono">
            failed
          </span>
        )}
      </div>

      <div className="lg:col-span-3">
        <div className="font-medium">{att.skill}</div>
        <div className="text-xs font-mono text-muted-foreground">
          {att.latencyMs}ms
        </div>
      </div>

      <div className="lg:col-span-3 font-mono text-xs text-muted-foreground">
        <div className="text-foreground">{ts.toISOString().slice(0, 19).replace("T", " ")}Z</div>
        <div>caller iNFT #{att.callerINFT}</div>
        <div>callee iNFT #{att.calleeINFT}</div>
      </div>

      <div className="lg:col-span-3 flex flex-wrap gap-2 justify-start lg:justify-end">
        {tee ? (
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border ${
              tee.verified
                ? "border-foreground bg-foreground text-background"
                : "border-foreground/20 text-muted-foreground"
            }`}
            title={`provider ${tee.provider}\nchatID ${tee.chatID}`}
          >
            {tee.verified ? "TEE✓" : "TEE×"}
          </span>
        ) : null}
        <span className="px-2 py-1 text-xs font-mono border border-foreground/10 text-muted-foreground">
          v{att.v}
        </span>
        {att.prevRoot ? (
          <span
            className="px-2 py-1 text-xs font-mono border border-foreground/10 text-muted-foreground"
            title={`prevRoot ${att.prevRoot}`}
          >
            ← prev
          </span>
        ) : (
          <span className="px-2 py-1 text-xs font-mono border border-foreground/10 text-muted-foreground">
            genesis
          </span>
        )}
      </div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background p-6">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground block mb-2">
        {label}
      </span>
      <span className="font-display text-3xl">{value}</span>
    </div>
  );
}

function NoHeadPanel({ ens }: { ens: string }) {
  return (
    <div className="border border-foreground/10 p-8">
      <h2 className="text-2xl font-display mb-3">No rep chain yet</h2>
      <p className="text-muted-foreground mb-4">
        {ens} hasn&apos;t published a{" "}
        <span className="font-mono text-foreground">network.agentdir.rep-head</span>{" "}
        text record. The agent has either never been called or never appended an attestation.
      </p>
      <Link href={`/agents/${ens}`} className="underline underline-offset-4">
        ← back to profile
      </Link>
    </div>
  );
}

function ErrorPanel({ ens, message }: { ens: string; message: string }) {
  return (
    <div className="border border-destructive/40 bg-destructive/5 p-8">
      <h2 className="text-2xl font-display mb-3">Couldn&apos;t walk rep chain</h2>
      <p className="font-mono text-sm text-muted-foreground mb-4">{message}</p>
      <Link href={`/agents/${ens}`} className="underline underline-offset-4">
        ← back to profile
      </Link>
    </div>
  );
}

function clampNum(
  v: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
