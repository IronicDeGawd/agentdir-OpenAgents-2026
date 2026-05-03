"use client";

import { ArrowUpRight } from "lucide-react";
import { AnimatedWave } from "./animated-wave";
import { REPO_URL } from "@/lib/agentdir";

type FooterLink = { name: string; href: string; badge?: string };

const footerLinks: Record<string, FooterLink[]> = {
  Protocol: [
    { name: "What agents get", href: "/#features" },
    { name: "Roundtrip", href: "/#how-it-works" },
    { name: "Live artifacts", href: "/#features" },
    { name: "Trust model", href: "/#security" },
  ],
  Directory: [
    { name: "Browse agents", href: "/directory" },
    { name: "alice.agentdir.eth", href: "/agents/alice.agentdir.eth" },
    { name: "bob.agentdir.eth", href: "/agents/bob.agentdir.eth" },
    { name: "vasu.agentdir.eth", href: "/agents/vasu.agentdir.eth" },
    { name: "irony.agentdir.eth", href: "/agents/irony.agentdir.eth" },
  ],
  Tracks: [
    { name: "0G — iNFT + Storage + Compute", href: "/#features" },
    { name: "KeeperHub — Direct Execute", href: "/#how-it-works" },
    { name: "ENS — AI Agent + Creative", href: "/#features" },
    { name: "Gensyn AXL", href: "/#integrations" },
  ],
  Repo: [
    { name: "GitHub", href: REPO_URL },
    { name: "CLI reference", href: "/#developers" },
    { name: "Stack", href: "/#integrations" },
  ],
};

const socialLinks = [
  { name: "GitHub", href: REPO_URL },
  { name: "ENS app", href: "https://app.ens.domains/agentdir.eth" },
];

export function FooterSection() {
  return (
    <footer className="relative border-t border-foreground/10">
      {/* Animated wave background */}
      <div className="absolute inset-0 h-64 opacity-20 pointer-events-none overflow-hidden">
        <AnimatedWave />
      </div>
      
      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Main Footer */}
        <div className="py-16 lg:py-24">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-12 lg:gap-8">
            {/* Brand Column */}
            <div className="col-span-2">
              <a href="/" className="inline-flex items-center gap-2 mb-6">
                <span className="text-2xl font-display">agentdir</span>
                <span className="text-xs text-muted-foreground font-mono">.eth</span>
              </a>

              <p className="text-muted-foreground leading-relaxed mb-8 max-w-xs">
                Yellow pages for autonomous agents. ENS names, iNFT ownership,
                signed reputation, USDC-paid skills, TEE-verified inference.
              </p>

              {/* Social Links */}
              <div className="flex gap-6">
                {socialLinks.map((link) => (
                  <a
                    key={link.name}
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 group"
                  >
                    {link.name}
                    <ArrowUpRight className="w-3 h-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </a>
                ))}
              </div>
            </div>

            {/* Link Columns */}
            {Object.entries(footerLinks).map(([title, links]) => (
              <div key={title}>
                <h3 className="text-sm font-medium mb-6">{title}</h3>
                <ul className="space-y-4">
                  {links.map((link) => (
                    <li key={link.name}>
                      <a
                        href={link.href}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-2"
                      >
                        {link.name}
                        {link.badge && (
                          <span className="text-xs px-2 py-0.5 bg-foreground text-background rounded-full">
                            {link.badge}
                          </span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="py-8 border-t border-foreground/10 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            agentdir — built for ETHGlobal Open Agents 2026. MIT licensed.
          </p>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Sepolia + 0G Galileo · live
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
