# ERC-8060: generic ownerless native-ETH reference

This is a **research implementation of the ERC-8060 draft interface**, not the ERC itself, not an independently audited product and not an authorization to receive real-user funds. No commercial collection, fee scheme, recipient wallet, minting limit or art metadata is normative.

## Normative interface vs example mint strategy

The draft ERC-8060 interface consists of only:

```solidity
interface IERC721Value {
    function valueOf(uint256 tokenId) external view returns (uint256);
    function burn(uint256 tokenId) external;
}
```

ERC-165 STRICT ID: `0x88495fe7`; read-only legacy ID: `0xcadf338f` (never use alone to claim burn rights) (the XOR of the two selectors).

`contracts/ERC8060Reference.sol` implements this strict interface with a deliberately simple **fully backed native ETH vault**:

- Anyone may call `mint()` with any **positive** amount of ETH; a new unique ERC-721 is backed by exactly that amount. The `mint` method is an example implementation detail, **not part of ERC-8060**.
- `valueOf(tokenId)` returns the per-token locked ETH; nonexistent token IDs revert.
- Only the current NFT owner may call `burn(tokenId)`. The implementation removes exactly that token's liability, destroys its token and pays its ETH. If the ETH recipient refuses payment, **everything rolls back**, including burn and liability.
- The contract has **no owner, fee recipient, withdrawal of surplus, proxy, upgrade function, privileged issuance or metadata setter**. The constructor only accepts generic ERC-721 name/symbol.
- Tokens are sequential and their numeric IDs are never reissued; **there is no overall mint cap**. Therefore it does not claim ERC-8098 supply behavior, and creating a finite collection is strictly application policy.
- Ordinary unsolicited ETH transfers revert; unusual forced ETH transfers can leave unallocated, permanently inaccessible ETH. This is an explicit tradeoff of no-administrator design.

## Safety invariants of the example

At every reachable onchain state:

1. `address(this).balance >= totalRedeemableValue`, ignoring unusual forced donations as surplus.
2. `totalRedeemableValue == sum(valueOf(id) for each live token)`.
3. Only the current owner can burn; token approvals alone grant no burn power.
4. Successful burn sends precisely the reported value once; failed burn preserves both token ownership and liability.
5. All mint/burn interactions are non-reentrant. The safe-mint ERC721Receiver callback cannot initiate a nested mint or burn.

These are **design requirements and tested behaviors**, not independently proven mathematical theorems for all possible executions. Review the exact code/bytecode, constructor inputs and deployment provenance before trusting external contracts that claim the same ERC-165 ID.

## ERC-165 identity and payout-failure limitations

The officially merged **Draft** in `ethereum/ERCs/ERCS/erc-8060.md`
defines **both** `valueOf(uint256)` and `burn(uint256)` in `IERC721Value`.
The canonical strict interface ID is the XOR of the two selectors:
`0x88495fe7`. The historical **value-only** ID `0xcadf338f`
is a separate, optional discovery signal. A contract exposing only
the value-only ID is **not** strict ERC-8060, and advertising the strict
ID is not independent proof of implementation correctness, backing,
source provenance, or successful future redemption.

A smart-contract NFT owner may implement ERC721 receiving correctly
but revert whenever ETH is sent to it. In this example, `burn(tokenId)`
then reverts **atomically**: the NFT remains owned by the contract,
`valueOf(tokenId)` and `totalRedeemableValue` remain unchanged,
and the actual ETH backing stays in the NFT contract. This preserves
the obligation; it does **not** make the obligation immediately
exercisable by that particular owner.

If the owning contract explicitly provides an authorized NFT
transfer method, it may move the token to an ETH-capable recipient,
who can then invoke burn. **ERC-8060 does not promise such recovery**:
a contract without a safe token-transfer or redemption-receipt path
may leave its NFT and ETH value indefinitely inaccessible. Wallets
and marketplaces MUST NOT interpret `supportsInterface` alone as
proof that a contract owner can actually receive the ETH payout.

A dedicated local EVM regression covers rejected payout, complete
rollback, owner-only recovery transfer when available, and eventual
redemption from a recipient that can accept ETH. The test actor's
recovery method is deliberately **not** part of the ERC-8060 ABI.

## Reservation/conditional-profile boundary

Strict ERC-8060 `valueOf(tokenId)` is the ETH claim payable through
its owner-only atomic `burn(tokenId)`, not an estimated collateral
balance or an off-chain indication of potentially available value.
A separate reservation implementation may maintain
`totalValue(tokenId,asset)`, `lockedValue(tokenId,asset)`, and
`availableValue(tokenId,asset)`; these are optional, asset-qualified
accounting quantities and **not** the strict `IERC721Value` ABI.
If an active reservation prevents the full specified burn payout,
the implementation must not claim unconditional strict ERC-8060
redemption merely by advertising `0x88495fe7`.

No currently mandated ERC-165 interface ID automatically attests
to the reservation-conditioned profile, its complete redemption
semantics, its actual payment capability, or the safety of its
deployment. Integrators need separately verified profile disclosure,
source/deployment provenance, fresh chain-state reads, and
execution-time checks. If any of these are missing, **unknown** is
more accurate than claiming unrestricted redeemability.

## What is explicitly OUTSIDE ERC-8060

Collection prices, mint fees, revenue destinations, immutable art metadata, named commercial tiers, max issuance, whitelists, game economies, ERC-8098 ERC-20 scarcity profiles, and Reservable conditional claims are external **applications or optional integrations**. In particular:
- ERC-8098 defines monotonic **ERC-20** supply and does not automatically constrain ERC-721 mint issuance.
- Reservable's conditional ETH reservations can block full redemption and therefore cannot be misrepresented as strict ERC-8060 if they alter its burn guarantee.
- OECL can study provenance and execute specific evidence checks, but an OECL assessment receipt cannot certify arbitrary economic safety.

A complete standalone product application with fees/caps belongs in its own product repository. TEN.IO product experiments have been moved to [TEN.IO's isolated application draft PR](https://github.com/ten-io-meta/TEN-IO/pull/1).

## Test

```bash
pnpm install --frozen-lockfile
pnpm compile
pnpm test
```

The suite deliberately tests ETH conservation, owner access, ERC-165, transfer, double burn, rejecting ETH wallet, reentrant `_safeMint` callback, reentrant redemption callback, fake insolvency with local-only fault injection and the absence of privileged functions.

**Historical behavior and compatibility:** Prior draft PR #1 implemented strict ERC-165 and an optional read-only discovery ID but used `Ownable` and a fixed-price surplus model. The consolidated `ERC8060Reference.sol` keeps the two-function strict ABI and optional separate legacy read-only detection while dropping all owner, fee and surplus privileges. Earlier tests and code remain in PR #1 and Git history, not the canonical reference.
