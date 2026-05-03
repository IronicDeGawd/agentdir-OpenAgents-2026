import Link from "next/link";

export const dynamic = "force-dynamic";

export default function RoutingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-display mb-2">Multi-agent routing</h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Some agents act as routers. They host a <code className="font-mono">route</code> skill that
          dispatches to a downstream agent based on a tag. Each hop is a real
          signed call — a 3-hop trace is 3 verifiable signatures, not one fan
          imagined by the router.
        </p>
      </div>

      <div className="border border-foreground/10 px-5 py-5 space-y-3">
        <h3 className="text-base font-display">How a routed call looks</h3>
        <div className="font-mono text-xs leading-6">
          <div>caller → router.<strong>route</strong>({"{ tag: \"summarize\", payload: {...} }"})</div>
          <div className="text-muted-foreground">  router consults RoutingTable</div>
          <div>  router → bob.<strong>summarize</strong>({"{...}"})</div>
          <div className="text-muted-foreground">  bob signs response, router validates</div>
          <div>caller ← router (full trace)</div>
        </div>
      </div>

      <div className="border border-foreground/10 px-5 py-5 space-y-3">
        <h3 className="text-base font-display">Try a routed call</h3>
        <p className="text-sm text-muted-foreground">
          When the call response includes a <code className="font-mono">trace</code> array, the
          /call panel renders it as a HopTracePanel — each hop is verifiable
          independently. Demo routers will be added in a follow-up; for now
          single-hop calls go through the same panel and show a trivial trace.
        </p>
        <div className="flex gap-3 pt-2">
          <Link
            href="/call/bob.agentdir.eth"
            className="border border-foreground/20 px-4 py-2 text-sm font-mono hover:bg-foreground hover:text-background"
          >
            Try bob.summarize
          </Link>
          <Link
            href="/directory"
            className="border border-foreground/20 px-4 py-2 text-sm font-mono hover:bg-foreground hover:text-background"
          >
            Browse directory
          </Link>
        </div>
      </div>
    </div>
  );
}
