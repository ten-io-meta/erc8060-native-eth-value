// Read-only ERC-8060 deployed-contract investigation (NO transaction signing).
// Run with: node scripts/audit-live-deployments.cjs
// Uses public Ethereum/Sepolia JSON-RPC providers; never transmits any key.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const targets = [
  { id: "tenio-origin", chainId: 1, network: "Ethereum mainnet", address: "0x8Cfc6b16B01604c83bef1e315d6693d2e7dA43Ad" },
  { id: "tenio-fragment", chainId: 1, network: "Ethereum mainnet", address: "0x7c88fabe05fd373d56a728f9896f87ede10db789" },
  { id: "shapes", chainId: 1, network: "Ethereum mainnet", address: "0x6fe9193276bf7abcbee44ab7afd717d637d6faf0" },
  { id: "tenio-fragment-sepolia", chainId: 11155111, network: "Ethereum Sepolia", address: "0xD360714b72796dC812A0c177B9Be45022D1f3f5B" }
];

const providers = {
  1: [
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com",
    "https://eth.drpc.org",
    "https://1rpc.io/eth",
    "https://rpc.mevblocker.io"
  ],
  11155111: [
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://sepolia.drpc.org",
    "https://rpc.sepolia.org",
    "https://1rpc.io/sepolia"
  ]
};

const erc165Ids = {
  ERC165: "0x01ffc9a7",
  ERC721: "0x80ac58cd",
  ERC721Metadata: "0x5b5e139f",
  IERC721ValueStrict: "0x88495fe7",
  IERC721ValueLegacyQuery: "0xcadf338f",
  InvalidERC165: "0xffffffff"
};

const abi = new ethers.utils.Interface([
  "function supportsInterface(bytes4) view returns (bool)",
  "function ownerOf(uint256) view returns (address)",
  "function valueOf(uint256) view returns (uint256)",
  "function totalRedeemableValue() view returns (uint256)",
  "function totalBacked() view returns (uint256)",
  "function redeemableBacking() view returns (uint256)",
  "function pendingFees() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function nextTokenId() view returns (uint256)",
  "function isSolvent() view returns (bool)"
]);
const eip1967ImplementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

