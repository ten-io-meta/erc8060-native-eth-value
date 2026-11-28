// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Strict draft ERC-8060 two-function interface.
/// @dev The interface contains no fee, administration, issuance or collateral
///      configuration rules; these belong to independent implementations.
interface IERC721Value {
    function valueOf(uint256 tokenId) external view returns (uint256);
    function burn(uint256 tokenId) external;
}

/// @notice Historical one-function discovery interface. Read-only ID alone
///         does NOT imply the ability to redeem ETH.
interface IERC721ValueReadOnlyLegacy {
    function valueOf(uint256 tokenId) external view returns (uint256);
}

/// @notice Single canonical adminless ERC-8060 ETH-backed reference.
/// @dev Research reference, not audited or approved for production deposits.
///      Each NFT is backed by the exact ETH paid at mint, without fees or caps.
///      This is not an ERC-8098 token (ERC-8098 concerns fungible ERC-20 supply).
contract ERC8060Reference is
    ERC721,
    ReentrancyGuard,
    IERC721Value
{
    error zeroBacking();
    error NotTokenOwner();
    error ReserveDeficit();
    error nonExistentToken();
    error ethRedemptionFailed();

    uint256 public nextTokenId = 1;
    uint256 public totalRedeemableValue;

    mapping(uint256 => uint256) private _redeemable;

    event BackedMint(uint256 indexed tokenId, address indexed recipient, uint256 value);
    event BackedBurn(uint256 indexed tokenId, address indexed owner, uint256 value);

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {}

    /// @notice Creates one NFT backed by precisely msg.value native ETH.
    /// @dev Mint is an example implementation method, not part of IERC721Value.
    function mint() external payable nonReentrant returns (uint256 tokenId) {
        if (msg.value == 0) revert zeroBacking();

        tokenId = nextTokenId++;
        _redeemable[tokenId] = msg.value;
        totalRedeemableValue += msg.value;

        _safeMint(msg.sender, tokenId);
        if (address(this).balance < totalRedeemableValue) revert ReserveDeficit();

        emit BackedMint(tokenId, msg.sender, msg.value);
    }

    function valueOf(uint256 tokenId) external view override returns (uint256) {
        if (_ownerOf(tokenId) == address(0)) revert nonExistentToken();
        return _redeemable[tokenId];
    }

    /// @notice Owner alone redeems its NFT's exact ETH or everything reverts.
    function burn(uint256 tokenId) external override nonReentrant {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        uint256 payout = _redeemable[tokenId];
        if (address(this).balance < totalRedeemableValue) revert ReserveDeficit();

        delete _redeemable[tokenId];
        totalRedeemableValue -= payout;
        _burn(tokenId);

        (bool sent, ) = payable(msg.sender).call{value: payout}("");
        if (!sent) revert ethRedemptionFailed();

        emit BackedBurn(tokenId, msg.sender, payout);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721)
        returns (bool)
    {
        return interfaceId == type(IERC721Value).interfaceId
            || interfaceId == type(IERC721ValueReadOnlyLegacy).interfaceId
            || super.supportsInterface(interfaceId);
    }

    // Deliberately NO: Ownable, mint fees, fee wallets, issue caps, metadata
    // configuration, reserve withdrawal, privileged burning, proxy or upgrade.
    // Non-payable fallback: normal direct ETH transfers revert. Forced ETH
    // can become irrecoverable surplus; this is intentional in this example.
}