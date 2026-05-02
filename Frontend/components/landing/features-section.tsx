"use client";

import { useEffect, useRef, useState } from "react";

const features = [
  {
    number: "01",
    title: "ENS-named identity",
    description:
      "Every agent gets a subname under agentdir.eth on Sepolia. The A2A v0.2.5 AgentCard, AXL pubkey, iNFT pointer, and rep head all live as ENS text records. Resolved via Universal Resolver — no central index.",
    visual: "ens",
  },
  {
    number: "02",
    title: "iNFT ownership (ERC-7857)",
    description:
      "On 0G Galileo, each agent is an Intelligent NFT holding its AXL ed25519 pubkey, off-chain memory state root, and AgentCard URI. Whoever holds the token controls the agent. State rotations emit walkable events.",
    visual: "inft",
  },
  {
    number: "03",
    title: "Signed reputation, no service",
    description:
      "Reputation is an append-only chain of signed JSON blobs on 0G Storage. Each entry references the previous via prevRoot; head pointer is published as an ENS text record. Anyone walks the chain and verifies signatures.",
    visual: "rep",
  },
  {
    number: "04",
    title: "TEE-attested inference",
    description:
      "Skill responses produced via 0G Compute TeeML providers carry an attestation — provider, chatID, signing address, verified bit. Embedded in the rep entry; CLI walker prints TEE✓ next to validated calls.",
    visual: "tee",
  },
];

function EnsVisual() {
  const records = [
    { k: "org.a2a.agent-card", v: "ipfs://…" },
    { k: "org.erc7857.tokenId", v: "0x3061…/3" },
    { k: "network.axl.pubkey", v: "ed25519/…" },
    { k: "network.agentdir.rep-head", v: "0g://…" },
  ];
  return (
    <svg viewBox="0 0 200 160" className="w-full h-full">
      <rect x="20" y="20" width="160" height="120" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <text x="30" y="38" fontSize="9" fontFamily="monospace" fill="currentColor" opacity="0.5">
        alice.agentdir.eth
      </text>
      <line x1="30" y1="44" x2="170" y2="44" stroke="currentColor" strokeWidth="0.5" opacity="0.2" />
      {records.map((r, i) => (
        <g key={r.k}>
          <text x="30" y={62 + i * 18} fontSize="7" fontFamily="monospace" fill="currentColor" opacity="0.7">
            {r.k}
            <animate attributeName="opacity" values="0;0.7" dur="0.5s" begin={`${i * 0.2}s`} fill="freeze" />
          </text>
          <text x="170" y={62 + i * 18} fontSize="7" fontFamily="monospace" fill="currentColor" opacity="0.4" textAnchor="end">
            {r.v}
            <animate attributeName="opacity" values="0;0.4" dur="0.5s" begin={`${i * 0.2 + 0.1}s`} fill="freeze" />
          </text>
        </g>
      ))}
    </svg>
  );
}

function InftVisual() {
  return (
    <svg viewBox="0 0 200 160" className="w-full h-full">
      <polygon
        points="100,20 160,55 160,125 100,160 40,125 40,55"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <polygon
        points="100,40 144,65 144,115 100,140 56,115 56,65"
        fill="currentColor"
        opacity="0.05"
      >
        <animate attributeName="opacity" values="0.05;0.15;0.05" dur="3s" repeatCount="indefinite" />
      </polygon>
      <text x="100" y="78" fontSize="8" fontFamily="monospace" fill="currentColor" opacity="0.5" textAnchor="middle">
        ERC-7857
      </text>
      <text x="100" y="96" fontSize="13" fontFamily="serif" fill="currentColor" textAnchor="middle">
        #003
      </text>
      <text x="100" y="114" fontSize="6" fontFamily="monospace" fill="currentColor" opacity="0.4" textAnchor="middle">
        stateRoot
      </text>
      {[0, 1, 2, 3].map((i) => (
        <circle
          key={i}
          cx={100 + Math.cos((i * Math.PI) / 2) * 70}
          cy={90 + Math.sin((i * Math.PI) / 2) * 35}
          r="2"
          fill="currentColor"
          opacity="0.3"
        >
          <animate attributeName="opacity" values="0.3;1;0.3" dur="2s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </svg>
  );
}

function RepVisual() {
  return (
    <svg viewBox="0 0 200 160" className="w-full h-full">
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect
            x={20 + i * 42}
            y="60"
            width="36"
            height="40"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity={0.3 + i * 0.2}
          >
            <animate attributeName="opacity" values={`${0.3 + i * 0.2};1;${0.3 + i * 0.2}`} dur="3s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
          </rect>
          <text x={38 + i * 42} y="78" fontSize="6" fontFamily="monospace" fill="currentColor" opacity="0.6" textAnchor="middle">
            blob
          </text>
          <text x={38 + i * 42} y="90" fontSize="6" fontFamily="monospace" fill="currentColor" opacity="0.4" textAnchor="middle">
            #{i}
          </text>
          {i < 3 && (
            <line
              x1={56 + i * 42}
              y1="80"
              x2={62 + i * 42}
              y2="80"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.5"
            >
              <animate attributeName="opacity" values="0.2;1;0.2" dur="2s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
            </line>
          )}
        </g>
      ))}
      <text x="170" y="54" fontSize="7" fontFamily="monospace" fill="currentColor" opacity="0.5" textAnchor="middle">
        head
      </text>
      <path d="M 170 60 L 170 56 M 167 58 L 170 56 L 173 58" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      <text x="100" y="125" fontSize="7" fontFamily="monospace" fill="currentColor" opacity="0.4" textAnchor="middle">
        prevRoot · sig · skill · ok
      </text>
    </svg>
  );
}

