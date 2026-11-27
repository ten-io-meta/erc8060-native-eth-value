const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("ERC8060Reference — strict, generic, no administrator", function () {
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
    nft = await (await ethers.getContractFactory("ERC8060Reference")).deploy(
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

  it("implements strict IERC721Value and explicitly separate historical value-only discovery ID", async function () {
    expect(await nft.supportsInterface("0x88495fe7")).to.equal(true);
    expect(await nft.supportsInterface("0x80ac58cd")).to.equal(true);
    expect(await nft.supportsInterface("0x01ffc9a7")).to.equal(true);
    expect(await nft.supportsInterface("0xcadf338f")).to.equal(true);
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

  it("reverts a contract-owner ETH rejection atomically; preserves redeemable value and ownership", async function () {
    const actor = await (await ethers.getContractFactory("ReferenceRejectETH")).deploy();
    await actor.deployed();
    await actor.connect(alice).mintFrom(nft.address, { value: eth("0.10") });

    const preOwner = await nft.ownerOf(1);
    const preLiability = await nft.totalRedeemableValue();
    const preValue = await nft["valueOf(uint256)"](1);
    const preBacking = await ethers.provider.getBalance(nft.address);
    const preNextId = await nft.nextTokenId();

    expect(preOwner).to.equal(actor.address);
    expect(preValue.eq(eth("0.10"))).to.equal(true);
    await expectRevert(actor.connect(alice).tryBurn(nft.address, 1));

    // This is a mined/local EVM revert. Neither the NFT, accounting, backing,
    // nor the token's own previously reported redeemable value may change.
    expect(await nft.ownerOf(1)).to.equal(preOwner);
    expect((await nft.totalRedeemableValue()).eq(preLiability)).to.equal(true);
    expect((await nft["valueOf(uint256)"](1)).eq(preValue)).to.equal(true);
    expect((await ethers.provider.getBalance(nft.address)).eq(preBacking)).to.equal(true);
    expect((await nft.nextTokenId()).eq(preNextId)).to.equal(true);
    expect(await nft.supportsInterface("0x88495fe7")).to.equal(true);
  });

  it("a rejecting contract owner can recover ONLY if it exposes an authorized NFT transfer", async function () {
    const actor = await (await ethers.getContractFactory("ReferenceRejectETH")).deploy();
    await actor.deployed();
    await actor.connect(alice).mintFrom(nft.address, { value: eth("0.10") });

    await expectRevert(actor.connect(alice).tryBurn(nft.address, 1));
    await expectRevert(
      actor.connect(attacker).transferOwnedToken(nft.address, alice.address, 1)
    );
    expect(await nft.ownerOf(1)).to.equal(actor.address);
    // Only this deliberately equipped test actor can transfer its NFT away.
    // A real contract NFT owner without such a method could remain stuck.
    await actor.connect(deployer).transferOwnedToken(nft.address, alice.address, 1);
    expect(await nft.ownerOf(1)).to.equal(alice.address);
    expect((await nft["valueOf(uint256)"](1)).eq(eth("0.10"))).to.equal(true);

    await nft.connect(alice).burn(1);
    await expectRevert(nft.ownerOf(1));
    expect((await nft.totalRedeemableValue()).eq(0)).to.equal(true);
    expect((await ethers.provider.getBalance(nft.address)).eq(0)).to.equal(true);
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
  it("does not confuse a value-only ERC165 mock with the strict two-function guarantee", async function () {
    const legacy = await (await ethers.getContractFactory("ERC8060LegacyValueOnlyProbe")).deploy();
    await legacy.deployed();
    expect(await legacy.supportsInterface("0xcadf338f")).to.equal(true);
    expect(await legacy.supportsInterface("0x88495fe7")).to.equal(false);
    expect(await nft.supportsInterface("0x88495fe7")).to.equal(true);
  });

  it("reports the strict interface ID as XOR of its exact function selectors", async function () {
    const i = nft.interface.getSighash("valueOf(uint256)");
    const j = nft.interface.getSighash("burn(uint256)");
    const xor = "0x" + (BigInt(i) ^ BigInt(j)).toString(16).padStart(8, "0");
    expect(xor).to.equal("0x88495fe7");
  });

  it("emits ERC721 Transfer burn and backing events without a fee", async function () {
    const mint = await nft.connect(alice).mint({value:eth("0.027")});
    const mintReceipt=await mint.wait();
    expect(mintReceipt.events.some(x=>x.event==="BackedMint")).to.equal(true);
    expect(mintReceipt.events.some(x=>x.event==="Transfer")).to.equal(true);
    const burn = await nft.connect(alice).burn(1);
    const receipt=await burn.wait();
    expect(receipt.events.some(x=>x.event==="BackedBurn")).to.equal(true);
    const transfer=receipt.events.find(x=>x.event==="Transfer");
    expect(transfer.args.to).to.equal(ethers.constants.AddressZero);
  });

  it("rejects an unapproved operator even if approval is present for ERC721 transfer", async function () {
    await nft.connect(alice).mint({value:eth("0.10")});
    await nft.connect(alice).setApprovalForAll(attacker.address,true);
    await expectRevert(nft.connect(attacker).burn(1));
    expect(await nft.ownerOf(1)).to.equal(alice.address);
  });

  it("keeps reserve liabilities equal to independent shadow ledger during varied mint, transfer and burn sequences", async function () {
    const users=[alice,bob,attacker],live=new Map();
    const values=["0.001","0.021","0.13","0.20"];
    for(let step=0;step<45;step++){
      let entries=[...live.entries()];
      const mode=step%6;
      if(mode<3||entries.length===0){
        const who=users[step%3],value=eth(values[step%values.length]);
        const tokenId=(await nft.nextTokenId()).toNumber();
        await nft.connect(who).mint({value});
        live.set(tokenId,{who,value});
      }else{
        const [tokenId,item]=entries[0];
        if(mode===3){
          const to=users[(step+1)%3];
          await nft.connect(item.who).transferFrom(item.who.address,to.address,tokenId);
          live.set(tokenId,{who:to,value:item.value});
        }else{
          await nft.connect(item.who).burn(tokenId);
          live.delete(tokenId);
          await expectRevert(nft.ownerOf(tokenId));
        }
      }
      let shadow=ethers.BigNumber.from(0);
      for(const [tokenId,item] of live.entries()){
        shadow=shadow.add(item.value);
        expect((await nft["valueOf(uint256)"](tokenId)).eq(item.value)).to.equal(true);
        expect(await nft.ownerOf(tokenId)).to.equal(item.who.address);
      }
      expect((await nft.totalRedeemableValue()).eq(shadow)).to.equal(true);
      expect((await ethers.provider.getBalance(nft.address)).eq(shadow)).to.equal(true);
    }
  });


  it("reverts rejected ERC721 safe-mint atomically without creating ETH liabilities or using an ID", async function () {
    const actor = await (await ethers.getContractFactory("ReferenceRejectNFT")).deploy();
    await actor.deployed();
    await expectRevert(actor.connect(alice).mintFrom(nft.address, {value:eth("0.04")}));
    expect((await nft.nextTokenId()).eq(1)).to.equal(true);
    expect((await nft.totalRedeemableValue()).eq(0)).to.equal(true);
    expect((await ethers.provider.getBalance(nft.address)).eq(0)).to.equal(true);
    await expectRevert(nft.ownerOf(1));
  });

  it("does not consume forced extra balance as holder debt or expose a surplus withdrawal", async function () {
    await nft.connect(alice).mint({value:eth("0.10")});
    // Local-only balance injection models ETH forced into a contract; no live transaction.
    await network.provider.send("hardhat_setBalance", [nft.address, eth("0.16").toHexString()]);
    expect((await nft.totalRedeemableValue()).eq(eth("0.10"))).to.equal(true);
    await expectRevert(nft.connect(attacker).burn(1));
    await nft.connect(alice).burn(1);
    expect((await nft.totalRedeemableValue()).eq(0)).to.equal(true);
    // The 0.06 ETH donation is deliberately stranded, not payable to an issuer.
    expect((await ethers.provider.getBalance(nft.address)).eq(eth("0.06"))).to.equal(true);
    expect(Object.keys(nft.interface.functions).some(s => /withdraw|rescue|sweep/i.test(s))).to.equal(false);
  });


});
