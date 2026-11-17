// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "../ERC8060Reference.sol";

/// @notice Test-only receiver probing failed ETH payouts and nested burns.
/// @dev Not intended for production. It can hold ERC-8060 NFTs and is configured
///      by tests to reject redemptions or attempt reentrancy on ETH receipt.
contract ERC8060RedemptionProbe is IERC721Receiver {
    ERC8060Reference public immutable target;

    bool public rejectETH;
    uint256 public reenterTokenId;
    bool public attemptedReentry;
    bool public reentrantCallSucceeded;

    constructor(address target_) {
        require(target_ != address(0), "zero target");
        target = ERC8060Reference(payable(target_));
    }

    function mintForSelf(string calldata uri) external payable {
        target.mint{value: msg.value}(uri);
    }

    function burnHeld(uint256 tokenId) external {
        target.burn(tokenId);
    }

    function setRejectETH(bool reject_) external {
        rejectETH = reject_;
    }

    function armReentrantBurn(uint256 tokenId) external {
        require(tokenId != 0, "zero token");
        reenterTokenId = tokenId;
        attemptedReentry = false;
        reentrantCallSucceeded = false;
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        view
        override
        returns (bytes4)
    {
        require(msg.sender == address(target), "unexpected NFT");
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        require(msg.sender == address(target), "unexpected ETH");
        require(!rejectETH, "receiver rejects ETH");

        uint256 tokenId = reenterTokenId;
        if (tokenId != 0) {
            reenterTokenId = 0;
            attemptedReentry = true;
            // A failed inner call is intentionally caught so the outer
            // legitimate redemption can complete and be independently checked.
            (reentrantCallSucceeded,) = address(target).call(
                abi.encodeWithSelector(target.burn.selector, tokenId)
            );
        }
    }
}
