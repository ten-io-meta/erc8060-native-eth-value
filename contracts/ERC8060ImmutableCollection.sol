// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @notice Strict draft ERC-8060: owner-only NFT destruction in exchange for ETH.
interface IERC721ValueImmutable {
    function valueOf(uint256 tokenId) external view returns (uint256);
    function burn(uint256 tokenId) external;
}

/// @notice Immutable, no-admin, ETH-backed ERC-721 collection.
/// @dev Research reference; requires independent audit before real deposits.
///      The fee beneficiary receives *only* fees, never custody or reserve powers.
///      Parameters are fixed at deployment; burned token IDs are never reminted.
contract ERC8060ImmutableCollection is ERC721, ReentrancyGuard, IERC721ValueImmutable {
    uint256 public immutable backingPerToken;
    uint256 public immutable mintFee;
    uint256 public immutable maxMinted;
    address payable public immutable feeRecipient;
    uint256 public immutable mintPrice;

    string private _metadataBaseURI;
    uint256 public totalMinted;
    uint256 public totalBurned;
    uint256 public totalRedeemableValue;

    event Minted(
        uint256 indexed tokenId,
        address indexed to,
        uint256 backing,
        uint256 fee
    );
    event Redeemed(
        uint256 indexed tokenId,
        address indexed owner,
        uint256 paid
    );

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataBaseURI_,
        uint256 backingPerToken_,
        uint256 mintFee_,
        uint256 maxMinted_,
        address payable feeRecipient_
    ) ERC721(name_, symbol_) {
        require(backingPerToken_ > 0, "zero backing");
        require(maxMinted_ > 0, "zero cap");
        require(feeRecipient_ != address(0), "zero recipient");
        require(feeRecipient_ != address(this), "self recipient");
        require(bytes(metadataBaseURI_).length > 0, "empty metadata URI");

        // Overflows revert under Solidity 0.8.x.
        backingPerToken = backingPerToken_;
        mintFee = mintFee_;
        mintPrice = backingPerToken_ + mintFee_;
        maxMinted = maxMinted_;
        feeRecipient = feeRecipient_;
        _metadataBaseURI = metadataBaseURI_;
    }

    /// @dev ERC-721 tokenURI = fixed collection base URI + never-reused ID.
    ///      The intended directory should be content addressed, e.g. ipfs://CID/.
    function _baseURI() internal view override returns (string memory) {
        return _metadataBaseURI;
    }

    /// @notice Mint exactly one fully ETH-backed token, paying fee atomically.
    /// @dev Permissionless until irreversible maxMinted cap. No manager or
    ///      additional mint path. Fee delivery failure reverts ALL mint state.
    function mint() external payable nonReentrant returns (uint256 tokenId) {
        require(totalMinted < maxMinted, "mint cap reached");
        require(msg.value == mintPrice, "wrong mint price");

        tokenId = totalMinted + 1;
        totalMinted = tokenId;
        totalRedeemableValue += backingPerToken;

        _safeMint(msg.sender, tokenId);

        if (mintFee != 0) {
            (bool delivered, ) = feeRecipient.call{value: mintFee}("");
            require(delivered, "fee delivery failed");
        }

        require(address(this).balance >= totalRedeemableValue, "reserve deficit");
        emit Minted(tokenId, msg.sender, backingPerToken, mintFee);
    }

    function valueOf(uint256 tokenId) external view override returns (uint256) {
        require(_exists(tokenId), "nonexistent token");
        return backingPerToken;
    }

    /// @notice Exactly backingPerToken ETH or revert without losing the NFT.
    /// @dev Neither fee recipient nor an ERC-721 approved operator can burn.
    function burn(uint256 tokenId) external override nonReentrant {
        require(ownerOf(tokenId) == msg.sender, "not token owner");
        uint256 value = backingPerToken;
        require(address(this).balance >= totalRedeemableValue, "reserve deficit");

        totalRedeemableValue -= value;
        totalBurned += 1;
        _burn(tokenId);

        (bool delivered, ) = payable(msg.sender).call{value: value}("");
        require(delivered, "redemption failed");
        emit Redeemed(tokenId, msg.sender, value);
    }

    function liveSupply() external view returns (uint256) {
        return totalMinted - totalBurned;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721)
        returns (bool)
    {
        return interfaceId == type(IERC721ValueImmutable).interfaceId
            || super.supportsInterface(interfaceId);
    }

    // No owner(), no withdrawal function, no proxy/upgrade and no fee setter.
    // Plain ETH donations revert; forced ETH may still remain irrevocably
    // stranded as unallocated surplus (never a new redemption obligation).
}
