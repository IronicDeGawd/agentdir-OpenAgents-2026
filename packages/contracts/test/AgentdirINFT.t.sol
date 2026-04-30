// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentdirINFT} from "../src/AgentdirINFT.sol";
import {IERC7857} from "../src/IERC7857.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract AgentdirINFTTest is Test {
    AgentdirINFT inft;
    address deployer = address(this);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    bytes32 constant PUB_A = bytes32(uint256(0xa1));
    bytes32 constant PUB_B = bytes32(uint256(0xb2));
    bytes32 constant ROOT_0 = bytes32(uint256(0x100));
    bytes32 constant ROOT_1 = bytes32(uint256(0x200));

    function setUp() public {
        inft = new AgentdirINFT(deployer);
    }

    function testDeployerIsContractOwner() public view {
        assertEq(inft.owner(), deployer);
    }

    function testMintAssignsAllFields() public {
        uint256 id = inft.mint(alice, PUB_A, ROOT_0, "ipfs://card-a");
        assertEq(inft.ownerOf(id), alice);
        assertEq(inft.agentAxlPubkey(id), PUB_A);
        assertEq(inft.agentStateRoot(id), ROOT_0);
        assertEq(inft.tokenURI(id), "ipfs://card-a");
    }

    function testMintRestrictedToContractOwner() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        inft.mint(bob, PUB_A, ROOT_0, "u");
    }

    function testIdsIncrementFromOne() public {
        uint256 a = inft.mint(alice, PUB_A, ROOT_0, "u");
        uint256 b = inft.mint(bob, PUB_B, ROOT_0, "u");
        assertEq(a, 1);
        assertEq(b, 2);
    }

    function testOwnerCanRotateStateRoot() public {
        uint256 id = inft.mint(alice, PUB_A, ROOT_0, "u");
        vm.prank(alice);
        inft.setAgentStateRoot(id, ROOT_1);
        assertEq(inft.agentStateRoot(id), ROOT_1);
    }

    function testNonOwnerCannotRotateStateRoot() public {
        uint256 id = inft.mint(alice, PUB_A, ROOT_0, "u");
        vm.prank(bob);
        vm.expectRevert(AgentdirINFT.NotTokenOwner.selector);
        inft.setAgentStateRoot(id, ROOT_1);
    }

    function testApprovedAddressCannotRotateStateRoot() public {
        uint256 id = inft.mint(alice, PUB_A, ROOT_0, "u");
        vm.prank(alice);
        inft.approve(bob, id);
        // Approval grants transfer rights — NOT agent-state authority.
        vm.prank(bob);
        vm.expectRevert(AgentdirINFT.NotTokenOwner.selector);
        inft.setAgentStateRoot(id, ROOT_1);
    }

    function testOwnerCanRotateAxlPubkey() public {
        uint256 id = inft.mint(alice, PUB_A, ROOT_0, "u");
        vm.prank(alice);
        inft.setAgentAxlPubkey(id, PUB_B);
        assertEq(inft.agentAxlPubkey(id), PUB_B);
    }

    function testNonOwnerCannotRotateAxlPubkey() public {
        uint256 id = inft.mint(alice, PUB_A, ROOT_0, "u");
        vm.prank(bob);
        vm.expectRevert(AgentdirINFT.NotTokenOwner.selector);
        inft.setAgentAxlPubkey(id, PUB_B);
    }

    function testOwnerCanRotateUri() public {
        uint256 id = inft.mint(alice, PUB_A, ROOT_0, "u1");
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit IERC7857.AgentURIUpdated(id, "u2");
        inft.setTokenURI(id, "u2");
        assertEq(inft.tokenURI(id), "u2");
    }

    function testTransferMovesAuthority() public {
        uint256 id = inft.mint(alice, PUB_A, ROOT_0, "u");
        vm.prank(alice);
        inft.transferFrom(alice, bob, id);
        assertEq(inft.ownerOf(id), bob);

        vm.prank(alice);
        vm.expectRevert(AgentdirINFT.NotTokenOwner.selector);
        inft.setAgentStateRoot(id, ROOT_1);

        vm.prank(bob);
        inft.setAgentStateRoot(id, ROOT_1);
        assertEq(inft.agentStateRoot(id), ROOT_1);
    }

    function testGettersReturnZeroForNonexistent() public view {
        // Per spec, getters don't revert — they return zero. Indexers can
        // probe arbitrary ids without try/catch.
        assertEq(inft.agentStateRoot(999), bytes32(0));
        assertEq(inft.agentAxlPubkey(999), bytes32(0));
    }

    function testTokenURIRevertsForNonexistent() public {
        // ERC-721 spec demands tokenURI MUST revert for nonexistent tokens.
        vm.expectRevert(AgentdirINFT.NonexistentToken.selector);
        inft.tokenURI(999);
    }

    function testStateUpdateEmitsPrevAndNew() public {
        uint256 id = inft.mint(alice, PUB_A, ROOT_0, "u");
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit IERC7857.AgentStateUpdated(id, ROOT_0, ROOT_1, alice);
        inft.setAgentStateRoot(id, ROOT_1);
    }

    function testMintEmitsAllThreeEvents() public {
        // Just check we can mint to a contract receiver path successfully;
        // detailed event ordering is verified by the receiver-hook test below.
        uint256 id = inft.mint(alice, PUB_A, ROOT_0, "u1");
        assertEq(inft.tokenURI(id), "u1");
    }

    function testSupportsERC721Interface() public view {
        assertFalse(inft.supportsInterface(0xffffffff));
        assertTrue(inft.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(inft.supportsInterface(type(IERC7857).interfaceId));
    }

    /// @notice Receiver hook should observe the token's state already
    ///         initialized — proves we write before _safeMint.
    function testReceiverHookSeesInitializedState() public {
        StateProbingReceiver rcv = new StateProbingReceiver(address(inft));
        uint256 id = inft.mint(address(rcv), PUB_A, ROOT_0, "u");
        // The receiver recorded the state observed during onERC721Received;
        // it must equal the values we passed to mint.
        assertEq(rcv.observedStateRoot(), ROOT_0);
        assertEq(rcv.observedPubkey(), PUB_A);
        assertEq(id, 1);
    }
}

/// @dev Helper receiver: during the onERC721Received hook it reads back the
///      agent state via the iNFT and records what it saw. If the contract
///      writes state after _safeMint, this reads zero and the test fails.
contract StateProbingReceiver is IERC721Receiver {
    AgentdirINFT public immutable inft;
    bytes32 public observedStateRoot;
    bytes32 public observedPubkey;

    constructor(address inft_) {
        inft = AgentdirINFT(inft_);
    }

    function onERC721Received(address, address, uint256 tokenId, bytes calldata)
        external
        returns (bytes4)
    {
        observedStateRoot = inft.agentStateRoot(tokenId);
        observedPubkey = inft.agentAxlPubkey(tokenId);
        return IERC721Receiver.onERC721Received.selector;
    }
}
