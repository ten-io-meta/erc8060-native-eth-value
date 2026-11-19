# Immutable ERC-8060 collections: fee-forwarding without administrative powers

**Status:** candidate reference implementation, research only. NOT independently audited or approved for Mainnet funds. This is a new contract in a *separate draft PR*, not a patch to deployed historical TENIO Fragment or Shapes contracts. It is independent from the strict legacy-interface alignment PR #1.

## Non-negotiable economics

`ERC8060ImmutableCollection` uses the **strict** draft ERC-8060 `IERC721Value` functions:
- `valueOf(uint256)`: the amount in native ETH that the live NFT owner can redeem.
- `burn(uint256)`: only the current NFT owner can destroy the token; **exact** ETH value must be paid or the entire transaction reverts.

One deployment = one economic collection, with fixed constructor parameters: `backingPerToken`, `mintFee`, `feeRecipient`, `maxMinted`, name, symbol and metadata base URI. There is no `Ownable`, admin key, setter, proxy, upgrade route, emergency withdrawal, pausing authority, mint privilege or privileged burn.

### Confirmed denomination examples

| Profile | Recoverable backing | Mint fee | Total mint price |
| --- | ---: | ---: | ---: |
| Umbral | **0.010 ETH** | **0.002 ETH** | **0.012 ETH** |
| Higher collection | **0.10 ETH** | **0.02 ETH** | **0.12 ETH** |
| Future denominations | **1 ETH**, **10 ETH** | **NOT YET DEFINED** | Backing + fee |

**These are examples, not hardcoded deployment instructions.** Fee amount for future 1 ETH and 10 ETH collections is undecided and MUST NOT be copied from test values without an explicit decision. Every collection deploys a distinct contract with immutable parameters.

**Fee wallet:** The intended real-world beneficiary has been discussed, but its exact destination `0x...` has NOT been independently verified in this implementation request. **DO NOT substitute the historical TENIO Fragment owner address or the Shapes contract's third-party fee recipient.** Instead deployment requires an explicit, validated `feeRecipient_` constructor parameter. Only set the actual beneficiary address after verifying its checksum, network, ownership and receiving behavior. The wallet receives fees; it has **zero authority** over contract configuration and backing.

### Mint sequence and reserve

For each successful `mint()`, exactly `backingPerToken + mintFee` native ETH is supplied. The token is minted, the `backingPerToken` amount is reflected in `totalRedeemableValue` and the fee is sent to immutable `feeRecipient` **in the same transaction**. If the beneficiary wallet/contract rejects ETH, the entire mint reverts — **no NFT is created and no ETH is retained**.

Reserve after each complete mint:

```text
balance(address(this)) >= totalRedeemableValue
totalRedeemableValue == backingPerToken * (totalMinted - totalBurned)
```

On burn the contract reduces liabilities, destroys the token and sends exactly `backingPerToken` ETH to its **current owner**. A failed transfer reverts the ownership, counter and liability changes. ERC-721 token approvals do not confer burn rights.

**No surplus extraction:** direct ordinary ETH donations revert; unsolicited forced ETH (and other unusual native-value deliveries) may be trapped permanently in the contract. There is no rescue function. This is intentional for a no-admin reference but is a real operational cost of the design.

### Permanent scarcity (optional product profile; NOT ERC-8098 conformance)

`maxMinted` is a positive immutable constructor argument. `totalMinted` increases from 0 to at most `maxMinted`; numeric token IDs are never reissued, even after a burn. Once the cap is reached, issuance is closed **forever**.

ERC-8098 itself is an ERC-20 supply profile. This ERC-721 cap takes inspiration from its irreversible supply principles, but the NFT contract does not claim to implement ERC-8098. ERC-8098's zero-remint rule does not intrinsically prove native-ETH backing.

### Metadata

Every token URI is `metadataBaseURI + tokenId`. Set a static, content-addressed folder base such as `ipfs://<directory CID>/` and publish an object named `1`, `2`, etc. The prefix is set only in the constructor and cannot later change via a setter. **Do not deploy before metadata is published and verified.** The mint is permissionless, meaning buyers can mint before a planned release if contract is deployed and funded; the first transaction to mint takes the next token ID. To enforce presales/whitelists without admin roles requires a **separate explicitly reviewed immutable distribution design**, not silently added to the economic ERC interface.

### No-admin design boundaries

- The designated fee wallet can receive/spend *its own fees*; it has no capability to change parameters or spend backing.
- There is no recovery from a mistaken fee recipient or incorrect URI: they are permanent.
- The contract can be interacted with by external wallets/apps even if their code is unaudited. ERC-165 tells consumers that the strict 2-method interface is claimed; **it is not a proof of authenticated provenance, solvency or the quality of external apps**.
- Smart-contract NFT owners which refuse incoming ETH cannot burn successfully while ownership stays there. The revert preserves their NFT, but they may need to transfer it to a receiving wallet.
- A future high-value collection (1–10 ETH per NFT) MUST pass an independent security audit, fuzz/invariant property tests, deployment provenance verification, fee-recipient verification and a staged testnet review before any real deposits.

## Reproduction

```bash
npm ci
npm run compile
npx hardhat test test/ERC8060ImmutableCollection.test.js
npm test
```

The new tests cover exact fees, owner-only redemption, multiple denominations, refund rollback, receiver refusals, reentrant mint & burn callbacks, permanent mint cap, metadata immutability, ERC-165 strict ID and absence of admin selectors.

**No deployed Ethereum contract is changed by this PR.** No Mainnet deployment, mint, fee payment, NFT burn or live-wallet transaction is part of the workflow. Merge only after review; deployment requires separate explicit authorization and an exact verified fee wallet.

## Next audit gates
1. Review all external-call paths and verify the compiled runtime/full build provenance (compiler and dependencies pinned).
2. Add stateful invariant/fuzz testing with an independent shadow liability ledger (not self-reported storage only), and hostile sequences of mint, transfer, burn, ERC721Receiver callback, forced ETH and fee failure.
3. Decide whether purely permissionless capped issuance meets the product's provenance and launch policy. A finite cap alone does **not** reserve specific editions for original works.
4. Verify actual fee recipient and metadata CID **off-chain** before constructing immutable parameters; double-check chain and address.
5. Professional external smart-contract security review before Mainnet ETH, particularly important for 1 ETH and 10 ETH denominations.
