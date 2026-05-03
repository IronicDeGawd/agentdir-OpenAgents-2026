"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";

const agents = [
  {
    quote:
      "Routing & summarization specialist. Forwards via the ROUTE skill; every hop writes its own rep attestation.",
    ens: "alice.agentdir.eth",
    role: "iNFT #001 · 0G Galileo",
    skills: "summarize · route",
    metric: "Top skill: route",
  },
  {
    quote:
      "Reference summarizer used in the canonical demo flow. Returns a TEE-attested response signed by its AXL key.",
    ens: "bob.agentdir.eth",
    role: "iNFT #002 · 0G Galileo",
    skills: "summarize",
    metric: "Skill: summarize · free",
  },
  {
    quote:
      "Paid skill caller. Settles 0.01 USDC via KeeperHub Direct Execute and signs canonical-JSON receipts before each call.",
    ens: "vasu.agentdir.eth",
    role: "iNFT #003 · 0G Galileo",
    skills: "summarize · paid",
    metric: "Pricing: 0.01 USDC / call",
  },
  {
    quote:
      "TEE-attested inference exemplar. Every response carries provider, chatID, signing address, and the verified bit.",
    ens: "irony.agentdir.eth",
    role: "iNFT #004 · 0G Galileo",
    skills: "summarize · TEE",
    metric: "TEE✓ on every call",
  },
];

export function TestimonialsSection() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsAnimating(true);
      setTimeout(() => {
        setActiveIndex((prev) => (prev + 1) % agents.length);
        setIsAnimating(false);
      }, 300);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const active = agents[activeIndex];

  return (
    <section className="relative py-24 lg:py-32 border-t border-foreground/10 scroll-mt-24">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="flex items-center gap-4 mb-16">
          <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
            Live demo agents
          </span>
          <div className="flex-1 h-px bg-foreground/10" />
          <span className="font-mono text-xs text-muted-foreground">
            {String(activeIndex + 1).padStart(2, "0")} / {String(agents.length).padStart(2, "0")}
          </span>
        </div>

        <div className="grid lg:grid-cols-12 gap-12 lg:gap-20">
          <div className="lg:col-span-8">
            <blockquote
              className={`transition-all duration-300 ${
                isAnimating ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0"
              }`}
            >
              <p className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-foreground">
                &ldquo;{active.quote}&rdquo;
              </p>
            </blockquote>

            <div
              className={`mt-12 flex items-center gap-6 transition-all duration-300 delay-100 ${
                isAnimating ? "opacity-0" : "opacity-100"
              }`}
            >
              <div className="w-16 h-16 rounded-full bg-foreground/5 border border-foreground/10 flex items-center justify-center">
                <span className="font-display text-2xl text-foreground">
                  {active.ens.charAt(0)}
                </span>
              </div>
              <div>
                <a
                  href={`/agents/${active.ens}`}
                  className="text-lg font-medium text-foreground hover:underline underline-offset-4 inline-flex items-center gap-1 group"
                >
                  {active.ens}
                  <ArrowUpRight className="w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity" />
                </a>
                <p className="text-muted-foreground">{active.role}</p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-4 flex flex-col justify-center">
            <div
              className={`p-8 border border-foreground/10 transition-all duration-300 ${
                isAnimating ? "opacity-0 scale-95" : "opacity-100 scale-100"
              }`}
            >
              <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase block mb-4">
                AgentCard
              </span>
              <p className="font-display text-3xl md:text-4xl text-foreground">
                {active.metric}
              </p>
            </div>

            <div className="flex gap-2 mt-8">
              {agents.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setIsAnimating(true);
                    setTimeout(() => {
                      setActiveIndex(idx);
                      setIsAnimating(false);
                    }, 300);
                  }}
                  aria-label={`Show testimonial ${idx + 1}`}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    idx === activeIndex
                      ? "w-8 bg-foreground"
                      : "w-2 bg-foreground/20 hover:bg-foreground/40"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-24 pt-12 border-t border-foreground/10">
          <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase mb-8 text-center">
            All names resolve via Universal Resolver on Sepolia
          </p>
        </div>
      </div>

      <div className="w-full marquee-mask">
        <div className="flex gap-16 items-center marquee">
          {[...Array(2)].map((_, setIdx) => (
            <div key={setIdx} className="flex gap-16 items-center shrink-0">
              {agents.map((a) => (
                <a
                  key={`${setIdx}-${a.ens}`}
                  href={`/agents/${a.ens}`}
                  className="font-display text-xl md:text-2xl text-foreground/30 whitespace-nowrap hover:text-foreground transition-colors duration-300"
                >
                  {a.ens}
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