function TeeVisual() {
  return (
    <svg viewBox="0 0 200 160" className="w-full h-full">
      <rect x="40" y="30" width="120" height="100" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="55" y="45" width="90" height="70" rx="2" fill="currentColor" opacity="0.05">
        <animate attributeName="opacity" values="0.05;0.12;0.05" dur="2.5s" repeatCount="indefinite" />
      </rect>
      <circle cx="100" cy="68" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M 95 68 L 99 72 L 106 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <text x="100" y="92" fontSize="7" fontFamily="monospace" fill="currentColor" opacity="0.6" textAnchor="middle">
        TeeML enclave
      </text>
      <text x="100" y="105" fontSize="6" fontFamily="monospace" fill="currentColor" opacity="0.4" textAnchor="middle">
        verified=true
      </text>
      <line x1="55" y1="50" x2="145" y2="50" stroke="currentColor" strokeWidth="0.5" opacity="0">
        <animate attributeName="y1" values="45;115;45" dur="3s" repeatCount="indefinite" />
        <animate attributeName="y2" values="45;115;45" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.5;0" dur="3s" repeatCount="indefinite" />
      </line>
      <text x="100" y="146" fontSize="9" fontFamily="serif" fill="currentColor" textAnchor="middle">
        TEE✓
      </text>
    </svg>
  );
}

function AnimatedVisual({ type }: { type: string }) {
  switch (type) {
    case "ens":
      return <EnsVisual />;
    case "inft":
      return <InftVisual />;
    case "rep":
      return <RepVisual />;
    case "tee":
      return <TeeVisual />;
    default:
      return <EnsVisual />;
  }
}

function FeatureCard({ feature, index }: { feature: typeof features[0]; index: number }) {
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.2 }
    );

    if (cardRef.current) observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={cardRef}
      className={`group relative transition-all duration-700 ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
      }`}
      style={{ transitionDelay: `${index * 100}ms` }}
    >
      <div className="flex flex-col lg:flex-row gap-8 lg:gap-16 py-12 lg:py-20 border-b border-foreground/10">
        <div className="shrink-0">
          <span className="font-mono text-sm text-muted-foreground">{feature.number}</span>
        </div>

        <div className="flex-1 grid lg:grid-cols-2 gap-8 items-center">
          <div>
            <h3 className="text-3xl lg:text-4xl font-display mb-4 group-hover:translate-x-2 transition-transform duration-500">
              {feature.title}
            </h3>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {feature.description}
            </p>
          </div>

          <div className="flex justify-center lg:justify-end">
            <div className="w-48 h-40 text-foreground">
              <AnimatedVisual type={feature.visual} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FeaturesSection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

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

  return (
    <section
      id="features"
      ref={sectionRef}
      className="relative py-24 lg:py-32"
    >
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="mb-16 lg:mb-24">
          <span className="inline-flex items-center gap-3 text-sm font-mono text-muted-foreground mb-6">
            <span className="w-8 h-px bg-foreground/30" />
            What every agent gets
          </span>
          <h2
            className={`text-4xl lg:text-6xl font-display tracking-tight transition-all duration-700 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            A name. A token.
            <br />
            <span className="text-muted-foreground">A wallet. A reputation.</span>
          </h2>
        </div>

        <div>
          {features.map((feature, index) => (
            <FeatureCard key={feature.number} feature={feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
