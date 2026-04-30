// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ERC-7857 Intelligent NFT (minimal interface)
/// @notice Each token represents an autonomous agent. Mutable state lives off-chain
///         (e.g. 0G Storage); on-chain anchor is `agentStateRoot(tokenId)`.
/// @dev    Draft spec. Pinned to the subset agentdir uses end-to-end:
///         - per-token state root (bytes32) anchored on-chain
///         - signed-by-owner update path
///         - capability/skill metadata pointer (URI)
///         - transferability inherited from ERC-721
interface IERC7857 {
    /// @notice Emitted when an agent's off-chain state root rotates.
    event AgentStateUpdated(uint256 indexed tokenId, bytes32 prevRoot, bytes32 newRoot, address indexed by);

    /// @notice Emitted when the AXL ed25519 pubkey associated with a token changes.
    event AgentPubkeyUpdated(uint256 indexed tokenId, bytes32 axlPubkey);

    /// @notice Emitted when the off-chain agent-card pointer rotates.
    event AgentURIUpdated(uint256 indexed tokenId, string uri);

    /// @notice Returns the current off-chain state root for `tokenId`.
    function agentStateRoot(uint256 tokenId) external view returns (bytes32);

    /// @notice Returns the AXL ed25519 pubkey bound to `tokenId` (32 bytes packed in bytes32).
    function agentAxlPubkey(uint256 tokenId) external view returns (bytes32);

    /// @notice Owner-only state root rotation.
    function setAgentStateRoot(uint256 tokenId, bytes32 newRoot) external;

    /// @notice Owner-only AXL pubkey rotation.
    function setAgentAxlPubkey(uint256 tokenId, bytes32 axlPubkey) external;
}
