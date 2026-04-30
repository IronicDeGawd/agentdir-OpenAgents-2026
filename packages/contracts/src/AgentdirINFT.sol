// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC7857} from "./IERC7857.sol";

/// @title agentdir Intelligent NFT (ERC-7857-aligned)
/// @notice One token = one autonomous agent. Holds:
///           - `agentStateRoot`: 0G Storage rootHash anchoring agent memory.
///           - `agentAxlPubkey`: ed25519 pubkey the agent signs A2A traffic with.
///           - `tokenURI`: pointer to off-chain card / capability manifest.
///         All three are owner-mutable. Transferring the token transfers the
///         agent identity and any earnings authority bound to it off-chain.
contract AgentdirINFT is ERC721, IERC7857, Ownable {
    error NotTokenOwner();
    error NonexistentToken();

    /// @dev tokenId => 0G Storage rootHash
    mapping(uint256 => bytes32) private _stateRoots;

    /// @dev tokenId => ed25519 pubkey (32 raw bytes packed in bytes32)
    mapping(uint256 => bytes32) private _axlPubkeys;

    /// @dev tokenId => off-chain JSON pointer (ipfs://, https://, axl://, or 0g://)
    mapping(uint256 => string) private _tokenURIs;

    /// @dev next id minted; starts at 1 so 0 is a sentinel for "missing"
    uint256 private _nextId = 1;

    constructor(address initialOwner) ERC721("agentdir Agent", "AGT") Ownable(initialOwner) {}

    /// @notice Mint a new agent token.
    /// @param to Recipient (typically the deployer or a multisig holding the agent).
    /// @param axlPubkey Initial AXL ed25519 pubkey for this agent.
    /// @param stateRoot Initial off-chain state root (0G Storage rootHash).
    /// @param uri Off-chain agent-card pointer.
    /// @return tokenId Newly minted id.
    function mint(address to, bytes32 axlPubkey, bytes32 stateRoot, string calldata uri)
        external
        returns (uint256 tokenId)
    {
        tokenId = _nextId++;
        _safeMint(to, tokenId);
        _axlPubkeys[tokenId] = axlPubkey;
        _stateRoots[tokenId] = stateRoot;
        _tokenURIs[tokenId] = uri;
        emit AgentPubkeyUpdated(tokenId, axlPubkey);
        emit AgentStateUpdated(tokenId, bytes32(0), stateRoot, to);
    }

    /// @inheritdoc IERC7857
    function agentStateRoot(uint256 tokenId) external view returns (bytes32) {
        _ownerOfOrRevert(tokenId);
        return _stateRoots[tokenId];
    }

    /// @inheritdoc IERC7857
    function agentAxlPubkey(uint256 tokenId) external view returns (bytes32) {
        _ownerOfOrRevert(tokenId);
        return _axlPubkeys[tokenId];
    }

    /// @inheritdoc IERC7857
    function setAgentStateRoot(uint256 tokenId, bytes32 newRoot) external {
        if (_ownerOfOrRevert(tokenId) != msg.sender) revert NotTokenOwner();
        bytes32 prev = _stateRoots[tokenId];
        _stateRoots[tokenId] = newRoot;
        emit AgentStateUpdated(tokenId, prev, newRoot, msg.sender);
    }

    /// @inheritdoc IERC7857
    function setAgentAxlPubkey(uint256 tokenId, bytes32 axlPubkey) external {
        if (_ownerOfOrRevert(tokenId) != msg.sender) revert NotTokenOwner();
        _axlPubkeys[tokenId] = axlPubkey;
        emit AgentPubkeyUpdated(tokenId, axlPubkey);
    }

    /// @notice Owner-only URI rotation (e.g. AgentCard pointer change).
    function setTokenURI(uint256 tokenId, string calldata uri) external {
        if (_ownerOfOrRevert(tokenId) != msg.sender) revert NotTokenOwner();
        _tokenURIs[tokenId] = uri;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _ownerOfOrRevert(tokenId);
        return _tokenURIs[tokenId];
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC7857).interfaceId || super.supportsInterface(interfaceId);
    }

    function _ownerOfOrRevert(uint256 tokenId) internal view returns (address owner_) {
        owner_ = _ownerOf(tokenId);
        if (owner_ == address(0)) revert NonexistentToken();
    }
}
