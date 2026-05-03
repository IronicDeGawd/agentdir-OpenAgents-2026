"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

export type MyAgent = { handle: string; ens: string };

export function useMyAgents() {
  const { address, isConnected } = useAccount();
  const [agents, setAgents] = useState<MyAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      setAgents([]);
      return;
    }
    setLoading(true);
    fetch(`/api/my-agents?owner=${address}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setAgents(j.agents ?? []);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [address, isConnected]);

  return { address, isConnected, agents, loading, error };
}
