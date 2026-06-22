// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC8060MintBurn {
    function mint(string calldata uri) external payable;
    function burn(uint256 tokenId) external;
}

contract MaliciousReceiver {
    bool public rejectETH;
    bool public tryReenter;
    address public target;
    uint256 public tokenId;

    constructor(address _target) {
        target = _target;
    }

    function mint(string calldata uri) external payable {
        IERC8060MintBurn(target).mint{value: msg.value}(uri);
    }

    function burn(uint256 _tokenId) external {
        tokenId = _tokenId;
        IERC8060MintBurn(target).burn(_tokenId);
    }

    function setRejectETH(bool value) external {
        rejectETH = value;
    }

    function setTryReenter(bool value) external {
        tryReenter = value;
    }

    receive() external payable {
        require(!rejectETH, "Rejected ETH");

        if (tryReenter) {
            IERC8060MintBurn(target).burn(tokenId);
        }
    }
}