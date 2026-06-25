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

## Test Coverage

Current test suite includes:

* Mint validation
* Redemption logic
* Double redemption prevention
* Transfer safety
* Surplus accounting
* Solvency preservation
* Interface detection
* Reentrancy protection
* Atomic redemption behavior
* Event emission validation

Current status:

```text
49 passing tests
0 failing tests
```

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
