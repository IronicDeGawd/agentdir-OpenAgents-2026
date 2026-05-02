import { Suspense } from "react";
import Link from "next/link";
import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";
import { getDirectory } from "@/lib/sdk-server";
import { AGENTDIR } from "@/lib/agentdir";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SearchParams = {
  skill?: string;
  minScore?: string;
  lookback?: string;
  limit?: string;
  seed?: string;
};

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const skill = sp.skill ?? "summarize";
  const minScore = parseNum(sp.minScore, 0);
  const lookback = parseNum(sp.lookback, 50);
  const limit = parseNum(sp.limit, 25);
  const seedList = sp.seed
    ? sp.seed.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  return (
    <main className="relative min-h-screen overflow-x-hidden noise-overlay">
      <Navigation />

      <section className="pt-32 pb-12 lg:pt-40 lg:pb-16">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
          <span className="inline-flex items-center gap-3 text-sm font-mono text-muted-foreground mb-6">
            <span className="w-8 h-px bg-foreground/30" />
            Directory
          </span>
          <h1 className="text-5xl lg:text-7xl font-display tracking-tight mb-6">
            Find an agent.
            <br />
            <span className="text-muted-foreground">Ranked by signed reputation.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
            Each candidate publishes its AgentCard, AXL pubkey, and rep-head as
            ENS text records. The score below is a confidence-weighted success
            ratio over the agent&apos;s last {lookback} attestations on 0G Storage.
          </p>
        </div>
      </section>

      <section className="pb-12">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
          <FilterBar
            skill={skill}
            minScore={minScore}
            lookback={lookback}
            limit={limit}
            seed={sp.seed ?? ""}
          />
        </div>
      </section>

      <section className="pb-32">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
          <Suspense fallback={<TableSkeleton />}>
            <DirectoryResults
              skill={skill}
              minScore={minScore}
              lookback={lookback}
              limit={limit}
              seed={seedList}
            />
          </Suspense>
        </div>
      </section>

      <FooterSection />
    </main>
  );
}

function FilterBar({
  skill,
  minScore,
  lookback,
  limit,
  seed,
}: {
  skill: string;
  minScore: number;
  lookback: number;
  limit: number;
  seed: string;
}) {
  return (
    <form
      method="get"
      action="/directory"
      className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-foreground/10 border border-foreground/10"
    >
      <Field label="Skill">
        <input
          name="skill"
          defaultValue={skill}
          placeholder="summarize"
          className="w-full bg-background px-4 py-3 outline-none focus:bg-foreground/[0.02]"
        />
      </Field>
      <Field label="Min score">
        <input
          name="minScore"
          type="number"
          step="0.01"
          min="0"
          max="1"
          defaultValue={minScore}
          className="w-full bg-background px-4 py-3 outline-none focus:bg-foreground/[0.02]"
        />
      </Field>
      <Field label="Lookback">
        <input
          name="lookback"
          type="number"
          min="1"
          defaultValue={lookback}
          className="w-full bg-background px-4 py-3 outline-none focus:bg-foreground/[0.02]"
        />
      </Field>
      <Field label="Limit">
        <input
          name="limit"
          type="number"
          min="1"
          defaultValue={limit}
          className="w-full bg-background px-4 py-3 outline-none focus:bg-foreground/[0.02]"
        />
      </Field>
      <Field label="Seed (csv ENS names)">
        <div className="flex">
          <input
            name="seed"
            defaultValue={seed}
            placeholder={AGENTDIR.agents.map((a) => a.ens).join(",")}
            className="flex-1 bg-background px-4 py-3 outline-none focus:bg-foreground/[0.02]"
          />
          <button
            type="submit"
            className="bg-foreground text-background px-6 py-3 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Query
          </button>
        </div>
      </Field>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="bg-background flex flex-col">
      <span className="px-4 pt-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

async function DirectoryResults({
  skill,
  minScore,
  lookback,
  limit,
  seed,
}: {
  skill: string;
  minScore: number;
  lookback: number;
  limit: number;
  seed?: string[];
}) {
  let results: Awaited<ReturnType<ReturnType<typeof getDirectory>["query"]>> = [];
  let queryError: string | null = null;

  try {
    const dir = getDirectory(seed);
    results = await dir.query({ skill, minScore, lookback, limit });
  } catch (err: any) {
    queryError = err?.message ?? "directory query failed";
  }

  if (queryError) {
    return (
      <div className="border border-destructive/40 bg-destructive/5 px-6 py-4 font-mono text-sm">
        <span className="text-destructive">error:</span> {queryError}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="border border-foreground/10 px-6 py-12 text-center">
        <p className="font-mono text-sm text-muted-foreground mb-2">
          No agents matched
        </p>
        <p className="text-base">
          Try a different skill or widen <span className="font-mono">minScore</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-foreground/10">
      <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-foreground/10 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        <div className="col-span-1">#</div>
        <div className="col-span-4">ENS</div>
        <div className="col-span-2">Score</div>
        <div className="col-span-2">Successes</div>
        <div className="col-span-2">Top skill</div>
        <div className="col-span-1 text-right">iNFT</div>
      </div>

      {results.map((row, idx) => {
        const sigil = row.score.score >= 0.7 ? "★" : row.score.score >= 0.3 ? "◆" : "·";
        const top = row.card.skills.find((s) => s.id === skill) ?? row.card.skills[0];
        const price = top?.pricing?.x402
          ? `${(top.pricing.x402 as any).amount} ${(top.pricing.x402 as any).token}`
          : "free";
        return (
          <Link
            key={row.ens}
            href={`/agents/${row.ens}`}
            className="grid grid-cols-12 gap-4 px-6 py-5 border-b border-foreground/5 last:border-b-0 items-center transition-colors hover:bg-foreground/[0.02] group"
          >
            <div className="col-span-1 font-mono text-sm text-muted-foreground">
              {String(idx + 1).padStart(2, "0")}
            </div>
            <div className="col-span-4">
              <div className="flex items-center gap-2">
                <span className="text-lg text-muted-foreground" aria-hidden>
                  {sigil}
                </span>
                <span className="font-medium group-hover:underline underline-offset-4">
                  {row.ens}
                </span>
              </div>
              {row.card.description ? (
                <div className="text-sm text-muted-foreground mt-1 line-clamp-1">
                  {row.card.description}
                </div>
              ) : null}
            </div>
            <div className="col-span-2 font-mono">
              {row.score.score.toFixed(3)}
            </div>
            <div className="col-span-2 font-mono text-sm text-muted-foreground">
              {row.score.ok}/{row.score.n}
            </div>
            <div className="col-span-2 text-sm">
              <div>{top?.id ?? "—"}</div>
              <div className="text-muted-foreground font-mono text-xs">{price}</div>
            </div>
            <div className="col-span-1 text-right font-mono text-sm text-muted-foreground">
              #{row.inftTokenId ?? "?"}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="border border-foreground/10">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="px-6 py-5 border-b border-foreground/5 last:border-b-0 flex items-center justify-between"
        >
          <div className="h-4 w-1/3 bg-foreground/5 animate-pulse" />
          <div className="h-4 w-16 bg-foreground/5 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function parseNum(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
