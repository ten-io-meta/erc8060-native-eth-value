// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IERC8060NativeMintBurnProbe {
    function mint() external payable returns (uint256);
    function burn(uint256 id) external;
}

/// @dev Simulates a contract NFT holder that cannot receive its ETH redemption.
contract ReferenceRejectETH is IERC721Receiver {
    function mintFrom(address nft) external payable {
        IERC8060NativeMintBurnProbe(nft).mint{value: msg.value}();
    }

    function tryBurn(address nft, uint256 id) external {
        IERC8060NativeMintBurnProbe(nft).burn(id);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external pure override returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable { revert("no ETH accepted"); }
}

/// @dev Attempts to mint twice inside ERC721Receiver callback.
contract ReferenceMintReentrancy is IERC721Receiver {
    address public nft;
    uint256 public value;
    bool public tried;
    bool public blocked;

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
