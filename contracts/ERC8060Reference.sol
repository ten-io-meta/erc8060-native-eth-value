// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IERC721Value {
    function valueOf(uint256 tokenId) external view returns (uint256);
    function burn(uint256 tokenId) external;
}

contract ERC8060Reference is ERC721URIStorage, Ownable, ReentrancyGuard, IERC721Value {
    uint256 public nextTokenId;

    uint256 public constant MINT_PRICE = 0.12 ether;
    uint256 public constant REDEEM_VALUE = 0.10 ether;

    bytes4 public constant IERC721VALUE_INTERFACE_ID =
        type(IERC721Value).interfaceId;

    uint256 public totalRedeemableValue;

    mapping(uint256 => uint256) private _redeemableValue;

    constructor() ERC721("ERC8060 Reference", "ERC8060") {}

    function mint(string calldata uri) external payable {
        require(msg.value == MINT_PRICE, "Incorrect ETH amount");

        uint256 tokenId = ++nextTokenId;

        _redeemableValue[tokenId] = REDEEM_VALUE;
        totalRedeemableValue += REDEEM_VALUE;

        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);
    }

    function valueOf(uint256 tokenId)
        public
        view
        override
        returns (uint256)
    {
        require(_exists(tokenId), "Nonexistent token");
        return _redeemableValue[tokenId];
    }

    function burn(uint256 tokenId)
        external
        override
        nonReentrant
    {
        require(ownerOf(tokenId) == msg.sender, "Not token owner");

        uint256 redeemable = _redeemableValue[tokenId];
        require(address(this).balance >= redeemable, "Insufficient contract balance");

        delete _redeemableValue[tokenId];
        totalRedeemableValue -= redeemable;

        _burn(tokenId);

        (bool success, ) = payable(msg.sender).call{value: redeemable}("");
        require(success, "ETH transfer failed");
    }

    function surplusValue() public view returns (uint256) {
        return address(this).balance - totalRedeemableValue;
    }

    function withdrawSurplus(uint256 amount) external onlyOwner nonReentrant {
        require(amount <= surplusValue(), "Exceeds surplus value");

        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "ETH transfer failed");
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage)
        returns (bool)
    {
        return
            interfaceId == type(IERC721Value).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    receive() external payable {}
}