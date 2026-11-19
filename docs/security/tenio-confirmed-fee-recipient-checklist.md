# TEN.IO confirmed beneficiary: predeployment security gate

**Confirmed by intended beneficiary in conversation:** `0x75DA787FDA32092079dbe113c5c9DBC22CBBC455`.

## Where it is configured

No wallet is embedded in the Solidity implementation. The immutable constructor input selects the beneficiary for **a particular deployment**:

```js
const TENIO_FEE_RECIPIENT = "0x75DA787FDA32092079dbe113c5c9DBC22CBBC455";
const Factory = await ethers.getContractFactory("ERC8060CreatorFeeReference");
const contract = await Factory.deploy(TENIO_FEE_RECIPIENT);
await contract.deployed();
if ((await contract.feeRecipient()).toLowerCase() !== TENIO_FEE_RECIPIENT.toLowerCase()) {
  throw new Error("Wrong beneficiary");
}
```

**This snippet is configuration illustration only, NOT a deploy recommendation.** No production transaction has been made. A fork may pass a different recipient to its own copy. Neither instance can change its initial immutable value later.

The historical `TENIOFragment.owner()` may match the proposed address. The separate read-only wallet workflow checks chain-specific `owner()`, address bytecode, and transaction nonce from two public RPC providers and records exact blocks. This **cannot prove** custody of today's private key, ability to sign a transaction, or ability to accept ETH under future conditions. To verify human control before a real deployment, request a voluntary, chain/domain/nonce-bound message signature generated locally in the user's wallet; never ask for a seed or private key, and do not claim signature verification has already occurred.

## Concrete local economic tests

`test/ERC8060TENIORecipientConfiguration.test.js` deploys a **local test copy** with the exact confirmed address, no real ETH and no user transaction. Tests verify:

1. Constructor freezes the exact recipient; no owner/recipient setter/upgrade/admin sweep signatures and strict ERC-165 detection.
2. Two minted NFTs allocate **0.20 ETH of protected backing** and **0.04 ETH earned fees**. A third party triggers collection, the exact confirmed recipient gets **0.04 ETH** and the third party cannot divert it (apart from paying their own execution gas).
3. Both owners can subsequently burn for exactly **0.10 ETH each** and fee collection cannot affect either claim.
4. Burn before fee collection still leaves the earned fee collectible.
5. Another independently deployed fork selects a different address; it cannot change TEN.IO's deployed fee recipient.
6. Artificial backing shortfall in Hardhat halts both burn and fee collection and preserves owner/claim/fee accounting; this is a fault injection, **not** evidence that a public attacker can change the real chain's contract balance.

Previous 14 targeted tests additionally cover rejecting recipients, rollback and reentrancy, callback minting and normal direct-ETH transfer rejection.

The fixed **0.12 / 0.10 / 0.02 ETH** model is just an example implementation; it is not mandated by the ERC-8060 two-function draft.

## Remaining gates, explicitly NOT complete

- Exact address has been confirmed by user, but control of private key has NOT been cryptographically proven.
- Contract code is not independently audited. Foundry stateful invariants, source/binary verification, external reviewer, and final deployment chain choice are still required for real funds.
- No max supply in this reference; sale terms and irreversible issuance policy must be decided separately.
- No live deployment and no ETH movement; PR remains draft. An old contract is **not** upgraded merely by adding this code.
