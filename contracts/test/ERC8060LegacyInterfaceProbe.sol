// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/// @notice Lab-only illustration of historical one-function valueOf detection.
/// @dev Deliberately has no burn(), ETH backing or redemption path.
///      Its ERC-165 support MUST NOT be treated as the strict ERC-8060 profile.
contract ERC8060LegacyValueOnlyProbe is ERC165 {
    function valueOf(uint256) external pure returns (uint256) {
        return 1;
    }

    function supportsInterface(bytes4 interfaceId)
        public view override returns (bool)
    {
        return interfaceId == bytes4(keccak256("valueOf(uint256)"))
            || super.supportsInterface(interfaceId);
    }
}
