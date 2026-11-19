# ERC-8060 — adminless creator-fee candidate

**STATUS: RESEARCH / NO REAL FUNDS.** This is a separately named experimental reference. The strict ERC-8060 **draft ABI stays two functions**, `valueOf(uint256)` and `burn(uint256)`. This example adds implementation-level fee accounting; it does **not** add any normative ERC-8060 requirement.

## First: where is the fee wallet?

- Original `ERC8060Reference.sol` (including PR #1) has `Ownable.owner()` and `withdrawSurplus()`, but **no distinct hardcoded fee wallet**. The initial owner is the deployer.
- The other strict test reference `ERC8060NativeETHReference.sol` in Reservable has **no fee wallet and no fee function**.
- The historical TENIO Fragment deployments expose an administrator address `0x75DA787FDA32092079dbe113c5c9DBC22CBBC455` in prior chain snapshots. This identifies an onchain owner, **not** an approved creator fee destination for the new contract; do not substitute it automatically.
- This new candidate defines `address payable public immutable feeRecipient`, fixed as constructor input **for each deployment separately**. It is intentionally NOT prefilled with any user wallet.

Example **local-only** Hardhat deployment in your own fork:

```js
const [deployer] = await ethers.getSigners();
const recipient = "PUT_YOUR_CHECKED_WALLET_ADDRESS_HERE";
const Factory = await ethers.getContractFactory("ERC8060CreatorFeeReference");
// Replace the placeholder with an actual, independently checked EVM address.
const instance = await Factory.deploy(recipient);
await instance.deployed();
console.log("Fee recipient:", await instance.feeRecipient());
```

Anyone can fork the MIT source and deploy their own instance with **their own fee recipient**. The wallet is locked *within that deployed instance*, not locked globally across forks.

**A contract cannot prove that you control an arbitrary address:** a nonzero address may still have lost keys, a mismatched chain, a smart contract that rejects ETH, or an unintended signer. Independently confirm wallet control, chain, exact address and ability to receive ETH before any real deployment. A multisig can reduce key-loss risk but creates its own signers/governance. Choosing an immutable recipient sacrifices later rotation if its key is compromised or lost.

## Mint economics — fixed example only

| Incoming mint ETH | Credited to token | Earned creator fee |
|---:|---:|---:|
| 0.12 ETH | 0.10 ETH | 0.02 ETH |

`totalRedeemableValue` is outstanding liabilities owed to living NFTs. `feesAccrued` is the portion **earned from actual mints only**. Each successful mint must preserve both ledgers in the vault:

```text
actual ETH balance >= totalRedeemableValue + feesAccrued
```

`collectFees()` is permissionless **to trigger** but sends exactly `feesAccrued` to the immutable `feeRecipient` alone. A reverted or rejecting payout restores fee credit atomically. Mint, burn and collection are all nonReentrant, and actual redemption must pay exactly 0.10 ETH or revert the whole burn.

Direct, unsolicited plain ETH transfers revert; ETH can still be forced onto an EVM address by other mechanisms. `unallocatedETH()` reveals any forced/unassigned ETH, which is **not** counted as creator fees and cannot be swept through an administrative backdoor. This intentionally prevents ownership ambiguity, but forced/accidental funds may be **permanently inaccessible**.

## No-admin policy and scope

The new `ERC8060CreatorFeeReference` deliberately has no `Ownable`, external beneficiary setter, configurable fee, delegated withdrawal, upgrade, delegatecall or NFT-backing sweep. The creator is only a designated **payee of minted fees**, not an operator who can change live NFT economic rights.

This is **not** an NFT-scarcity guarantee. The contract still permits unlimited ETH-backed mints; a finite supply would need an independent, immutable hard cap and irreversible closure policy. ERC-8098's non-increasing-supply invariant applies to ERC-20, not automatically to ERC-721.

The main original strict reference remains unmodified, as does the deployed historical Fragment. This experimental candidate must pass separate adversarial CI and independent security review before live assets or deployment. If ERC-8060 is later deployed as a production primitive, publish a single audited canonical implementation with exact constructor inputs and verified deployed bytecode.

## Known tradeoffs

- A malicious or permanently rejecting `feeRecipient` can leave fees inaccessible forever. It does **not** grant rights to the NFT backing.
- A fee-recipient compromise redirects **future earned fees**, not escrowed NFT liabilities, because the recipient is pinned at deployment.
- Smart-contract holders who reject ETH can temporarily be unable to burn; failed payouts leave the NFT and its obligation intact.
- `isSolvent()` is a self-reported getter, not an independent proof that a third-party deployment is honest.
- Forked code is not the same contract: a fork can freely edit/remove any source checks **before deployment**. Only the verified code/address of each *specific* immutable deployment can be trusted.

**Security review status:** new tests cover permitted fee collection, two independent fee recipients, rejection/rollback, callback reentrancy and a fault-injected deficit. They do not constitute external audits, formal verification or proof of general integration safety.
