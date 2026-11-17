# ERC-8060 Reference Implementation
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.20849904.svg)](https://doi.org/10.5281/zenodo.20849904)
Reference implementation and test suite for ERC-8060 native ETH value-bearing NFTs.

## Overview

This repository contains a minimal ERC-8060 reference implementation demonstrating:

* Native ETH-backed ERC-721 tokens
* On-chain redeemable value tracking
* Atomic redemption through burn
* Surplus accounting
* ERC-165 interface detection
* Economic invariant testing

The implementation is intentionally simple and is designed as a reference model for auditors, implementers and standards discussions.

---

## Reference Parameters

This reference implementation uses:

* Mint price: `0.12 ETH`
* Redeemable value: `0.10 ETH`

These values are example parameters only.

ERC-8060 does not mandate any specific mint price, collateral ratio or redeemable value.

The original TEN.IO genesis deployment used:

* Mint price: `0.012 ETH`
* Redeemable value: `0.01 ETH`

Future TEN.IO fragments may use different parameters while preserving the same accounting model.

---

## Core Invariants

### Invariant 1

```text
address(this).balance >= totalRedeemableValue
```

The contract must always remain solvent.

### Invariant 2

```text
totalRedeemableValue
=
Σ valueOf(tokenId)
for all live tokens
```

Outstanding obligations must equal the sum of redeemable values for all existing tokens.

### Invariant 3

```text
Burn removes redeemable obligation
before ETH transfer
```

Accounting updates occur before external value transfer.

### Invariant 4

```text
Surplus withdrawals can never reduce
redeemable obligations
```

Only excess ETH above outstanding obligations may be withdrawn.

---

## Contract Features

* ERC-721 compatible
* ERC-721 Metadata compatible
* ERC-165 interface detection
* IERC721Value interface detection
* Redeemable value accounting
* Surplus accounting
* Owner-controlled surplus withdrawal
* Reentrancy protection
* Event emission for mint, burn and surplus withdrawal

---

## Strict IERC721Value Interface and ERC-165 Identity

The current ERC-8060 **draft** requires both:

```solidity
interface IERC721Value {
    function valueOf(uint256 tokenId) external view returns (uint256);
    function burn(uint256 tokenId) external;
}
```

The draft interface ID is `0x88495fe7`, the ERC-165 XOR of the
`valueOf(uint256)` and `burn(uint256)` function selectors.

An earlier version of this repository defined only `valueOf(uint256)`
in the interface, yielding the historical ERC-165 ID `0xcadf338f`.
The implementation nevertheless already supported owner-only `burn()`.

**Migration policy (opt-in compatibility, without weakening strict burn):**

| ERC-165 ID | Declared capability | Correct consumer interpretation |
| --- | --- | --- |
| `0x88495fe7` | `valueOf(uint256)` + `burn(uint256)` | **Strict ERC-8060 draft interface**, including owner-initiated full redemption |
| `0xcadf338f` | Historical `valueOf(uint256)` only | **Read-only value query**; does NOT certify a working burn path |

This updated reference intentionally advertises **both** interface IDs
because it implements both signatures and can serve older value-query
integrations. The strict, two-function ID is the sole ERC-8060 draft
compliance signal. New financial applications MUST check that strict ID
rather than relying on the historical query-only interface, a naked
`valueOf` call, or any untrusted ERC-165 advertisement.

Already deployed contracts do not change when this repository is updated.
An old deployment that advertises only `0xcadf338f` must **not** be
automatically promoted to strict ERC-8060 by a wallet or marketplace;
it may require separate verification of its actual redemption path.
New deployments of this updated reference keep both IDs visible.

The code only claims supported interfaces; it cannot authenticate that
an arbitrary external NFT genuinely holds or pays the advertised ETH.
This migration does not change mint/burn amounts or the accounting path.

This reference is a **strict full-token burn/redemption profile**.
Conditional reservation profiles are separate experimental
implementations and must not advertise this interface if active
reservations can prevent the promised complete redemption.

Draft status does not imply ERC finalization or an independent audit.

### Historical TENIO Fragment is **not** this strict implementation

The older [TENIO Fragment source and deployed executable](https://github.com/ten-io-meta/TENIO-Fragment/pull/3)
was examined separately. Its deployed contract lacks the required `valueOf()`
and strict ERC-165 identity, permits owner withdrawal of all backing, and can
destroy tokens without paying when insufficiently funded. Those historical
properties are **not imported** by this strict reference. The archived contracts
remain deployed and are not modified or migrated by this PR.

The strict reference has a protected `totalRedeemableValue` liability and
only permits owner withdrawal of independently measured surplus. In an
artificially underfunded Hardhat state, `burn()` reverts without destroying
the NFT or reducing liabilities; this is not a claim that public users can
force an underfunding state in the reference.

ERC-165 capability declarations are not proof of authentic ETH backing:
consumers accepting external NFTs still need trustworthy provenance and
runtime economic validation. The contract and tests are research references,
not audited production deployments.

---

## Test Coverage

Current test suite includes:

* Mint validation
* Redemption logic
* Double redemption prevention
* Transfer safety
* Surplus accounting
* Solvency preservation
* Interface detection
* Reentrancy protection (a receiver tries to burn a **different live token** during payout)
* Atomic redemption behavior when an ETH receiver explicitly rejects payment
* No NFT destruction under simulated ETH insolvency (test-only fault injection, not an onchain withdrawal route)
* Exact ERC-165 selector XOR, optional legacy query ID, and a value-only impostor rejected as strict
* Interface discovery stability across mint/transfer/burn cycles
* Event emission validation

The test file contains **52 substantive Mocha tests** after replacing four
placeholder cases and adding negative tests for historical value-only detection
and for an artificially underfunded vault (Hardhat balance fault injection). Refer to the GitHub Actions `ERC-8060 strict reference tests`
workflow for the execution result of the commit being reviewed.
The workflow uses the locked npm dependency tree, compiles Solidity, and
runs the entire Hardhat suite on every pull request.

---

## Development Environment

* Solidity `0.8.20`
* OpenZeppelin Contracts `4.9.6`
* Hardhat `2.22.19`

Install dependencies:

```bash
npm install
```

Compile:

```bash
npx hardhat compile
```

Run tests:

```bash
npx hardhat test
```

---

## License

MIT
