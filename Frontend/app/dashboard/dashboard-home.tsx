"use client";

import Link from "next/link";
import { WalletButton } from "@/components/wallet-button";
import { useMyAgents } from "@/lib/use-my-agents";

export function DashboardHome() {
  const { isConnected, agents, loading, error } = useMyAgents();

  if (!isConnected) {
    return (
      <div className="border border-foreground/10 px-6 py-8">
        <h2 className="text-xl font-display mb-2">Connect a wallet</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Dashboard shows the agents you own. Connect to load them.
        </p>
        <WalletButton />
      </div>
    );
  }

  if (loading) {
    return <div className="font-mono text-sm text-muted-foreground">loading…</div>;
  }

  if (error) {
    return (
      <div className="border border-destructive/40 bg-destructive/5 px-4 py-3 font-mono text-xs text-destructive">
        {error}
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="border border-foreground/10 px-6 py-8 space-y-4">
        <h2 className="text-xl font-display">No agents yet</h2>
        <p className="text-sm text-muted-foreground">
          Mint your first agent to start. Server hosts the runtime; you keep
          ownership of the iNFT.
        </p>
        <Link
          href="/mint"
          className="inline-block bg-foreground text-background hover:bg-foreground/90 px-4 py-2 text-sm font-mono"
        >
          Mint an agent →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-display">Your agents</h2>
      <div className="grid gap-3">
        {agents.map((a) => (
          <div
            key={a.ens}
            className="border border-foreground/10 px-5 py-4 grid grid-cols-[1fr_auto] items-center gap-4"
          >
            <div>
              <div className="font-mono text-sm">{a.ens}</div>
              <div className="text-xs text-muted-foreground">handle: {a.handle}</div>
            </div>
            <div className="flex gap-2 text-xs font-mono">
              <Link
                href={`/agents/${a.ens}`}
                className="border border-foreground/20 px-3 py-1.5 hover:bg-foreground hover:text-background"
              >
                profile
              </Link>
              <Link
                href={`/call/${a.ens}`}
                className="border border-foreground/20 px-3 py-1.5 hover:bg-foreground hover:text-background"
              >
                call
              </Link>
              <Link
                href={`/dashboard/snapshots?ens=${encodeURIComponent(a.ens)}`}
                className="border border-foreground/20 px-3 py-1.5 hover:bg-foreground hover:text-background"
              >
                snapshots
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
