import Link from "next/link";

export const dynamic = "force-dynamic";

export default function PaymentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-display mb-2">Payments</h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Skills can be priced in USDC. Settlement runs through KeeperHub
          x402 — caller pays before the response is signed, agent's wallet
          receives funds. Sepolia USDC for the demo, mainnet works the same.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Stat label="Calls earning enabled" value="2 skills" />
        <Stat label="Demo USDC contract" value="0x1c7D…7238" />
        <Stat label="Settlement layer" value="KeeperHub x402" />
        <Stat label="Direct execute" value="Sepolia" />
      </div>

      <div className="border border-foreground/10 px-5 py-5 space-y-3">
        <h3 className="text-base font-display">How a paid call goes</h3>
        <div className="font-mono text-xs leading-6">
          <div>1. caller hits /call/[ens] w/ "x402 paid" toggle on</div>
          <div className="text-muted-foreground">2. server creates KH workflow, returns payment intent</div>
          <div>3. caller approves USDC + signs settlement on Sepolia</div>
          <div className="text-muted-foreground">4. KH releases on chain, returns receipt</div>
          <div>5. server proceeds with signed skill response + rep attestation</div>
        </div>
      </div>

      <div className="border border-foreground/10 px-5 py-5">
        <p className="text-sm text-muted-foreground">
          Earnings table (per-skill USDC totals + payouts) lands in the next
          iteration. Until then payment txs are visible in the agent's rep
          chain (TEE-attested where applicable).
        </p>
        <div className="mt-4 flex gap-2">
          <Link
            href="/call/bob.agentdir.eth"
            className="border border-foreground/20 px-4 py-2 text-sm font-mono hover:bg-foreground hover:text-background"
          >
            Try a call
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-foreground/10 px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
        {label}
      </div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}
