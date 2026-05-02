"use client";

import { useEffect, useState, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { AGENTDIR } from "@/lib/agentdir";

const artifacts = [
  {
    label: "ENS parent",
    value: AGENTDIR.ensParent,
    chain: AGENTDIR.ensNetwork,
    href: `https://app.ens.domains/${AGENTDIR.ensParent}`,
  },
  {
    label: "iNFT (ERC-7857)",
    value: `${AGENTDIR.inft.address.slice(0, 10)}…${AGENTDIR.inft.address.slice(-4)}`,
    chain: `${AGENTDIR.inft.chain} (${AGENTDIR.inft.chainId})`,
    href: `https://chainscan-galileo.0g.ai/address/${AGENTDIR.inft.address}`,
  },
  {
    label: "0G Compute provider",
    value: `${AGENTDIR.compute.provider.slice(0, 10)}…${AGENTDIR.compute.provider.slice(-4)}`,
    chain: `${AGENTDIR.compute.flavor} · ${AGENTDIR.compute.model}`,
    href: `https://chainscan-galileo.0g.ai/address/${AGENTDIR.compute.provider}`,
  },
  {
    label: "KeeperHub wallet",
    value: `${AGENTDIR.payments.wallet.slice(0, 10)}…${AGENTDIR.payments.wallet.slice(-4)}`,
    chain: `Sepolia · Turnkey-managed`,
    href: `https://sepolia.etherscan.io/address/${AGENTDIR.payments.wallet}`,
  },
  {
    label: "Sample paid call",
    value: `${AGENTDIR.payments.sampleAmount}`,
    chain: "Sepolia · USDC",
    href: AGENTDIR.payments.sampleTx,
  },
];

export function InfrastructureSection() {
  const [isVisible, setIsVisible] = useState(false);
  const [activeRow, setActiveRow] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveRow((prev) => (prev + 1) % artifacts.length);
    }, 2400);
    return () => clearInterval(interval);
  }, []);

  return (
    <section ref={sectionRef} className="relative py-24 lg:py-32 overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-center">
          <div
            className={`transition-all duration-700 ${
              isVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-8"
            }`}
          >
            <span className="inline-flex items-center gap-3 text-sm font-mono text-muted-foreground mb-6">
              <span className="w-8 h-px bg-foreground/30" />
              Live artifacts
            </span>
            <h2 className="text-4xl lg:text-6xl font-display tracking-tight mb-8">
              Nothing simulated.
              <br />
              All onchain.
            </h2>
            <p className="text-xl text-muted-foreground leading-relaxed mb-12">
              Every claim on this page links to a verifiable on-chain object —
              an ENS record, an ERC-7857 token, a TEE provider, a settled USDC
              transfer. Click any row to open it in a block explorer.
            </p>

            <div className="grid grid-cols-3 gap-8">
              <div>
                <div className="text-4xl lg:text-5xl font-display mb-2">{AGENTDIR.agents.length}</div>
                <div className="text-sm text-muted-foreground">Agents on Sepolia</div>
              </div>
              <div>
                <div className="text-4xl lg:text-5xl font-display mb-2">17/17</div>
                <div className="text-sm text-muted-foreground">iNFT contract tests</div>
              </div>
              <div>
                <div className="text-4xl lg:text-5xl font-display mb-2">~60s</div>
                <div className="text-sm text-muted-foreground">End-to-end roundtrip</div>
              </div>
            </div>
          </div>

          <div
            className={`transition-all duration-700 delay-200 ${
              isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"
            }`}
          >
            <div className="border border-foreground/10">
              <div className="px-6 py-4 border-b border-foreground/10 flex items-center justify-between">
                <span className="text-sm font-mono text-muted-foreground">Deployment</span>
                <span className="flex items-center gap-2 text-xs font-mono text-green-600">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  Verifiable
                </span>
              </div>

              <div>
                {artifacts.map((row, index) => (
                  <a
                    key={row.label}
                    href={row.href}
                    target="_blank"
                    rel="noreferrer"
                    className={`px-6 py-5 border-b border-foreground/5 last:border-b-0 flex items-center justify-between transition-all duration-300 group hover:bg-foreground/[0.03] ${
                      activeRow === index ? "bg-foreground/[0.02]" : ""
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <span
                        className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                          activeRow === index ? "bg-foreground" : "bg-foreground/20"
                        }`}
                      />
                      <div>
                        <div className="font-medium">{row.label}</div>
                        <div className="text-sm text-muted-foreground">{row.chain}</div>
                      </div>
                    </div>
                    <span className="font-mono text-sm text-muted-foreground inline-flex items-center gap-1 group-hover:text-foreground transition-colors">
                      {row.value}
                      <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                    </span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
