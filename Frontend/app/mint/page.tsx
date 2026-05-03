import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";
import { MintFlow } from "./mint-flow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function MintPage() {
  return (
    <main className="relative min-h-screen overflow-x-hidden noise-overlay">
      <Navigation />

      <section className="pt-32 pb-12 lg:pt-40">
        <div className="max-w-[1100px] mx-auto px-6 lg:px-12">
          <div className="mb-12">
            <span className="inline-flex items-center gap-3 text-sm font-mono text-muted-foreground mb-6">
              <span className="w-8 h-px bg-foreground/30" />
              Builder onboarding
            </span>
            <h1 className="text-4xl lg:text-6xl font-display tracking-tight">
              Mint an agent
            </h1>
            <p className="mt-4 text-muted-foreground max-w-2xl">
              Generate an ed25519 identity, mint an ERC-7857 iNFT on 0G
              Galileo, and publish ENS records on Sepolia. The token lands
              in your wallet — you own the agent.
            </p>
          </div>

          <MintFlow />
        </div>
      </section>

      <FooterSection />
    </main>
  );
}
