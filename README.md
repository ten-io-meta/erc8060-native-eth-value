# ERC-8060 — Native ETH value-bearing NFT reference

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.20849904.svg)](https://doi.org/10.5281/zenodo.20849904)

**Draft research implementation, not a certified/audited standard or a deployment endorsement.**

This repository studies a deliberately small, implementation-independent ERC-8060 interface for ERC-721 NFTs with redeemable native ETH:

```solidity
interface IERC721Value {
    function valueOf(uint256 tokenId) external view returns (uint256);
    function burn(uint256 tokenId) external;
}
```

Its strict ERC-165 interface identifier is `0x88495fe7`. A self-reported interface identifier is **not evidence of actual backing or contract provenance**.

## Preferred minimal implementation: no administrator, no product economics

**`contracts/ERC8060Reference.sol`** is the proposed strict reference that models one ERC-721 NFT per fully funded ETH deposit.

- Each mint deposits its own independent backing; no fee, fixed price, branded collection or external beneficiary exists in this example.
- `valueOf()` reports the ETH a live NFT owner can redeem.
- `burn()` pays **exactly** the recorded amount or reverts all effects, and only the current NFT owner can call it.
- No `Ownable`, privileged withdrawal, role granting, implementation upgrade or administrator.
- No fixed issuance cap; specific supply restrictions are **application-level choices**, not part of ERC-8060.

Detailed invariant and security documentation: [docs/reference/no-admin-native-eth.md](docs/reference/no-admin-native-eth.md).

## Unified strict and historical interface detection

The single production-oriented research reference is `contracts/ERC8060Reference.sol`. Its primary ERC-165 identity is strict `0x88495fe7` (both functions). It **also** advertises legacy **value-only** detection `0xcadf338f` for older clients, without granting the legacy profile the same economic guarantees. A mock implementing only `valueOf` must not be misclassified as strict.

This consolidated branch replaces the previous `Ownable` fixed-price reference. The previous implementation and its 52-test suite remain recoverable from [historic PR #1](https://github.com/ten-io-meta/erc8060-native-eth-value/pull/1) and git history; they are **not** the canonical reference. No `Ownable`, fee, surplus claim, token price, issuer wallet, or upgrade route remains in the canonical Solidity contract.

## Separate projects / composability

- **ERC-8060**: standard interface, native ETH backing and atomic owner redemption.
- **ERC-8098**: independent ERC-20 irreversible/non-increasing supply profile; not required or implied by ERC-8060.
- **Reservable**: optional conditional accounting, distinct from the strict owner-redemption profile whenever existing locks block whole-token burn.
- **OECL**: laboratory for deployment provenance, concrete economic rights and reproducible evidence. It is not an omniscient safety certificate.
- **TEN.IO** and all other issuers: application-layer contracts, collection names, prices, issuance caps, fees, recipient wallets and artwork belong in their own application repositories.

A separated example of TEN.IO's commercial implementation is maintained in [TEN.IO application draft PR #1](https://github.com/ten-io-meta/TEN-IO/pull/1); it is not part of the normative ERC-8060 interface.

## Implementation security distinctions

- A simple fully funded `mint()` allows any positive ETH deposit; it is **not part of IERC721Value** and does **not** represent any branded collection.
- The contract uses checks-effects-interactions and `nonReentrant` on mint and burn. Burning sends exactly the recorded token value or reverts entirely.
- Forced ETH can become irrecoverable surplus because there is deliberately **no** withdrawal authority. This is a no-admin policy trade-off, not a protocol requirement.
- The test suite includes an independent shadow-amount accounting sequence across mints/transfers/burns, rejecting ETH receivers, reentrant callbacks, intentional local fault injection, ERC165 legacy-vs-strict, and event checks.
- All testing is local EVM simulation, **not a third-party smart-contract audit**. Never equate claims in `supportsInterface` with authenticated bytecode and actual reserves.

## Verify locally

```bash
pnpm install --frozen-lockfile
pnpm compile
pnpm test
```

All tests are local simulations. Passing tests is not an independent smart-contract audit or proof against all attacks. The minimal implementation should not be deployed with third-party funds until external security review, stateful invariant/fuzz testing, source and constructor provenance and adversarial interoperability testing are complete.

**No Ethereum transaction or deployment is performed by this repository's tests.**
