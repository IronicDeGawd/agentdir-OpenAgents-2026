"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { WalletButton } from "@/components/wallet-button";
import { useMyAgents } from "@/lib/use-my-agents";
import type { Skill } from "@agentdir/sdk";

export function SkillsPanel() {
  const { isConnected, agents, loading } = useMyAgents();
  const [ens, setEns] = useState<string | null>(null);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ens && agents.length) setEns(agents[0].ens);
  }, [agents, ens]);

  useEffect(() => {
    if (!ens) return;
    fetch(`/api/agents/${encodeURIComponent(ens)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setSkills(j?.card?.skills ?? []);
        setErr(null);
      })
      .catch((e) => setErr((e as Error).message));
  }, [ens]);

  if (!isConnected) {
    return (
      <div className="border border-foreground/10 px-6 py-8">
        <h2 className="text-xl font-display mb-2">Connect a wallet</h2>
        <WalletButton />
      </div>
    );
  }

  if (loading) {
    return <div className="font-mono text-sm text-muted-foreground">loading…</div>;
  }

  if (agents.length === 0) {
    return (
      <div className="border border-foreground/10 px-6 py-8">
        <p className="text-sm text-muted-foreground mb-4">
          No owned agents to edit skills for.
        </p>
        <Link href="/mint" className="font-mono text-sm underline">
          Mint one →
        </Link>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-[260px_1fr] gap-8">
      <aside>
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Pick agent
        </h3>
        <div className="space-y-1">
          {agents.map((a) => (
            <button
              key={a.ens}
              onClick={() => setEns(a.ens)}
              className={`w-full text-left font-mono text-xs px-3 py-2 border transition-colors ${
                ens === a.ens
                  ? "border-foreground bg-foreground/5"
                  : "border-foreground/10 hover:border-foreground/40"
              }`}
            >
              {a.ens}
            </button>
          ))}
        </div>
      </aside>

      <div className="space-y-6">
        {ens && <h2 className="text-2xl font-display">{ens}</h2>}
        {err && (
          <div className="border border-destructive/40 bg-destructive/5 px-4 py-3 font-mono text-xs text-destructive">
            {err}
          </div>
        )}
        <div className="border border-foreground/10 px-5 py-5 space-y-3">
          <h3 className="text-base font-display">Published skills</h3>
          <p className="text-sm text-muted-foreground">
            Skills are part of the AgentCard JSON in ENS text record{" "}
            <code className="font-mono">org.a2a.agent-card</code>. Editing
            republishes via setText. New skills must register a handler in
            the agent runtime — UI-side editor lands in the next pass.
          </p>
          {skills && (
            <div className="grid gap-2 pt-2">
              {skills.map((s) => (
                <div
                  key={s.id}
                  className="border border-foreground/10 px-4 py-3 font-mono text-xs"
                >
                  <div className="flex items-baseline justify-between">
                    <strong>{s.id}</strong>
                    {s.pricing?.x402 && (
                      <span className="text-muted-foreground">
                        {s.pricing.x402.amount} {s.pricing.x402.token}
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground mt-1">{s.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
