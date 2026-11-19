const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("ERC8060NativeETHReference — strict, generic, no administrator", function () {
  const eth = ethers.utils.parseEther;
  let deployer, alice, bob, attacker, nft;

  async function expectRevert(p) {
    let reverted = false;
    try {
      const tx = await p;
      if (tx && tx.wait) await tx.wait();
    } catch (error) {
      reverted = true;
    }
    expect(reverted).to.equal(true);
  }

  beforeEach(async function () {
    [deployer, alice, bob, attacker] = await ethers.getSigners();
    nft = await (await ethers.getContractFactory("ERC8060NativeETHReference")).deploy(
      "Generic ETH-backed NFT", "E8060"
    );
    await nft.deployed();
  });

  it("does not include issuer fees, collection-specific prices, admin functions or upgrade rights", async function () {
    const signatures = Object.keys(nft.interface.functions);
    for (const forbidden of [
      "owner()", "withdraw()", "withdrawSurplus(uint256)",
      "setFeeRecipient(address)", "feeRecipient()", "mintFee()",
      "maxMinted()", "upgradeTo(address)", "pause()", "setBaseURI(string)"
    ]) {
      expect(signatures.includes(forbidden)).to.equal(false);
    }
    expect(await nft.name()).to.equal("Generic ETH-backed NFT");
  });

  it("implements strict IERC721Value plus ERC721, but does not declare a legacy read-only ID", async function () {
    expect(await nft.supportsInterface("0x88495fe7")).to.equal(true);
    expect(await nft.supportsInterface("0x80ac58cd")).to.equal(true);
    expect(await nft.supportsInterface("0x01ffc9a7")).to.equal(true);
    expect(await nft.supportsInterface("0xcadf338f")).to.equal(false);
    expect(await nft.supportsInterface("0xffffffff")).to.equal(false);
  });

  it("requires real positive ETH and creates no debt for a failed mint", async function () {
    await expectRevert(nft.connect(alice).mint({ value: 0 }));
    expect((await nft.totalRedeemableValue()).eq(0)).to.equal(true);
    expect((await nft.nextTokenId()).eq(1)).to.equal(true);
  });

  it("assigns each NFT its exact actual deposit, independent of collection branding", async function () {
    await nft.connect(alice).mint({ value: eth("0.010") });
    await nft.connect(bob).mint({ value: eth("0.123") });
    expect((await nft["valueOf(uint256)"](1)).eq(eth("0.010"))).to.equal(true);
    expect((await nft["valueOf(uint256)"](2)).eq(eth("0.123"))).to.equal(true);
    expect((await nft.totalRedeemableValue()).eq(eth("0.133"))).to.equal(true);
    expect((await ethers.provider.getBalance(nft.address)).eq(eth("0.133"))).to.equal(true);
  });

  it("redeems only for the current owner, and an ERC721 operator cannot burn", async function () {
    await nft.connect(alice).mint({ value: eth("0.10") });
    await nft.connect(alice).approve(attacker.address, 1);
    await expectRevert(nft.connect(attacker).burn(1));
    await nft.connect(alice).transferFrom(alice.address, bob.address, 1);
    await expectRevert(nft.connect(alice).burn(1));
    await nft.connect(bob).burn(1);
    expect((await nft.totalRedeemableValue()).eq(0)).to.equal(true);
    expect((await ethers.provider.getBalance(nft.address)).eq(0)).to.equal(true);
    await expectRevert(nft.ownerOf(1));
    await expectRevert(nft.connect(bob).burn(1));
  });

  it("burn preserves other token holders' full backing", async function () {
    await nft.connect(alice).mint({ value: eth("1") });
    await nft.connect(bob).mint({ value: eth("0.35") });
    await nft.connect(alice).burn(1);
    expect((await nft.totalRedeemableValue()).eq(eth("0.35"))).to.equal(true);
    expect((await ethers.provider.getBalance(nft.address)).eq(eth("0.35"))).to.equal(true);
    expect((await nft["valueOf(uint256)"](2)).eq(eth("0.35"))).to.equal(true);
    await nft.connect(bob).burn(2);
    expect((await ethers.provider.getBalance(nft.address)).eq(0)).to.equal(true);
  });

  it("does not reissue burned IDs even when later mints occur", async function () {
    await nft.connect(alice).mint({ value: eth("0.010") });
    await nft.connect(alice).burn(1);
    await nft.connect(bob).mint({ value: eth("0.02") });
    expect(await nft.ownerOf(2)).to.equal(bob.address);
    await expectRevert(nft.ownerOf(1));
    expect((await nft.nextTokenId()).eq(3)).to.equal(true);
  });

  it("reverts the entire burn when a smart-contract owner refuses ETH", async function () {
    const actor = await (await ethers.getContractFactory("ReferenceRejectETH")).deploy();
    await actor.deployed();
    await actor.connect(alice).mintFrom(nft.address, { value: eth("0.10") });
    await expectRevert(actor.connect(alice).tryBurn(nft.address, 1));
    expect(await nft.ownerOf(1)).to.equal(actor.address);
    expect((await nft.totalRedeemableValue()).eq(eth("0.10"))).to.equal(true);
    expect((await ethers.provider.getBalance(nft.address)).eq(eth("0.10"))).to.equal(true);
  });

  it("reverts before destroying a token in a simulated insolvency state", async function () {
    await nft.connect(alice).mint({ value: eth("0.05") });
    await network.provider.send("hardhat_setBalance", [nft.address, "0x0"]);
    await expectRevert(nft.connect(alice).burn(1));
    expect(await nft.ownerOf(1)).to.equal(alice.address);
    expect((await nft.totalRedeemableValue()).eq(eth("0.05"))).to.equal(true);
    // The artificial state is local test fault injection, not a real-world
    // route for attackers to force ETH out of a contract.
  });

  it("rejects direct ETH transfer unrelated to a mint, without creating obligations", async function () {
    await expectRevert(alice.sendTransaction({ to: nft.address, value: eth("0.02") }));
    expect((await nft.totalRedeemableValue()).eq(0)).to.equal(true);
  });

  it("blocks reentrant mint during ERC721Receiver callback", async function () {
    const actor = await (await ethers.getContractFactory("ReferenceMintReentrancy")).deploy();
    await actor.deployed();
    // Make sure the attacker has ETH to execute a nested mint if the guard fails.
    await alice.sendTransaction({ to: actor.address, value: eth("0.04") });
    await actor.connect(alice).mintFrom(nft.address, { value: eth("0.04") });
    expect(await actor.tried()).to.equal(true);
    expect(await actor.blocked()).to.equal(true);
    expect((await nft.totalRedeemableValue()).eq(eth("0.04"))).to.equal(true);
    expect((await nft.nextTokenId()).eq(2)).to.equal(true);
  });

  it("blocks reentrant burn of another live token during a payout callback", async function () {
    const actor = await (await ethers.getContractFactory("ReferenceBurnReentrancy")).deploy();
    await actor.deployed();
    await actor.connect(alice).mintFrom(nft.address, { value: eth("0.04") });
    await actor.connect(alice).mintFrom(nft.address, { value: eth("0.06") });
    await actor.connect(alice).burnFirst(1, 2);
    expect(await actor.tried()).to.equal(true);
    expect(await actor.blocked()).to.equal(true);
    expect(await nft.ownerOf(2)).to.equal(actor.address);
    expect((await nft.totalRedeemableValue()).eq(eth("0.06"))).to.equal(true);
    expect((await ethers.provider.getBalance(nft.address)).eq(eth("0.06"))).to.equal(true);
  });

  it("conserves backing and accounting over a varied sequence without any issuer fee", async function () {
    const deposits = ["0.010", "0.07", "0.10", "1"];
    const ids = [];
    for (const [i, deposit] of deposits.entries()) {
      await nft.connect(i % 2 ? bob : alice).mint({ value: eth(deposit) });
      ids.push(i + 1);
    }
    await nft.connect(alice).transferFrom(alice.address, bob.address, 1);
    await nft.connect(bob).burn(1);
    await nft.connect(alice).burn(3);
    const expected = eth("0.07").add(eth("1"));
    expect((await nft.totalRedeemableValue()).eq(expected)).to.equal(true);
    expect((await ethers.provider.getBalance(nft.address)).eq(expected)).to.equal(true);
    expect((await nft["valueOf(uint256)"](2)).add(await nft["valueOf(uint256)"](4)).eq(expected)).to.equal(true);
  });
});
