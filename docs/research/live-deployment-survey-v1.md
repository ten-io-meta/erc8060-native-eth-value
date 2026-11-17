# ERC-8060 deployment verification — reproducible read-only survey (research)

This is an **evidence collection tool**, not a contract security audit and not a deploy/transaction script. It does not send `eth_sendRawTransaction`, unlock wallets, use keys or alter any state.

## Targets and claimed source

| Target | Chain | Address | Initial source to corroborate |
|---|---|---|---|
| TEN.IO Origin | Ethereum mainnet | `0x8Cfc6b16B01604c83bef1e315d6693d2e7dA43Ad` | `ten-io-meta/TENIO-Origin` README |
| TENIO Fragment | Ethereum mainnet | `0x7c88fabe05fd373d56a728f9896f87ede10db789` | `ten-io-meta/TENIO-Fragment` README |
| TENIO Fragment | Sepolia | `0xD360714b72796dC812A0c177B9Be45022D1f3f5B` | `ten-io-meta/TENIO-Fragment` README |
| Shapes | Ethereum mainnet | `0x6fe9193276bf7abcbee44ab7afd717d637d6faf0` | `https://shapes.ripe.wtf/docs/deployments` |

## What is queried

All claims are gathered using read-only JSON-RPC methods at a **fixed block**, using up to two independent public endpoints on each network. Evidence includes:
- Chain ID and selected exact block hash;
- `eth_getCode`, keccak256 runtime hash, byte length and `eth_getBalance`;
- EIP-1967 implementation storage slot (a nonzero value may indicate a proxy; zero is not proof of immutability);
- `supportsInterface(0x01ffc9a7)`, `supportsInterface(0x80ac58cd)`, `supportsInterface(0x5b5e139f)`, `supportsInterface(0x88495fe7)` (strict `valueOf + burn`), `supportsInterface(0xcadf338f)` (historical `valueOf` subset) and invalid ERC165 `0xffffffff`;
- `ownerOf(0/1)`, `valueOf(0/1)`, plus optional accounting views if supported.

`eth_call` **does not execute a transaction**. An empty or reverted `valueOf(1)` does **not** prove the function is missing: the token may not exist. Equally, a reported ERC-165 `true` is a declaration, not proof of honest ETH-backed payments. We do not invoke state-changing `burn()` even in simulations because authorization, token availability and sender contract semantics need separate study.

A public RPC reply is not the same as an independently verified execution-layer proof. Agreement between two independent providers improves detection of endpoint errors; it does not replace independently verifying block headers, creation transactions, compiler metadata, source or settlement behavior. If one endpoint is down or disagrees, the audit is marked **incomplete** rather than reporting success. Partial evidence is preserved.

## Commands / evidence

```bash
npm ci
node scripts/audit-live-deployments.cjs
```

GitHub Action: **Read-only deployed ERC-8060 interface survey**.

The JSON report `audit-results/live-deployment-survey.json` is uploaded as a workflow artifact; it records network, endpoint, block hash, output and errors. The `DEPLOYMENT_RESULT` lines in the workflow logs summarize each target.

## Interpretation matrix

- **Strict ID yes, legacy yes**: claimed support for the full strict interface (still authenticate source and economic backing).
- **Strict no, legacy yes**: historical read-only surface; `burn` and solvency **not established** by ERC-165.
- **Strict no, legacy no, ERC165 yes**: ERC-721 or another profile, **not discoverable** as strict `IERC721Value`.
- **ERC165 unsupported / unreliable**: cannot infer ERC-8060 compliance from this method. An old contract can implement `burn` through a proprietary ABI and still lack ERC-165 support.
- **No runtime code**: target address not a deployed contract at the examined block.
- **RPC divergence / data unavailable**: no definitive classification.

This survey is intentionally kept in an isolated **draft research PR**, independent of the separate ABI migration PR #1.
