const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ERC8060ImmutableCollection — no-admin fixed-fee collections", function () {
  const eth = ethers.utils.parseEther;
  const BACKING = eth("0.010");
  const FEE = eth("0.002");
  const URI = "ipfs://bafy-test-content-addressed-folder/";
  const CAP = 3;

  let deployer, alice, bob, feeWallet, attacker, factory, nft;

  async function revert(promise) {
    let didRevert = false;
    try {
      const result = await promise;
      if (result && result.wait) await result.wait();
    } catch (err) {
      didRevert = true;
    }
    expect(didRevert).to.equal(true);
  }

  async function deploy(
    backing = BACKING,
    fee = FEE,
    cap = CAP,
    recipient = feeWallet.address,
    metadata = URI
  ) {
    const c = await factory.deploy(
      "TEN.IO Umbral",
      "UMBR",
      metadata,
      backing,
      fee,
      cap,
      recipient
    );
    await c.deployed();
    return c;
  }

  async function mintFrom(signer, contract = nft) {
    return contract.connect(signer).mint({ value: await contract.mintPrice() });
  }

  async function backingOf(id, contract = nft) {
    return contract["valueOf(uint256)"](id);
  }

  beforeEach(async function () {
    [deployer, alice, bob, feeWallet, attacker] = await ethers.getSigners();
    factory = await ethers.getContractFactory("ERC8060ImmutableCollection");
    nft = await deploy();
  });

  it("fixes Umbral price: 0.010 backing + 0.002 fee = 0.012 ETH", async function () {
    expect((await nft.backingPerToken()).eq(BACKING)).to.equal(true);
    expect((await nft.mintFee()).eq(FEE)).to.equal(true);
    expect((await nft.mintPrice()).eq(eth("0.012"))).to.equal(true);
    expect(await nft.feeRecipient()).to.equal(feeWallet.address);
    expect((await nft.maxMinted()).eq(CAP)).to.equal(true);
  });

  it("mints exact amount, pays ONLY fee to recipient, and retains entire backing", async function () {
    const feeBefore = await ethers.provider.getBalance(feeWallet.address);
    await mintFrom(alice);
    const feeAfter = await ethers.provider.getBalance(feeWallet.address);
    expect(feeAfter.sub(feeBefore).eq(FEE)).to.equal(true);
    expect((await ethers.provider.getBalance(nft.address)).eq(BACKING)).to.equal(true);
    expect((await nft.totalRedeemableValue()).eq(BACKING)).to.equal(true);
    expect((await nft.liveSupply()).eq(1)).to.equal(true);
    expect(await nft.ownerOf(1)).to.equal(alice.address);
    expect((await backingOf(1)).eq(BACKING)).to.equal(true);
  });

  it("rejects an underpayment and overpayment without changing state or balance", async function () {
    await revert(nft.connect(alice).mint({ value: eth("0.011") }));
    await revert(nft.connect(alice).mint({ value: eth("0.013") }));
    expect((await nft.totalMinted()).eq(0)).to.equal(true);
    expect((await nft.totalRedeemableValue()).eq(0)).to.equal(true);
    expect((await ethers.provider.getBalance(nft.address)).eq(0)).to.equal(true);
  });

  it("makes a 0.10 backing + 0.02 fee collection independently, without code changes", async function () {
    const higher = await deploy(eth("0.10"), eth("0.02"), 2);
    const before = await ethers.provider.getBalance(feeWallet.address);
    await mintFrom(alice, higher);
    expect((await higher.mintPrice()).eq(eth("0.12"))).to.equal(true);
    expect((await backingOf(1, higher)).eq(eth("0.10"))).to.equal(true);
    expect((await ethers.provider.getBalance(higher.address)).eq(eth("0.10"))).to.equal(true);
    expect((await ethers.provider.getBalance(feeWallet.address)).sub(before).eq(eth("0.02"))).to.equal(true);
  });

  it("supports future 1 ETH and 10 ETH backing with fees fixed per deployment", async function () {
    for (const [backing, fee] of [["1", "0.02"], ["10", "0.1"]]) {
      const higher = await deploy(eth(backing), eth(fee), 1);
      await mintFrom(alice, higher);
      expect((await backingOf(1, higher)).eq(eth(backing))).to.equal(true);
      expect((await ethers.provider.getBalance(higher.address)).eq(eth(backing))).to.equal(true);
    }
  });

  it("only current token owner can burn, including when an operator is ERC721-approved", async function () {
    await mintFrom(alice);
    await nft.connect(alice).approve(attacker.address, 1);
    await revert(nft.connect(attacker).burn(1));
    await revert(nft.connect(feeWallet).burn(1));
    expect(await nft.ownerOf(1)).to.equal(alice.address);
  });

  it("redeems exact backing on owner burn without taking back fees", async function () {
    await mintFrom(alice);
    const before = await ethers.provider.getBalance(nft.address);
    await nft.connect(alice).burn(1);
    expect(before.eq(BACKING)).to.equal(true);
    expect((await ethers.provider.getBalance(nft.address)).eq(0)).to.equal(true);
    expect((await nft.totalRedeemableValue()).eq(0)).to.equal(true);
    expect((await nft.liveSupply()).eq(0)).to.equal(true);
    expect((await nft.totalBurned()).eq(1)).to.equal(true);
    await revert(nft.ownerOf(1));
    await revert(backingOf(1));
    await revert(nft.connect(alice).burn(1));
  });

  it("preserves exact backing across transfer and allows only new owner to redeem", async function () {
    await mintFrom(alice);
    await nft.connect(alice).transferFrom(alice.address, bob.address, 1);
    expect((await backingOf(1)).eq(BACKING)).to.equal(true);
    await revert(nft.connect(alice).burn(1));
    await nft.connect(bob).burn(1);
    expect((await ethers.provider.getBalance(nft.address)).eq(0)).to.equal(true);
  });

  it("never reopens the irreversible cap after burns and never reuses IDs", async function () {
    await mintFrom(alice);
    await mintFrom(alice);
    await mintFrom(bob);
    await nft.connect(alice).burn(1);
    await nft.connect(alice).burn(2);
    expect((await nft.totalMinted()).eq(3)).to.equal(true);
    expect((await nft.totalBurned()).eq(2)).to.equal(true);
    expect((await nft.liveSupply()).eq(1)).to.equal(true);
    await revert(mintFrom(alice));
    expect(await nft.ownerOf(3)).to.equal(bob.address);
    expect((await nft.totalRedeemableValue()).eq(BACKING)).to.equal(true);
  });

  it("accounts for multiple tokens independently while fees are outside liabilities", async function () {
    await mintFrom(alice);
    await mintFrom(bob);
    expect((await ethers.provider.getBalance(nft.address)).eq(BACKING.mul(2))).to.equal(true);
    expect((await nft.totalRedeemableValue()).eq(BACKING.mul(2))).to.equal(true);
    await nft.connect(alice).burn(1);
    expect((await ethers.provider.getBalance(nft.address)).eq(BACKING)).to.equal(true);
    expect((await nft.totalRedeemableValue()).eq(BACKING)).to.equal(true);
    expect((await backingOf(2)).eq(BACKING)).to.equal(true);
  });

  it("rejects fee-recipient ETH transfer and rolls back NFT, backing and counters", async function () {
    const receiver = await (await ethers.getContractFactory("RejectFeeReceiver")).deploy();
    await receiver.deployed();
    const broken = await deploy(BACKING, FEE, CAP, receiver.address);
    await revert(mintFrom(alice, broken));
    expect((await broken.totalMinted()).eq(0)).to.equal(true);
    expect((await broken.totalRedeemableValue()).eq(0)).to.equal(true);
    expect((await ethers.provider.getBalance(broken.address)).eq(0)).to.equal(true);
    await revert(broken.ownerOf(1));
  });

  it("rejects receiver ETH payout and atomically preserves the NFT and its liability", async function () {
    const actor = await (await ethers.getContractFactory("RejectBurnReceiver")).deploy();
    await actor.deployed();
    await actor.connect(alice).mintAsContract(nft.address, { value: await nft.mintPrice() });
    expect(await nft.ownerOf(1)).to.equal(actor.address);
    await revert(actor.connect(alice).burnAsContract(nft.address, 1));
    expect(await nft.ownerOf(1)).to.equal(actor.address);
    expect((await nft.totalRedeemableValue()).eq(BACKING)).to.equal(true);
    expect((await nft.totalBurned()).eq(0)).to.equal(true);
    expect((await ethers.provider.getBalance(nft.address)).eq(BACKING)).to.equal(true);
  });

  it("blocks a reentrant mint from _safeMint while completing the first mint", async function () {
    const actor = await (await ethers.getContractFactory("ReenterMintReceiver")).deploy();
    await actor.deployed();
    await actor.connect(alice).fund({ value: await nft.mintPrice() });
    const before = await ethers.provider.getBalance(feeWallet.address);
    await actor.connect(alice).mintAsContract(nft.address, { value: await nft.mintPrice() });
    expect(await actor.tried()).to.equal(true);
    expect(await actor.blocked()).to.equal(true);
    expect((await nft.totalMinted()).eq(1)).to.equal(true);
    expect(await nft.ownerOf(1)).to.equal(actor.address);
    expect((await nft.totalRedeemableValue()).eq(BACKING)).to.equal(true);
    expect((await ethers.provider.getBalance(feeWallet.address)).sub(before).eq(FEE)).to.equal(true);
  });

  it("blocks callback redemption of another token while preserving both ETH accounts", async function () {
    const actor = await (await ethers.getContractFactory("ReenterBurnReceiver")).deploy();
    await actor.deployed();
    await actor.connect(alice).mintAsContract(nft.address, { value: await nft.mintPrice() });
    await actor.connect(alice).mintAsContract(nft.address, { value: await nft.mintPrice() });
    await actor.connect(alice).burnAsContract(1, 2);
    expect(await actor.tried()).to.equal(true);
    expect(await actor.blocked()).to.equal(true);
    expect(await nft.ownerOf(2)).to.equal(actor.address);
    await revert(nft.ownerOf(1));
    expect((await nft.totalRedeemableValue()).eq(BACKING)).to.equal(true);
    expect((await ethers.provider.getBalance(nft.address)).eq(BACKING)).to.equal(true);
  });

  it("advertises only the strict IERC721Value interface (plus ERC721/ERC165)", async function () {
    expect(await nft.supportsInterface("0x88495fe7")).to.equal(true);
    expect(await nft.supportsInterface("0xcadf338f")).to.equal(false);
    expect(await nft.supportsInterface("0x80ac58cd")).to.equal(true);
    expect(await nft.supportsInterface("0x01ffc9a7")).to.equal(true);
    expect(await nft.supportsInterface("0xffffffff")).to.equal(false);
  });

  it("fixes a content-addressed metadata base with deterministic, never-reused ids", async function () {
    await mintFrom(alice);
    expect(await nft.tokenURI(1)).to.equal(URI + "1");
    await nft.connect(alice).burn(1);
    await mintFrom(alice);
    expect(await nft.tokenURI(2)).to.equal(URI + "2");
    await revert(nft.tokenURI(1));
  });

  it("contains no withdrawal, admin, upgrade, URI setter or external mint privilege", async function () {
    const functions = Object.keys(nft.interface.functions);
    for (const forbidden of [
      "owner()", "withdraw()", "withdrawSurplus(uint256)", "setFeeRecipient(address)",
      "upgradeTo(address)", "setBaseURI(string)", "setTokenURI(uint256,string)"
    ]) {
      expect(functions.includes(forbidden)).to.equal(false);
    }
    await mintFrom(alice);
    expect((await ethers.provider.getBalance(nft.address)).eq(BACKING)).to.equal(true);
    // Direct ETH transfers reject; neither fee recipient nor attacker has vault rights.
    await revert(alice.sendTransaction({ to: nft.address, value: eth("0.10") }));
  });

  it("rejects invalid immutable deployment configuration", async function () {
    await revert(deploy(0, FEE, CAP));
    await revert(deploy(BACKING, FEE, 0));
    await revert(deploy(BACKING, FEE, CAP, ethers.constants.AddressZero));
    await revert(deploy(BACKING, FEE, CAP, feeWallet.address, ""));
  });

  it("zero-fee collection still protects 100% of value and has no privileged withdrawal", async function () {
    const fullBacking = await deploy(BACKING, 0, 1);
    const before = await ethers.provider.getBalance(feeWallet.address);
    await mintFrom(alice, fullBacking);
    expect((await ethers.provider.getBalance(feeWallet.address)).eq(before)).to.equal(true);
    expect((await ethers.provider.getBalance(fullBacking.address)).eq(BACKING)).to.equal(true);
    await fullBacking.connect(alice).burn(1);
    expect((await ethers.provider.getBalance(fullBacking.address)).eq(0)).to.equal(true);
  });
});
