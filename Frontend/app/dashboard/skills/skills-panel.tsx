"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAccount, useSignMessage } from "wagmi";
import { Button } from "@/components/ui/button";
import { WalletButton } from "@/components/wallet-button";
import { useMyAgents } from "@/lib/use-my-agents";

type CustomSkill = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  prompt: string;
  maxTokens: number;
  pricing: { x402: { token: string; chainId: number; amount: string } } | null;
};

const SKILL_ID_RE = /^[a-z0-9_-]{1,32}$/;
const RESERVED = new Set(["summarize", "sentiment", "route"]);

function defaultDraft(): CustomSkill {
  return {
    id: "",
    name: "",
    description: "",
    tags: [],
    prompt: "",
    maxTokens: 200,
    pricing: null,
  };
}

export function SkillsPanel() {
  const { address, isConnected, agents, loading } = useMyAgents();
  const { signMessageAsync } = useSignMessage();
  const [ens, setEns] = useState<string | null>(null);
  const [customs, setCustoms] = useState<CustomSkill[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<CustomSkill>(defaultDraft);
  const [tagsRaw, setTagsRaw] = useState("");
  const [paid, setPaid] = useState(false);
  const [priceAmount, setPriceAmount] = useState("0.01");

  useEffect(() => {
    if (!ens && agents.length) setEns(agents[0].ens);
  }, [agents, ens]);

  const handle = ens?.split(".")[0] ?? null;

  const refresh = useCallback(async () => {
    if (!handle) return;
    try {
      const r = await fetch(`/api/skills?handle=${handle}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "load failed");
      setCustoms(j.skills ?? []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [handle]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submit = useCallback(async () => {
    if (!address || !ens || !handle) return;
    if (!SKILL_ID_RE.test(draft.id)) {
      setErr("id must be lowercase letters, digits, _ or -, max 32 chars");
      return;
    }
    if (RESERVED.has(draft.id)) {
      setErr(`'${draft.id}' is reserved`);
      return;
    }
    if (!draft.name || !draft.prompt) {
      setErr("name + prompt required");
      return;
    }
    setBusy(true);
    setErr(null);
    setSuccess(null);
    try {
      const ch = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "skill-edit", ownerAddress: address, ens }),
      });
      const challenge = (await ch.json()) as { message: string; error?: string };
      if (!ch.ok) throw new Error(challenge.error ?? "challenge failed");
      const sig = await signMessageAsync({ message: challenge.message });

      const tags = tagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const pricing = paid
        ? { x402: { token: "USDC", chainId: 8453, amount: priceAmount } }
        : null;

      const r = await fetch("/api/skills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle,
          ownerAddress: address,
          message: challenge.message,
          signature: sig,
          skill: {
            id: draft.id,
            name: draft.name,
            description: draft.description,
            tags,
            prompt: draft.prompt,
            maxTokens: draft.maxTokens,
            pricing,
          },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "publish failed");
      setSuccess(`published '${draft.id}' — try it on /call/${ens}`);
      setShowForm(false);
      setDraft(defaultDraft());
      setTagsRaw("");
      setPaid(false);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [address, ens, handle, draft, tagsRaw, paid, priceAmount, refresh, signMessageAsync]);

  const remove = useCallback(
    async (id: string) => {
      if (!address || !ens || !handle) return;
      if (!confirm(`Delete skill '${id}'? AgentCard will be re-published.`)) return;
      setBusy(true);
      setErr(null);
      try {
        const ch = await fetch("/api/auth/challenge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "skill-edit", ownerAddress: address, ens }),
        });
        const challenge = (await ch.json()) as { message: string; error?: string };
        if (!ch.ok) throw new Error(challenge.error ?? "challenge failed");
        const sig = await signMessageAsync({ message: challenge.message });

        const r = await fetch("/api/skills", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            handle,
            id,
            ownerAddress: address,
            message: challenge.message,
            signature: sig,
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "delete failed");
        await refresh();
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [address, ens, handle, refresh, signMessageAsync],
  );

  if (!isConnected) {
    return (
      <div className="border border-foreground/10 px-6 py-8">
        <h2 className="text-xl font-display mb-2">Connect a wallet</h2>
        <WalletButton />
      </div>
    );
  }
  if (loading) return <div className="font-mono text-sm text-muted-foreground">loading…</div>;
  if (agents.length === 0) {
    return (
      <div className="border border-foreground/10 px-6 py-8">
        <p className="text-sm text-muted-foreground mb-4">No owned agents.</p>
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
        {success && (
          <div className="border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 font-mono text-xs text-emerald-500">
            {success}
          </div>
        )}

        <div className="border border-foreground/10 px-5 py-5">
          <h3 className="text-base font-display mb-3">Built-in skills</h3>
          <div className="grid gap-2">
            {[
              { id: "summarize", desc: "summarize text via 0G Compute" },
              { id: "sentiment", desc: "classify sentiment as pos/neutral/neg" },
            ].map((s) => (
              <div
                key={s.id}
                className="border border-foreground/10 px-4 py-2 font-mono text-xs"
              >
                <div className="flex items-baseline justify-between">
                  <strong>{s.id}</strong>
                  <span className="text-muted-foreground">protected</span>
                </div>
                <div className="text-muted-foreground mt-1">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-foreground/10 px-5 py-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-display">Custom skills ({customs.length}/16)</h3>
            <Button
              size="sm"
              onClick={() => {
                setShowForm((v) => !v);
                setErr(null);
                setSuccess(null);
              }}
              disabled={busy}
            >
              {showForm ? "cancel" : "add skill"}
            </Button>
          </div>

          {customs.length === 0 && !showForm && (
            <div className="font-mono text-xs text-muted-foreground">
              no custom skills yet
            </div>
          )}

          <div className="grid gap-2">
            {customs.map((c) => (
              <div
                key={c.id}
                className="border border-foreground/10 px-4 py-3 font-mono text-xs"
              >
                <div className="flex items-baseline justify-between">
                  <strong>{c.id}</strong>
                  <div className="flex items-center gap-3">
                    {c.pricing?.x402 && (
                      <span className="text-muted-foreground">
                        {c.pricing.x402.amount} {c.pricing.x402.token}
                      </span>
                    )}
                    <button
                      onClick={() => remove(c.id)}
                      disabled={busy}
                      className="text-destructive/80 hover:text-destructive"
                    >
                      delete
                    </button>
                  </div>
                </div>
                <div className="text-muted-foreground mt-1">{c.description}</div>
                {c.tags.length > 0 && (
                  <div className="text-muted-foreground/60 mt-1">
                    {c.tags.join(" · ")}
                  </div>
                )}
              </div>
            ))}
          </div>

          {showForm && (
            <div className="mt-5 pt-5 border-t border-foreground/10 grid gap-3 font-mono text-sm">
              <Field label="id">
                <input
                  value={draft.id}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, id: e.target.value.toLowerCase() }))
                  }
                  placeholder="translate-fr"
                  disabled={busy}
                  className="w-full bg-background border border-foreground/20 px-3 py-2 focus:outline-none focus:border-foreground/60"
                />
              </Field>
              <Field label="name">
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Translate to French"
                  disabled={busy}
                  className="w-full bg-background border border-foreground/20 px-3 py-2 focus:outline-none focus:border-foreground/60"
                />
              </Field>
              <Field label="description">
                <input
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  maxLength={280}
                  disabled={busy}
                  className="w-full bg-background border border-foreground/20 px-3 py-2 focus:outline-none focus:border-foreground/60"
                />
              </Field>
              <Field label="tags (comma-separated)">
                <input
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                  placeholder="nlp, translation"
                  disabled={busy}
                  className="w-full bg-background border border-foreground/20 px-3 py-2 focus:outline-none focus:border-foreground/60"
                />
              </Field>
              <Field
                label={`system prompt (${draft.prompt.length}/4000)`}
              >
                <textarea
                  value={draft.prompt}
                  onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
                  rows={5}
                  maxLength={4000}
                  placeholder='Translate the user&apos;s text to French. Reply with only the translation.'
                  disabled={busy}
                  className="w-full bg-background border border-foreground/20 px-3 py-2 font-mono text-sm focus:outline-none focus:border-foreground/60"
                />
              </Field>
              <Field label="max tokens">
                <input
                  type="number"
                  min={1}
                  max={1024}
                  value={draft.maxTokens}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, maxTokens: Number.parseInt(e.target.value || "1") }))
                  }
                  disabled={busy}
                  className="w-32 bg-background border border-foreground/20 px-3 py-2 focus:outline-none focus:border-foreground/60"
                />
              </Field>
              <Field label="paid (x402)">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={paid}
                      onChange={(e) => setPaid(e.target.checked)}
                      disabled={busy}
                    />
                    require USDC payment
                  </label>
                  {paid && (
                    <input
                      type="text"
                      value={priceAmount}
                      onChange={(e) => setPriceAmount(e.target.value)}
                      disabled={busy}
                      className="w-32 bg-background border border-foreground/20 px-3 py-2 focus:outline-none focus:border-foreground/60"
                    />
                  )}
                </div>
              </Field>
              <div className="pt-2">
                <Button
                  onClick={submit}
                  disabled={busy}
                  className="bg-foreground text-background hover:bg-foreground/90"
                >
                  {busy ? "publishing…" : "Sign + publish"}
                </Button>
                <span className="ml-3 text-xs text-muted-foreground">
                  signs a single-use challenge, server republishes AgentCard on Sepolia
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-mono uppercase tracking-widest text-muted-foreground mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
