// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IERC721Value {
    function valueOf(uint256 tokenId) external view returns (uint256);
    function burn(uint256 tokenId) external;
}

contract ERC8060Reference is ERC721URIStorage, Ownable, IERC721Value {

    uint256 public nextTokenId;

    uint256 public constant MINT_PRICE = 0.12 ether;
    uint256 public constant REDEEM_VALUE = 0.10 ether;

    constructor()
    ERC721("ERC8060 Reference", "ERC8060")
{}

    function mint(string calldata uri) external payable {
        require(msg.value == MINT_PRICE, "Incorrect ETH amount");

        uint256 tokenId = ++nextTokenId;

        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);
    }

    function valueOf(uint256 tokenId)
        public
        view
        override
        returns (uint256)
    {
        require(ownerOf(tokenId) != address(0), "Nonexistent token");
        return REDEEM_VALUE;
    }

    function burn(uint256 tokenId)
        external
        override
    {
        require(ownerOf(tokenId) == msg.sender, "Not token owner");

        _burn(tokenId);

        payable(msg.sender).transfer(REDEEM_VALUE);
    }

    receive() external payable {}
}