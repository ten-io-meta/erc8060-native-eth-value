// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @notice Exact two-function interface of the ERC-8060 draft.
/// @dev Local definition keeps the no-admin candidate free of Ownable imports.
interface IERC721ValueNoAdmin {
    function valueOf(uint256 tokenId) external view returns (uint256);
    function burn(uint256 tokenId) external;
}

/// @notice Optional ERC-165 discovery of the earlier query-only interface.
/// @dev This ID does not, by itself, promise redeemability.
interface IERC721ValueReadOnlyNoAdmin {
    function valueOf(uint256 tokenId) external view returns (uint256);
}

/// @title ERC8060CreatorFeeReference
/// @notice EXPERIMENTAL non-upgradeable, no-admin, ETH-backed NFT with
///         immutable recipient for earned mint fees only.
/// @dev Fee recipient is selected by EACH deployer in the constructor.
///      There is no owner, fee setter, emergency drain or recovery function.
///      ERC-8060 standard ABI stays exactly valueOf + burn.
///      NOT independently audited. Never deploy with real funds unreviewed.
contract ERC8060CreatorFeeReference is
    ERC721URIStorage, ReentrancyGuard, IERC721ValueNoAdmin
{
    uint256 public constant MINT_PRICE = 0.12 ether;
    uint256 public constant REDEEM_VALUE = 0.10 ether;
    uint256 public constant CREATOR_FEE = MINT_PRICE - REDEEM_VALUE;

    /// @notice Fee destination is fixed forever for THIS deployment.
    address payable public immutable feeRecipient;

    uint256 public nextTokenId;
    uint256 public totalRedeemableValue;
    uint256 public feesAccrued;

    mapping(uint256 => uint256) private _redeemableValue;

    event Minted(address indexed holder, uint256 indexed tokenId, uint256 backing);
    event Burned(address indexed holder, uint256 indexed tokenId, uint256 backing);
    event CreatorFeesCollected(address indexed recipient, uint256 amount);

    constructor(address payable feeRecipient_)
        ERC721("ERC8060 Creator Fee Reference", "E8060F")
    {
        require(feeRecipient_ != address(0), "Zero fee recipient");
        require(feeRecipient_ != address(this), "Self fee recipient");
        feeRecipient = feeRecipient_;
    }

    function mint(string calldata uri) external payable nonReentrant {
        require(msg.value == MINT_PRICE, "Incorrect ETH amount");

        uint256 tokenId = ++nextTokenId;
        _redeemableValue[tokenId] = REDEEM_VALUE;
        totalRedeemableValue += REDEEM_VALUE;
        feesAccrued += CREATOR_FEE;

        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);

        emit Minted(msg.sender, tokenId, REDEEM_VALUE);
    }

    function valueOf(uint256 tokenId) public view override returns (uint256) {
        require(_exists(tokenId), "Nonexistent token");
        return _redeemableValue[tokenId];
    }

    function burn(uint256 tokenId) external override nonReentrant {
        require(ownerOf(tokenId) == msg.sender, "Not token owner");

        uint256 value = _redeemableValue[tokenId];
        require(
            address(this).balance >= totalRedeemableValue + feesAccrued,
            "Insufficient obligations backing"
        );

        delete _redeemableValue[tokenId];
        totalRedeemableValue -= value;
        _burn(tokenId);

        (bool sent, ) = payable(msg.sender).call{value: value}("");
        require(sent, "ETH redemption failed");

        emit Burned(msg.sender, tokenId, value);
    }

    /// @notice Anyone may trigger a withdrawal of EARNED fees.
    ///         ETH always goes to the constructor-pinned feeRecipient.
    function collectFees() external nonReentrant {
        uint256 amount = feesAccrued;
        require(amount != 0, "No earned fees");
        require(
            address(this).balance >= totalRedeemableValue + amount,
            "Insufficient obligations backing"
        );

        feesAccrued = 0;
        (bool sent, ) = feeRecipient.call{value: amount}("");
        require(sent, "Fee transfer failed");

        emit CreatorFeesCollected(feeRecipient, amount);
    }

    /// @notice ETH that is neither a live NFT claim nor an earned fee.
    /// @dev Accidental/forced ETH cannot be collected: NO discretionary sweep.
    function unallocatedETH() external view returns (uint256) {
        uint256 obligations = totalRedeemableValue + feesAccrued;
        return address(this).balance > obligations
            ? address(this).balance - obligations : 0;
    }

    function isSolvent() external view returns (bool) {
        return address(this).balance >= totalRedeemableValue + feesAccrued;
    }

    function _burn(uint256 tokenId)
        internal override(ERC721URIStorage)
    {
        super._burn(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721URIStorage) returns (bool)
    {
        return interfaceId == type(IERC721ValueNoAdmin).interfaceId
            || interfaceId == type(IERC721ValueReadOnlyNoAdmin).interfaceId
            || super.supportsInterface(interfaceId);
    }

    // No receive() or fallback(): accidental direct ETH transfers revert.
    // Forced ETH is possible on Ethereum but never becomes earned creator fees.
}
