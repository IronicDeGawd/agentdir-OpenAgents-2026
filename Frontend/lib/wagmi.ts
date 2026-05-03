"use client";

import { http, createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import { defineChain } from "viem";
import { injected } from "wagmi/connectors";

// 0G Galileo testnet — iNFT contract lives here. Users sign
// `setAgentStateRoot` and `transferFrom` on this chain from their wallet.
const galileo = defineChain({
  id: 16602,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://evmrpc-testnet.0g.ai"] },
    public: { http: ["https://evmrpc-testnet.0g.ai"] },
  },
  blockExplorers: {
    default: { name: "ChainScan", url: "https://chainscan-galileo.0g.ai" },
  },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [sepolia, galileo],
  connectors: [injected({ target: "metaMask" })],
  transports: {
    [sepolia.id]: http(
      process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ??
        "https://ethereum-sepolia-rpc.publicnode.com",
    ),
    [galileo.id]: http(
      process.env.NEXT_PUBLIC_ZG_RPC_URL ?? "https://evmrpc-testnet.0g.ai",
    ),
  },
  ssr: true,
});

export const GALILEO_CHAIN_ID = galileo.id;
