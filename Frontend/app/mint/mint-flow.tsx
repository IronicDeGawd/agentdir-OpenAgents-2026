"use client";

import { useState, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WalletButton } from "@/components/wallet-button";
import {
  generateIdentity,
  downloadIdentityFile,
  type ClientIdentity,
} from "@/lib/identity-gen";

type CheckResult = { available: boolean; ens: string };
type MintResult = { tokenId: string; txHash: string; explorer: string };
type PublishResult = { txHashes: string[]; records: string[] };

type StepStatus = "pending" | "running" | "ok" | "error";

type FlowState = {
  identity?: ClientIdentity;
  mint?: MintResult;
  publish?: PublishResult;
  verified?: boolean;
};

const HANDLE_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

export function MintFlow() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [handle, setHandle] = useState("");
  const [check, setCheck] = useState<{
    status: "idle" | "checking" | "ok" | "taken" | "invalid" | "error";
    msg?: string;
  }>({ status: "idle" });
  const [flow, setFlow] = useState<FlowState>({});
  const [steps, setSteps] = useState<{
    identity: StepStatus;
    mint: StepStatus;
    publish: StepStatus;
    verify: StepStatus;
  }>({
    identity: "pending",
    mint: "pending",
    publish: "pending",
    verify: "pending",
  });
  const [error, setError] = useState<string | null>(null);

  const ens = handle ? `${handle}.agentdir.eth` : "";

  const runCheck = useCallback(async () => {
    if (!HANDLE_RE.test(handle)) {
      setCheck({ status: "invalid", msg: "lowercase letters, digits, hyphens; 1–32 chars" });
      return;
    }
    setCheck({ status: "checking" });
    try {
      const r = await fetch(
        `/api/handle/check?handle=${encodeURIComponent(handle)}`,
      );
      const j = (await r.json()) as CheckResult & { error?: string };
      if (!r.ok) {
        setCheck({ status: "error", msg: j.error ?? "check failed" });
        return;
      }
      setCheck({
        status: j.available ? "ok" : "taken",
        msg: j.available ? `${j.ens} is free` : `${j.ens} is taken`,
      });
    } catch (e) {
      setCheck({ status: "error", msg: "network error" });
    }
  }, [handle]);

  const runFullFlow = useCallback(async () => {
    if (!address || !isConnected) return;
    if (check.status !== "ok") return;
    setError(null);

    // Step 1 — identity
    setSteps((s) => ({ ...s, identity: "running" }));
    let id: ClientIdentity;
    try {
      id = await generateIdentity(handle, ens);
      downloadIdentityFile(id);
      setFlow((f) => ({ ...f, identity: id }));
      setSteps((s) => ({ ...s, identity: "ok" }));
    } catch (e) {
      setSteps((s) => ({ ...s, identity: "error" }));
      setError(`identity generation failed: ${(e as Error).message}`);
      return;
    }

    // Step 2 — mint
    //   2a) request signed nonce from server (binds owner+ens, single-use)
    //   2b) wagmi signMessage — prompts user
    //   2c) POST /api/mint with signature + identity (privkey leaves browser
    //       only over TLS; server seals with KEK before storing in Mongo).
    setSteps((s) => ({ ...s, mint: "running" }));
    let mint: MintResult;
    try {
      const challengeRes = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "mint", ownerAddress: address, ens }),
      });
      const challenge = (await challengeRes.json()) as {
        message: string;
        nonce: string;
        error?: string;
      };
      if (!challengeRes.ok) throw new Error(challenge.error ?? "challenge failed");

      const signature = await signMessageAsync({ message: challenge.message });

      const r = await fetch("/api/mint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle,
          ownerAddress: address,
          message: challenge.message,
          signature,
          identity: {
            axlPubkeyHex: id.axlPubkeyHex,
            axlPrivateKeyHex: id.axlPrivateKeyHex,
          },
        }),
      });
      const j = (await r.json()) as MintResult & { error?: string };
      if (!r.ok) throw new Error(j.error ?? "mint failed");
      mint = j;
      setFlow((f) => ({ ...f, mint }));
      setSteps((s) => ({ ...s, mint: "ok" }));
    } catch (e) {
      setSteps((s) => ({ ...s, mint: "error" }));
      setError(`mint failed: ${(e as Error).message}`);
      return;
    }

    // Step 3 — publish ENS
    setSteps((s) => ({ ...s, publish: "running" }));
    let pub: PublishResult;
    try {
      const r = await fetch("/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle,
          axlPubkeyHex: id.axlPubkeyHex,
          ownerAddress: address,
          tokenId: mint.tokenId,
        }),
      });
      const j = (await r.json()) as PublishResult & { error?: string };
      if (!r.ok) throw new Error(j.error ?? "publish failed");
      pub = j;
      setFlow((f) => ({ ...f, publish: pub }));
      setSteps((s) => ({ ...s, publish: "ok" }));
    } catch (e) {
      setSteps((s) => ({ ...s, publish: "error" }));
      setError(`publish failed: ${(e as Error).message}`);
      return;
    }

    // Step 4 — verify roundtrip via /api/agents/[ens]
    setSteps((s) => ({ ...s, verify: "running" }));
    try {
      // Sepolia TX inclusion can lag the resolver read by 10–30s. Poll.
      const deadline = Date.now() + 60_000;
      let ok = false;
      while (Date.now() < deadline) {
        const r = await fetch(
          `/api/agents/${encodeURIComponent(ens)}`,
          { cache: "no-store" },
        );
        if (r.ok) {
          ok = true;
          break;
        }
        await new Promise((res) => setTimeout(res, 3000));
      }
      if (!ok) throw new Error("ENS records not yet visible");
      setFlow((f) => ({ ...f, verified: true }));
      setSteps((s) => ({ ...s, verify: "ok" }));
    } catch (e) {
      setSteps((s) => ({ ...s, verify: "error" }));
      setError(`verify failed: ${(e as Error).message}`);
    }
  }, [address, isConnected, handle, ens, check.status, signMessageAsync]);

  const inflight =
    steps.identity === "running" ||
    steps.mint === "running" ||
    steps.publish === "running" ||
    steps.verify === "running";
  const completed = steps.verify === "ok";

  return (
    <div className="grid lg:grid-cols-[1.2fr_1fr] gap-8">
      <div className="space-y-8">
        <Section title="1. Connect wallet">
          {isConnected && address ? (
            <div className="font-mono text-sm">
              <span className="text-muted-foreground">owner: </span>
              <span>{address}</span>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <WalletButton />
              <span className="text-sm text-muted-foreground">
                MetaMask required. The token mints to this address.
              </span>
            </div>
          )}
        </Section>

        <Section title="2. Pick a handle">
          <div className="flex items-center gap-3 font-mono text-sm">
            <input
              type="text"
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value.toLowerCase().trim());
                setCheck({ status: "idle" });
              }}
              placeholder="alice"
              disabled={inflight || completed}
              className="flex-1 bg-background border border-foreground/20 px-3 py-2 focus:outline-none focus:border-foreground/60"
            />
            <span className="text-muted-foreground">.agentdir.eth</span>
            <Button
              size="sm"
              variant="outline"
              onClick={runCheck}
              disabled={!handle || inflight || completed || check.status === "checking"}
            >
              {check.status === "checking" ? "checking…" : "check"}
            </Button>
          </div>
          {check.msg && (
            <div
              className={`mt-2 font-mono text-xs ${
                check.status === "ok"
                  ? "text-emerald-500"
                  : check.status === "checking"
                    ? "text-muted-foreground"
                    : "text-destructive"
              }`}
            >
              {check.msg}
            </div>
          )}
        </Section>

        <Section title="3. Mint + publish">
          <p className="text-sm text-muted-foreground mb-4">
            Server pays gas. We generate your ed25519 keypair in your browser,
            you download it, then we mint the iNFT to your wallet and publish
            ENS records. ~30s total.
          </p>
          <Button
            onClick={runFullFlow}
            disabled={
              !isConnected ||
              check.status !== "ok" ||
              inflight ||
              completed
            }
            className="bg-foreground text-background hover:bg-foreground/90"
          >
            {inflight
              ? "running…"
              : completed
                ? "minted ✓"
                : "Generate identity → mint → publish"}
          </Button>
          {error && (
            <div className="mt-4 border border-destructive/40 bg-destructive/5 px-4 py-3 font-mono text-xs text-destructive">
              {error}
            </div>
          )}
        </Section>

        {completed && flow.identity && flow.mint && (
          <Section title="4. Done">
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Your agent is live. The runtime still needs to be started
                locally so calls reach a real process:
              </p>
              <pre className="bg-foreground/5 border border-foreground/10 px-3 py-2 font-mono text-xs overflow-x-auto">
                {`agentdir run ${flow.identity.handle}`}
              </pre>
              <div className="flex gap-3 pt-2">
                <Link href={`/agents/${ens}`}>
                  <Button className="bg-foreground text-background hover:bg-foreground/90">
                    View agent page →
                  </Button>
                </Link>
                <Link href={`/call/${ens}`}>
                  <Button variant="outline">Try a call</Button>
                </Link>
              </div>
            </div>
          </Section>
        )}
      </div>

      <aside className="space-y-3 font-mono text-sm">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Progress
        </h3>
        <StepRow status={steps.identity} label="Generate identity (browser)" />
        <StepRow
          status={steps.mint}
          label="Mint iNFT on 0G Galileo"
          detail={
            flow.mint && (
              <>
                tokenId: <span className="text-foreground">{flow.mint.tokenId}</span>
                <br />
                <a
                  href={flow.mint.explorer}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  view tx ↗
                </a>
              </>
            )
          }
        />
        <StepRow
          status={steps.publish}
          label="Publish ENS records (Sepolia)"
          detail={
            flow.publish && (
              <>
                {flow.publish.txHashes.length} txs sent
                <br />
                <a
                  href={`https://sepolia.etherscan.io/tx/${flow.publish.txHashes[0]}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  view first tx ↗
                </a>
              </>
            )
          }
        />
        <StepRow status={steps.verify} label="Verify resolver roundtrip" />
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-foreground/10 pl-6">
      <h2 className="text-xl font-display mb-4">{title}</h2>
      {children}
    </div>
  );
}

function StepRow({
  status,
  label,
  detail,
}: {
  status: StepStatus;
  label: string;
  detail?: React.ReactNode;
}) {
  const icon =
    status === "ok"
      ? "✓"
      : status === "error"
        ? "✗"
        : status === "running"
          ? "…"
          : "·";
  const color =
    status === "ok"
      ? "text-emerald-500"
      : status === "error"
        ? "text-destructive"
        : status === "running"
          ? "text-foreground"
          : "text-muted-foreground";
  return (
    <div className="border border-foreground/10 px-3 py-2">
      <div className="flex items-baseline gap-3">
        <span className={`${color} w-3 inline-block`}>{icon}</span>
        <span className={status === "pending" ? "text-muted-foreground" : ""}>
          {label}
        </span>
      </div>
      {detail && (
        <div className="ml-6 mt-1 text-xs text-muted-foreground">{detail}</div>
      )}
    </div>
  );
}