let requestId = 0;
async function rpc(url, method, params, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const result = await response.json();
    if (result.error) throw new Error("RPC " + result.error.code + " " + String(result.error.message).slice(0, 90));
    if (!Object.prototype.hasOwnProperty.call(result, "result"))
      throw new Error("No JSON-RPC result");
    return result.result;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeError(e) {
  return String(e && e.message || e).slice(0, 155);
}

async function discover(chainId) {
  const found = [];
  for (const url of providers[chainId]) {
    try {
      const id = parseInt(await rpc(url, "eth_chainId", []), 16);
      if (id !== chainId) throw new Error("Wrong chain " + id);
      const height = parseInt(await rpc(url, "eth_blockNumber", []), 16);
      if (!Number.isSafeInteger(height) || height < 1) throw new Error("Invalid head");
      found.push({ url, height });
      console.log("RPC_OK " + chainId + " " + url + " block=" + height);
      if (found.length >= 2) break;
    } catch (e) {
      console.log("RPC_UNAVAILABLE " + chainId + " " + url + " " + normalizeError(e));
    }
  }
  return found;
}

async function callView(url, address, sig, args, blockTag) {
  const tx = { to: address, data: abi.encodeFunctionData(sig, args) };
  try {
    const bytes = await rpc(url, "eth_call", [tx, blockTag]);
    if (typeof bytes !== "string" || bytes.length < 66)
      return { status: "missing-or-empty-return", bytes: String(bytes).slice(0, 34) };
    const decoded = abi.decodeFunctionResult(sig, bytes);
    const value = decoded[0];
    return { status: "ok", value: (typeof value === "boolean") ? value : value.toString() };
  } catch (e) {
    return { status: "reverted-or-unsupported", error: normalizeError(e) };
  }
}

async function inspect(url, target, blockTag) {
  const { address } = target;
  const code = await rpc(url, "eth_getCode", [address, blockTag]);
  const wei = await rpc(url, "eth_getBalance", [address, blockTag]);
  const implementationStorage = await rpc(url, "eth_getStorageAt", [address, eip1967ImplementationSlot, blockTag])
    .catch(e => ({ error: normalizeError(e) }));

  const result = {
    address,
    codePresent: typeof code === "string" && code.length > 2,
    runtimeBytes: typeof code === "string" ? (code.length - 2) / 2 : null,
    codeHash: typeof code === "string" && code.length > 2 ? ethers.utils.keccak256(code) : null,
    balanceWei: BigInt(wei).toString(),
    eip1967ImplementationStorage: implementationStorage,
    supportsInterface: {},
    reads: {}
  };

  if (!result.codePresent) return result;

  for (const [name, id] of Object.entries(erc165Ids))
    result.supportsInterface[name] = await callView(url, address, "supportsInterface(bytes4)", [id], blockTag);

  const reads = [
    ["ownerOf0", "ownerOf(uint256)", [0]],
    ["ownerOf1", "ownerOf(uint256)", [1]],
    ["valueOf0", "valueOf(uint256)", [0]],
    ["valueOf1", "valueOf(uint256)", [1]],
    ["totalRedeemableValue", "totalRedeemableValue()", []],
    ["totalBacked", "totalBacked()", []],
    ["redeemableBacking", "redeemableBacking()", []],
    ["pendingFees", "pendingFees()", []],
    ["totalSupply", "totalSupply()", []],
    ["nextTokenId", "nextTokenId()", []],
    ["isSolvent", "isSolvent()", []]
  ];

  // Read-only eth_call requests, pinned to the same historical block.
  for (const [name, signature, args] of reads)
    result.reads[name] = await callView(url, address, signature, args, blockTag);

  return result;
}

function compareSnapshots(a, b) {
  // Compare values, including missing/reverts, to identify RPC disagreements.
  const keys = ["codePresent", "runtimeBytes", "codeHash", "balanceWei", "eip1967ImplementationStorage",
                "supportsInterface", "reads"];
  return keys.filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

(async () => {
  const generated = { type: "OECL_READ_ONLY_ERC8060_DEPLOYMENT_SURVEY_V1",
    generatedAt: new Date().toISOString(), methods: ["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber",
      "eth_getCode", "eth_getBalance", "eth_getStorageAt", "eth_call"], targets: [], networks: {} };

  let incomplete = false;

  for (const chainId of [1, 11155111]) {
    const nodes = await discover(chainId);
    generated.networks[chainId] = { providers: nodes.map(x => x.url) };
    if (nodes.length === 0) {
      incomplete = true;
      for (const target of targets.filter(x => x.chainId === chainId))
        generated.targets.push({ ...target, status: "NETWORK_UNAVAILABLE" });
      continue;
    }
    const block = Math.max(1, Math.min(...nodes.map(n => n.height)) - 3);
    const blockTag = "0x" + block.toString(16);
    generated.networks[chainId].block = block;
    generated.networks[chainId].blockTag = blockTag;

    const attest = [];
    for (const node of nodes) {
      try {
        const header = await rpc(node.url, "eth_getBlockByNumber", [blockTag, false]);
        attest.push({ endpoint: node.url, blockHash: header && header.hash });
      } catch (e) {
        attest.push({ endpoint: node.url, error: normalizeError(e) });
        incomplete = true;
      }
    }
    generated.networks[chainId].blockAttestations = attest;
    if (attest.length === 2 && attest[0].blockHash !== attest[1].blockHash)
      incomplete = true;

    for (const target of targets.filter(x => x.chainId === chainId)) {
      const probes = [];
      for (const node of nodes) {
        try {
          probes.push({ endpoint: node.url, snapshot: await inspect(node.url, target, blockTag) });
        } catch (e) {
          probes.push({ endpoint: node.url, error: normalizeError(e) });
          incomplete = true;
        }
      }
      const good = probes.filter(x => x.snapshot);
      const differingFields = good.length === 2 ? compareSnapshots(good[0].snapshot, good[1].snapshot) : [];
      const status = good.length === 0 ? "NOT_VERIFIED" :
        (good.length < 2 ? "SINGLE_RPC_ONLY" :
          (differingFields.length ? "RPC_DISAGREEMENT" : "TWO_RPCS_AGREE"));
      if (status !== "TWO_RPCS_AGREE") incomplete = true;

      const output = { ...target, block, blockHash: attest[0] && attest[0].blockHash,
        status, differingFields, probes };
      generated.targets.push(output);
      console.log("DEPLOYMENT_RESULT " + JSON.stringify({
        id: target.id, chainId, block, status, differingFields,
        data: good[0] && good[0].snapshot
      }));
    }
  }

  const out = path.join("audit-results", "live-deployment-survey.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(generated, null, 2) + "\n");
  console.log("REPORT_PATH " + out);
  console.log("AUDIT_COMPLETE " + JSON.stringify({
    targets: generated.targets.length,
    consensus: generated.targets.filter(x => x.status === "TWO_RPCS_AGREE").length,
    unresolved: generated.targets.filter(x => x.status !== "TWO_RPCS_AGREE").length
  }));

  // Fail closed: a network outage or disagreement is not a successful audit.
  if (incomplete) process.exitCode = 1;
})().catch(e => {
  console.error("AUDIT_FATAL " + normalizeError(e));
  process.exitCode = 1;
});
