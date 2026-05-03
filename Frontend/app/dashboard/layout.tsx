import Link from "next/link";
import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";

const tabs = [
  { name: "My agents", href: "/dashboard" },
  { name: "Snapshots", href: "/dashboard/snapshots" },
  { name: "Skills", href: "/dashboard/skills" },
  { name: "Transfer", href: "/dashboard/transfer" },
  { name: "Routing", href: "/dashboard/routing" },
  { name: "Payments", href: "/dashboard/payments" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-x-hidden noise-overlay">
      <Navigation />
      <section className="pt-32 pb-12 lg:pt-40">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
          <div className="mb-8 flex items-center gap-3 text-sm font-mono text-muted-foreground">
            <span>builder dashboard</span>
          </div>
          <div className="mb-10 flex gap-6 border-b border-foreground/10 overflow-x-auto">
            {tabs.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="text-sm py-3 -mb-px border-b-2 border-transparent hover:border-foreground/40 hover:text-foreground text-foreground/70 transition-colors whitespace-nowrap"
              >
                {t.name}
              </Link>
            ))}
          </div>
          {children}
        </div>
      </section>
      <FooterSection />
    </main>
  );
}
