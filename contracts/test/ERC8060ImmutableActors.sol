// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IImmutableCollectionProbe {
    function mint() external payable returns (uint256);
    function burn(uint256 tokenId) external;
}

/// @dev Adversarial test only: fee destination refuses ETH.
contract RejectFeeReceiver {
    receive() external payable {
        revert("reject fee");
    }
}

/// @dev Adversarial test only: owner can mint, but refuses redemption ETH.
contract RejectBurnReceiver is IERC721Receiver {
    function mintAsContract(address collection) external payable {
        IImmutableCollectionProbe(collection).mint{value: msg.value}();
    }

    function burnAsContract(address collection, uint256 tokenId) external {
        IImmutableCollectionProbe(collection).burn(tokenId);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external pure override returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        revert("reject redemption");
    }
}

/// @dev Tries to reenter mint via _safeMint's ERC721Receiver callback.
contract ReenterMintReceiver is IERC721Receiver {
    address public collection;
    uint256 public mintPrice;
    bool public tried;
    bool public blocked;

    function fund() external payable {}

    function mintAsContract(address collection_) external payable {
        collection = collection_;
        mintPrice = msg.value;
        IImmutableCollectionProbe(collection).mint{value: msg.value}();
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external override returns (bytes4)
    {
        tried = true;
        (bool ok, ) = collection.call{value: mintPrice}(
            abi.encodeWithSignature("mint()")
        );
        blocked = !ok;
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}

/// @dev Tries to burn another held NFT during an ETH redemption callback.
contract ReenterBurnReceiver is IERC721Receiver {
    address public collection;
    uint256 public otherTokenId;
    bool public tried;
    bool public blocked;

    function mintAsContract(address collection_) external payable {
        collection = collection_;
        IImmutableCollectionProbe(collection).mint{value: msg.value}();
    }

    function burnAsContract(uint256 tokenId, uint256 otherTokenId_) external {
        otherTokenId = otherTokenId_;
        IImmutableCollectionProbe(collection).burn(tokenId);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external pure override returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        tried = true;
        (bool ok, ) = collection.call(
            abi.encodeWithSignature("burn(uint256)", otherTokenId)
        );
        blocked = !ok;
    }
}
