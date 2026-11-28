// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IERC8060NativeMintBurnProbe {
    function mint() external payable returns (uint256);
    function burn(uint256 id) external;
}

/// @dev Simulates a contract NFT holder that cannot receive its ETH redemption.
contract ReferenceRejectETH is IERC721Receiver {
    error noEthAccepted();
    error notActorController();

    // Test-only recovery capability: NOT a generic ERC-8060 right.
    address public immutable controller;

    constructor() { controller = msg.sender; }

    function mintFrom(address nft) external payable {
        IERC8060NativeMintBurnProbe(nft).mint{value: msg.value}();
    }

    function tryBurn(address nft, uint256 id) external {
        IERC8060NativeMintBurnProbe(nft).burn(id);
    }

    /// @dev A specific rejecting-owner contract MAY offer a recovery transfer.
    ///      ERC-8060 cannot promise this for all contract owners.
    function transferOwnedToken(address nft, address recipient, uint256 id) external {
        if (msg.sender != controller) revert notActorController();
        IERC721(nft).transferFrom(address(this), recipient, id);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external pure override returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable { revert noEthAccepted(); }
}

/// @dev Attempts to mint twice inside ERC721Receiver callback.
contract ReferenceMintReentrancy is IERC721Receiver {
    address public nft;
    uint256 public value;
    bool public tried;
    bool public blocked;

    function fund() external payable {}

    function mintFrom(address nft_) external payable {
        nft = nft_;
        value = msg.value;
        IERC8060NativeMintBurnProbe(nft).mint{value: msg.value}();
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external override returns (bytes4)
    {
        tried = true;
        (bool ok, ) = nft.call{value: value}(abi.encodeWithSignature("mint()"));
        blocked = !ok;
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}

/// @dev Attempts second-token burn from the first token's refund callback.
contract ReferenceBurnReentrancy is IERC721Receiver {
    address public nft;
    uint256 public otherId;
    bool public tried;
    bool public blocked;

    function mintFrom(address nft_) external payable {
        nft = nft_;
        IERC8060NativeMintBurnProbe(nft).mint{value: msg.value}();
    }

    function burnFirst(uint256 id, uint256 otherId_) external {
        otherId = otherId_;
        IERC8060NativeMintBurnProbe(nft).burn(id);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external pure override returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        tried = true;
        (bool ok, ) = nft.call(abi.encodeWithSignature("burn(uint256)", otherId));
        blocked = !ok;
    }
}

/// @dev Does not implement IERC721Receiver. A safe mint to this contract must revert.
contract ReferenceRejectNFT {
    function mintFrom(address nft) external payable {
        IERC8060NativeMintBurnProbe(nft).mint{value: msg.value}();
    }
}