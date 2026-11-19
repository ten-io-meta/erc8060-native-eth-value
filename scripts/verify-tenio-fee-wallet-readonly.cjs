"use strict";

// Read-only wallet/address corroboration. No private keys, signatures,
// deployments, eth_sendTransaction, or ERC-8060 state mutations.
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const WALLET = "0x75DA787FDA32092079dbe113c5c9DBC22CBBC455";
const HISTORICAL_DEPLOYMENTS = [
  {
    chainId: 1,
    name: "Ethereum Mainnet",
    oldContract: "0x7c88fabe05fd373d56a728f9896f87ede10db789",
    providers: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"]
  },
  {
    chainId: 11155111,
    name: "Sepolia",
    oldContract: "0xD360714b72796dC812A0c177B9Be45022D1f3f5B",
    providers: [
      "https://ethereum-sepolia-rpc.publicnode.com",
      "https://sepolia.gateway.tenderly.co",
      "https://ethereum-sepolia.blockpi.network/v1/rpc/public",
      "https://1rpc.io/sepolia"
    ]
  }
];

let id = 0;
async function rpc(url, method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      signal: controller.signal
    });
    if (!r.ok) throw Error("HTTP " + r.status);
    const x = await r.json();
    if (x.error) throw Error("RPC " + x.error.code + " " + x.error.message);
    return x.result;
  } finally {
    clearTimeout(timer);
  }
}

const ownerSelector = ethers.utils.id("owner()").slice(0, 10);
const report = {
  generatedAt: new Date().toISOString(),
  intendedFeeRecipient: ethers.utils.getAddress(WALLET),
  caveat: "An EOA / historical contract owner does not prove present-day private-key control.",
  networks: []
};

(async () => {
  let checked = true;

  for (const chain of HISTORICAL_DEPLOYMENTS) {
    const observations = [];
    const rawHeads = [];
    for (const provider of chain.providers) {
      try {
        const chainId = Number(BigInt(await rpc(provider, "eth_chainId", [])));
        if (chainId !== chain.chainId) throw Error("wrong network " + chainId);
        const height = Number(BigInt(await rpc(provider, "eth_blockNumber", [])));
        rawHeads.push({ provider, height });
      } catch (e) {
        observations.push({ provider, error: String(e).slice(0, 170) });
      }
    }

    if (rawHeads.length < 2) checked = false;
    const block = rawHeads.length
      ? Math.min(...rawHeads.map(x => x.height)) - 3
      : null;

    for (const { provider, height } of rawHeads) {
      async function observeAt(tag, exactBlock) {
        const [code, nonce, rawOwner] = await Promise.all([
          rpc(provider, "eth_getCode", [WALLET, tag]),
          rpc(provider, "eth_getTransactionCount", [WALLET, tag]),
          rpc(provider, "eth_call", [{ to: chain.oldContract, data: ownerSelector }, tag])
        ]);
        if (!rawOwner || rawOwner.length !== 66) throw Error("Malformed owner() return");
        const decoded = ethers.utils.getAddress("0x" + rawOwner.slice(-40));
        return {
          provider,
          block: exactBlock ? block : height,
          blockTag: tag,
          blockPinned: exactBlock,
          feeRecipientAddress: ethers.utils.getAddress(WALLET),
          walletCodeBytes: code.length > 2 ? (code.length - 2) / 2 : 0,
          walletNonce: Number(BigInt(nonce)),
          historicalContract: chain.oldContract,
          historicalOwner: decoded,
          matchesHistoricalOwner: decoded.toLowerCase() === WALLET.toLowerCase()
        };
      }
      try {
        observations.push(await observeAt("0x" + block.toString(16), true));
      } catch (e) {
        // Some public Sepolia RPCs return "header not found" for an otherwise
        // recent pinned block, even while serving the current head.
        // Preserve the lower-quality latest-tag evidence explicitly.
        try {
          const latest = await observeAt("latest", false);
          latest.pinnedFailure = String(e).slice(0, 150);
          observations.push(latest);
        } catch (fallbackError) {
          observations.push({
            provider, block,
            pinnedError: String(e).slice(0, 150),
            latestError: String(fallbackError).slice(0, 150)
          });
          // A provider outage is an inconclusive provider, not contradictory
          // evidence. Two other independent successes may still be enough.
        }
      }
    }

    const ok = observations.filter(x => x.historicalOwner);
    if (ok.length < 2) checked = false;
    const identityAgree = ok.length >= 2 &&
      ok.every(x => x.historicalOwner === ok[0].historicalOwner &&
                    x.walletCodeBytes === ok[0].walletCodeBytes);
    const pinned = ok.filter(x => x.blockPinned);
    const bothPinned = pinned.length >= 2;
    const sameBlockNonceAgree = !bothPinned ||
      pinned.every(x => x.walletNonce === pinned[0].walletNonce);
    if (!identityAgree || !sameBlockNonceAgree) checked = false;

    const entry = {
      chain: chain.name, chainId: chain.chainId,
      block, observations,
      dualProviderIdentityAgreement: identityAgree,
      samePinnedBlock: bothPinned,
      fallbackLatestUsed: ok.some(x => !x.blockPinned),
      sameBlockNonceAgree
    };
    report.networks.push(entry);
    console.log("WALLET_OBSERVATION " + JSON.stringify(entry));
  }

  report.success = checked &&
    report.networks.every(x =>
      x.dualProviderIdentityAgreement &&
      x.observations.filter(o => o.historicalOwner).every(o => o.matchesHistoricalOwner)
    );

  fs.mkdirSync("audit-results", { recursive: true });
  const output = path.join("audit-results", "tenio-fee-wallet-readonly.json");
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log("WALLET_AUDIT_SUMMARY " + JSON.stringify({
    feeRecipient: report.intendedFeeRecipient,
    dualProviderHistoricalOwnerMatch: report.success,
    fallbackLatestUsed: report.networks.some(x => x.fallbackLatestUsed),
    caveat: report.caveat,
    artifact: output
  }));
  if (!report.success) process.exitCode = 1;
})().catch(e => {
  console.error("WALLET_AUDIT_FATAL " + e.message);
  process.exitCode = 1;
});
