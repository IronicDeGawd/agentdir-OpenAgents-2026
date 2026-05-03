"use client";

import { useMemo, useState } from "react";
import type { AgentCard } from "@agentdir/sdk";
import { Button } from "@/components/ui/button";

interface TraceEvent {
  step: string;
  ok: boolean;
  ms: number;
  detail?: unknown;
}

interface CallResult {
  ok: boolean;
  ens: string;
  skill: string;
  output?: unknown;
  error?: string;
  trace: TraceEvent[];
  responseSig?: string;
  responder?: string;
  totalMs: number;
  repHead?: string | null;
  teeAttestation?: { provider: string; verified: boolean } | null;
}

interface Props {
  ens: string;
  card: AgentCard;
}

export function CallPanel({ ens, card }: Props) {
  const skills = card.skills;
  const [skillId, setSkillId] = useState<string>(skills[0]?.id ?? "");
  const skill = useMemo(() => skills.find((s) => s.id === skillId), [skillId, skills]);

  // Per-skill input. Reset to a sane default when skill changes.
  const [inputJson, setInputJson] = useState<string>(() =>
    JSON.stringify(defaultInputFor(skills[0]?.id), null, 2),
  );

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CallResult | null>(null);
  const [streamText, setStreamText] = useState<string>("");
  const [streamTrace, setStreamTrace] = useState<TraceEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Mode toggles. stream + tee land via real backend; pay still UI-only.
  const [mode, setMode] = useState<{ stream: boolean; tee: boolean; pay: boolean }>({
    stream: false,
    tee: false,
    pay: false,
  });

  function onSkillChange(next: string) {
    setSkillId(next);
    setInputJson(JSON.stringify(defaultInputFor(next), null, 2));
    setResult(null);
    setStreamText("");
    setStreamTrace([]);
    setError(null);
  }

  async function fire() {
    setError(null);
    setResult(null);
    setStreamText("");
    setStreamTrace([]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(inputJson);
    } catch {
      setError("Input is not valid JSON");
      return;
    }
    setRunning(true);
    try {
      const r = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ens,
          skill: skillId,
          input: parsed,
          mode: { tee: mode.tee, pay: mode.pay },
          stream: mode.stream,
        }),
      });
      if (!mode.stream) {
        const j = (await r.json()) as CallResult & { error?: string; code?: string };
        if (!r.ok && !j.trace) {
          setError(j.error ?? "Call failed");
        } else {
          setResult(j);
          if (!j.ok && j.error) setError(j.error);
        }
        return;
      }
      // SSE path — parse event/data frames, append chunks live.
      if (!r.ok || !r.body) {
        setError(`HTTP ${r.status}`);
        return;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = "message";
          let data = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) continue;
          let payload: any;
          try {
            payload = JSON.parse(data);
          } catch {
            continue;
          }
          if (event === "trace") setStreamTrace((t) => [...t, payload]);
          else if (event === "chunk") setStreamText((s) => s + payload.text);
          else if (event === "final") {
            setResult(payload);
            if (!payload.ok && payload.error) setError(payload.error);
          } else if (event === "error") {
            setError(payload.error ?? "stream error");
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
      {/* LEFT: callee preview + form */}
      <div className="space-y-6">
        <div className="border border-foreground/10 p-6">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3">
            Callee
          </div>
          <div className="font-display text-2xl">{card.name}</div>
          {card.description && (
            <div className="text-sm text-muted-foreground mt-2">{card.description}</div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {skills.map((s) => (
              <span
                key={s.id}
                className="text-xs font-mono px-2 py-1 border border-foreground/10 bg-foreground/[0.02]"
              >
                {s.id}
              </span>
            ))}
          </div>
        </div>

        <div className="border border-foreground/10 p-6 space-y-5">
          <div>
            <label className="block text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">
              Skill
            </label>
            <select
              value={skillId}
              onChange={(e) => onSkillChange(e.target.value)}
              className="w-full bg-background border border-foreground/10 px-3 py-2 outline-none focus:border-foreground/30"
              disabled={running}
            >
              {skills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}
                  {s.pricing?.x402 ? "  ·  paid" : "  ·  free"}
                </option>
              ))}
            </select>
            {skill?.description && (
              <div className="text-xs text-muted-foreground mt-2">{skill.description}</div>
            )}
          </div>

          <div>
            <label className="block text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">
              Input (JSON)
            </label>
            <textarea
              value={inputJson}
              onChange={(e) => setInputJson(e.target.value)}
              className="w-full bg-background border border-foreground/10 px-3 py-2 font-mono text-sm min-h-[140px] outline-none focus:border-foreground/30"
              spellCheck={false}
              disabled={running}
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">
              Mode
            </label>
            <div className="flex flex-wrap gap-2 font-mono text-xs">
              <CallToggle
                active={mode.stream}
                onClick={() => setMode((m) => ({ ...m, stream: !m.stream }))}
                disabled={running}
              >
                stream
              </CallToggle>
              <CallToggle
                active={mode.tee}
                onClick={() => setMode((m) => ({ ...m, tee: !m.tee }))}
                disabled={running}
              >
                TEE-verify
              </CallToggle>
              <CallToggle
                active={mode.pay}
                onClick={() => setMode((m) => ({ ...m, pay: !m.pay }))}
                disabled={running || !skill?.pricing?.x402}
              >
                x402 pay
              </CallToggle>
            </div>
            <p className="text-[11px] font-mono text-muted-foreground mt-2">
              stream emits per-chunk signed deltas through the agent runtime.
              TEE-verify swaps in DirectCompute (E9) and surfaces the provider
              attestation. x402 pricing is in the AgentCard; settlement
              wiring rides on the next pass.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={fire}
              disabled={running || !skillId}
              className="bg-foreground text-background hover:bg-foreground/90 px-6 h-11 rounded-full"
            >
              {running ? "Calling…" : "Fire call"}
            </Button>
            <span className="text-xs font-mono text-muted-foreground">
              transport: LocalBus · payment: {mode.pay ? "x402" : "free"}
            </span>
          </div>

          {error && (
            <div className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm font-mono text-destructive">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: live trace + result */}
      <div className="space-y-6">
        <div className="border border-foreground/10">
          <div className="px-6 py-4 border-b border-foreground/10 flex items-center justify-between">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
              Trace
            </span>
            {result && (
              <span className="text-xs font-mono text-muted-foreground">
                {result.totalMs}ms total
              </span>
            )}
          </div>
          <div className="px-6 py-4 font-mono text-sm space-y-2 min-h-[200px]">
            {!result && !running && streamTrace.length === 0 && (
              <div className="text-muted-foreground/60">Fire to begin.</div>
            )}
            {running && streamTrace.length === 0 && !result && (
              <div className="text-muted-foreground animate-pulse">
                Resolving ENS, signing, dispatching…
              </div>
            )}
            {(result?.trace ?? streamTrace).map((ev, i) => (
              <div key={i} className="flex items-start gap-3">
                <span
                  className={
                    ev.ok ? "text-green-600" : "text-destructive"
                  }
                >
                  {ev.ok ? "✓" : "✗"}
                </span>
                <span className="flex-1">
                  <div>
                    {ev.step}
                    <span className="text-muted-foreground/60 ml-2">+{ev.ms}ms</span>
                  </div>
                  {ev.detail !== undefined && (
                    <div className="text-xs text-muted-foreground mt-1 break-all">
                      {formatDetail(ev.detail)}
                    </div>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        {streamText && (
          <div className="border border-foreground/10">
            <div className="px-6 py-4 border-b border-foreground/10 flex items-center justify-between">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                Live stream
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">
                each chunk independently signed
              </span>
            </div>
            <div className="px-6 py-4">
              <pre className="font-mono text-sm whitespace-pre-wrap break-words">
                {streamText}
                {running && <span className="opacity-50 animate-pulse">▍</span>}
              </pre>
            </div>
          </div>
        )}

        {result?.ok && Array.isArray((result.output as any)?.trace) && (
          <HopTracePanel trace={(result.output as any).trace} />
        )}

        {result?.ok && (
          <div className="border border-foreground/10">
            <div className="px-6 py-4 border-b border-foreground/10">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                Result
              </span>
            </div>
            <div className="px-6 py-4">
              <pre className="font-mono text-sm whitespace-pre-wrap break-all">
                {JSON.stringify(result.output, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {result?.ok && (result.responseSig || result.repHead) && (
          <div className="border border-foreground/10 p-6 space-y-3 text-sm font-mono">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              Receipt
            </div>
            {result.responder && (
              <Row label="responder">{shortHex(result.responder)}</Row>
            )}
            {result.responseSig && (
              <Row label="response sig">{shortHex(result.responseSig)}</Row>
            )}
            {result.repHead && (
              <Row label="rep rootHash">{shortHex(result.repHead)}</Row>
            )}
            {result.teeAttestation && (
              <Row label="TEE attested">
                <span
                  className={
                    result.teeAttestation.verified
                      ? "text-emerald-500"
                      : "text-destructive"
                  }
                >
                  {result.teeAttestation.verified ? "✓" : "✗"}{" "}
                </span>
                provider {shortHex(result.teeAttestation.provider)}
              </Row>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type Hop = {
  from: string;
  to: string;
  skill: string;
  ok: boolean;
  latencyMs: number;
  responderEns?: string;
};

function HopTracePanel({ trace }: { trace: Hop[] }) {
  return (
    <div className="border border-foreground/10">
      <div className="px-6 py-4 border-b border-foreground/10 flex items-center justify-between">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
          Hop trace ({trace.length} hop{trace.length === 1 ? "" : "s"})
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">
          each hop is an independently signed call
        </span>
      </div>
      <div className="px-6 py-4 space-y-2 font-mono text-xs">
        {trace.map((h, i) => (
          <div
            key={`${h.from}-${i}`}
            className="grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center"
          >
            <span className={h.ok ? "text-emerald-500" : "text-destructive"}>
              {h.ok ? "✓" : "✗"}
            </span>
            <span>
              <span className="text-muted-foreground">{shortHex(h.from)}</span>
              {" → "}
              <strong>{h.responderEns ?? shortHex(h.to)}</strong>
              <span className="text-muted-foreground">.{h.skill}</span>
            </span>
            <span className="text-muted-foreground">{h.latencyMs}ms</span>
            <span className="text-muted-foreground">#{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CallToggle({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 border transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-foreground/20 hover:border-foreground/60 text-foreground/80"
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground break-all">{children}</span>
    </div>
  );
}

function shortHex(h: string): string {
  if (h.length <= 22) return h;
  return `${h.slice(0, 10)}…${h.slice(-8)}`;
}

function formatDetail(d: unknown): string {
  if (typeof d === "string") return d;
  try {
    return JSON.stringify(d);
  } catch {
    return String(d);
  }
}

function defaultInputFor(skillId: string | undefined): unknown {
  switch (skillId) {
    case "summarize":
      return {
        text: "AI agents can now find each other on Ethereum, settle reputation on 0G Storage, and own their identity as iNFTs.",
      };
    case "sentiment":
      return { text: "this protocol is genuinely impressive" };
    default:
      return {};
  }
}
