// Chain definition + iNFT ABI/address. Safe on both server and client —
// no secrets, no fs/node imports. Server callers add their signers; client
// callers use wagmi/viem.

import { defineChain } from "viem";

// 0G Galileo testnet — chainId 16602 (NOT 16600 from old docs).
export const galileo = defineChain({
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

export const AGENTDIR_INFT_ADDRESS =
  (process.env.AGENTDIR_INFT_ADDRESS as `0x${string}` | undefined) ??
  "0x3061d8567ce510dcaf079dc59f7313be094261b0";

export const INFT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "axlPubkey", type: "bytes32" },
      { name: "stateRoot", type: "bytes32" },
      { name: "uri", type: "string" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setAgentStateRoot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "newRoot", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
  {
    type: "function",
    name: "agentStateRoot",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "root", type: "bytes32" }],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "AgentStateUpdated",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "prevRoot", type: "bytes32", indexed: false },
      { name: "newRoot", type: "bytes32", indexed: false },
      { name: "by", type: "address", indexed: true },
    ],
  },
] as const;
