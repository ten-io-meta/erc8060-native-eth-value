// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IERC8060CreatorFeeTestTarget {
    function mint(string calldata uri) external payable;
    function burn(uint256 tokenId) external;
}

/// @notice Test-only receiver: reject payouts and attempt nested calls.
/// @dev This is intentionally not a safe production wallet.
contract ERC8060CreatorFeeTestActor is IERC721Receiver {
    address public target;
    bool public rejectETH;
    bool public reenterCollect;
    bool public reenterMint;
    bool public didTryCollect;
    bool public collectReentered;
    bool public didTryMint;
    bool public mintReentered;

    function setTarget(address target_) external {
        target = target_;
    }

    function setRejectETH(bool reject_) external {
        rejectETH = reject_;
    }

    function setReenterCollect(bool active) external {
        reenterCollect = active;
        didTryCollect = false;
        collectReentered = false;
    }

    function setReenterMint(bool active) external {
        reenterMint = active;
        didTryMint = false;
        mintReentered = false;
    }

    function mintHeld(string calldata uri) external payable {
        IERC8060CreatorFeeTestTarget(target).mint{value: msg.value}(uri);
    }

    function burnHeld(uint256 tokenId) external {
        IERC8060CreatorFeeTestTarget(target).burn(tokenId);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external override returns (bytes4)
    {
        require(msg.sender == target, "Unexpected NFT");
        if (reenterMint) {
            reenterMint = false;
            didTryMint = true;
            (mintReentered,) = target.call{value: 0.12 ether}(
                abi.encodeWithSignature("mint(string)", "ipfs://nested")
            );
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        require(!rejectETH, "Actor rejects ETH");
        if (reenterCollect && msg.sender == target) {
            reenterCollect = false;
            didTryCollect = true;
            (collectReentered,) = target.call(
                abi.encodeWithSignature("collectFees()")
            );
        }
    }
}
