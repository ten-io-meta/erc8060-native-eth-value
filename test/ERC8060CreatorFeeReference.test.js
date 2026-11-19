const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ERC8060CreatorFeeReference — immutable creator fees, zero admin", function () {
  const URI = "ipfs://fee-reference";
  let deployer, minter, recipient, outsider;
  let nft, PRICE, BACKING, FEE;

  const eq = (actual, expected) => expect(actual.toString()).to.equal(expected.toString());

  async function reverts(promise) {
    let failed = false;
    try { await promise; } catch (_) { failed = true; }
    expect(failed).to.equal(true);
  }

  async function create(feeAddress) {
    const Factory = await ethers.getContractFactory("ERC8060CreatorFeeReference");
    const instance = await Factory.deploy(feeAddress);
    await instance.deployed();
    return instance;
  }

  async function createActor(target) {
    const Factory = await ethers.getContractFactory("ERC8060CreatorFeeTestActor");
    const actor = await Factory.deploy();
    await actor.deployed();
    if (target) await actor.setTarget(target.address);
    return actor;
  }

  beforeEach(async function () {
    [deployer, minter, recipient, outsider] = await ethers.getSigners();
    nft = await create(recipient.address);
    PRICE = await nft.MINT_PRICE();
    BACKING = await nft.REDEEM_VALUE();
    FEE = await nft.CREATOR_FEE();
  });

  async function mint(signer = minter) {
    return nft.connect(signer).mint(URI, { value: PRICE });
  }

  it("rejects a zero wallet; each new deployment selects a distinct immutable recipient", async function () {
    await reverts(create(ethers.constants.AddressZero));
    const otherClone = await create(outsider.address);
    expect(await nft.feeRecipient()).to.equal(recipient.address);
    expect(await otherClone.feeRecipient()).to.equal(outsider.address);
    eq(await nft.CREATOR_FEE(), ethers.utils.parseEther("0.02"));
    eq(await nft.REDEEM_VALUE(), ethers.utils.parseEther("0.10"));
    eq(await nft.MINT_PRICE(), ethers.utils.parseEther("0.12"));
  });

  it("has no owner, withdrawal of collateral, governance or fee-recipient setter in its ABI", async function () {
    for (const signature of [
      "owner()", "transferOwnership(address)", "renounceOwnership()",
      "withdraw()", "withdrawSurplus(uint256)", "setFeeRecipient(address)",
      "setCreatorFee(uint256)", "upgradeTo(address)", "mintTo(address,uint256)"
    ]) {
      expect(nft.interface.functions[signature]).to.equal(undefined);
    }
    expect(await nft.feeRecipient()).to.equal(recipient.address);
  });

  it("mints only for exact 0.12 ETH and assigns 0.10 ETH backing plus 0.02 ETH earned fees", async function () {
    await reverts(nft.connect(minter).mint(URI, { value: 0 }));
    await reverts(nft.connect(minter).mint(URI, { value: BACKING }));
    await mint();
    expect(await nft.ownerOf(1)).to.equal(minter.address);
    eq(await nft["valueOf(uint256)"](1), BACKING);
    eq(await nft.totalRedeemableValue(), BACKING);
    eq(await nft.feesAccrued(), FEE);
    eq(await ethers.provider.getBalance(nft.address), PRICE);
    eq(await nft.unallocatedETH(), 0);
    expect(await nft.isSolvent()).to.equal(true);
  });

  it("tracks pooled backing and accrued fees independently over multiple mint events", async function () {
    await mint();
    await mint(outsider);
    eq(await nft.nextTokenId(), 2);
    eq(await nft.totalRedeemableValue(), BACKING.mul(2));
    eq(await nft.feesAccrued(), FEE.mul(2));
    eq(await ethers.provider.getBalance(nft.address), PRICE.mul(2));
    eq(await nft.unallocatedETH(), 0);
  });

  it("anyone can collect earned fees, but ETH only reaches the immutable recipient", async function () {
    await mint();
    const recipientBefore = await ethers.provider.getBalance(recipient.address);
    const outsiderBefore = await ethers.provider.getBalance(outsider.address);
    await nft.connect(minter).collectFees();
    const recipientAfter = await ethers.provider.getBalance(recipient.address);

    eq(recipientAfter.sub(recipientBefore), FEE);
    eq(await nft.feesAccrued(), 0);
    eq(await nft.totalRedeemableValue(), BACKING);
    eq(await ethers.provider.getBalance(nft.address), BACKING);
    eq(await ethers.provider.getBalance(outsider.address), outsiderBefore);
    await reverts(nft.connect(outsider).collectFees());
  });

  it("collecting fees across two NFTs cannot touch either token's backing", async function () {
    await mint();
    await mint(outsider);
    await nft.connect(outsider).collectFees();
    eq(await ethers.provider.getBalance(nft.address), BACKING.mul(2));

    await nft.connect(minter).burn(1);
    eq(await nft.totalRedeemableValue(), BACKING);
    eq(await ethers.provider.getBalance(nft.address), BACKING);
    eq(await nft["valueOf(uint256)"](2), BACKING);
    await nft.connect(outsider).burn(2);
    eq(await ethers.provider.getBalance(nft.address), 0);
    eq(await nft.totalRedeemableValue(), 0);
  });

  it("burn pays the rightful current NFT holder, keeps fees intact and cannot be repeated", async function () {
    await mint();
    await nft.connect(minter).transferFrom(minter.address, outsider.address, 1);
    await reverts(nft.connect(minter).burn(1));
    const buyerBefore = await ethers.provider.getBalance(outsider.address);
    const tx = await nft.connect(outsider).burn(1);
    const receipt = await tx.wait();
    const gas = receipt.gasUsed.mul(receipt.effectiveGasPrice || tx.gasPrice);
    const buyerAfter = await ethers.provider.getBalance(outsider.address);

    eq(buyerAfter.add(gas).sub(buyerBefore), BACKING);
    eq(await nft.totalRedeemableValue(), 0);
    eq(await nft.feesAccrued(), FEE);
    eq(await ethers.provider.getBalance(nft.address), FEE);
    await reverts(nft.ownerOf(1));
    await reverts(nft.connect(outsider).burn(1));
    await nft.connect(minter).collectFees();
    eq(await ethers.provider.getBalance(nft.address), 0);
  });

  it("failed payout to contract NFT owner atomically restores NFT, backing and fees", async function () {
    const actor = await createActor(nft);
    await actor.mintHeld(URI, { value: PRICE });
    expect(await nft.ownerOf(1)).to.equal(actor.address);
    await actor.setRejectETH(true);
    await reverts(actor.burnHeld(1));

    expect(await nft.ownerOf(1)).to.equal(actor.address);
    eq(await nft["valueOf(uint256)"](1), BACKING);
    eq(await nft.totalRedeemableValue(), BACKING);
    eq(await nft.feesAccrued(), FEE);
    eq(await ethers.provider.getBalance(nft.address), PRICE);

    await actor.setRejectETH(false);
    await actor.burnHeld(1);
    await reverts(nft.ownerOf(1));
    eq(await ethers.provider.getBalance(actor.address), BACKING);
    eq(await nft.feesAccrued(), FEE);
  });

  it("rejecting fee recipient cannot erase fees, backing or mint; collection retries later", async function () {
    const actor = await createActor();
    const copy = await create(actor.address);
    await actor.setTarget(copy.address);
    await copy.connect(minter).mint(URI, { value: PRICE });
    await actor.setRejectETH(true);

    await reverts(copy.connect(outsider).collectFees());
    eq(await copy.feesAccrued(), FEE);
    eq(await copy.totalRedeemableValue(), BACKING);
    eq(await ethers.provider.getBalance(copy.address), PRICE);
    expect(await copy.ownerOf(1)).to.equal(minter.address);

    await actor.setRejectETH(false);
    await copy.connect(outsider).collectFees();
    eq(await ethers.provider.getBalance(actor.address), FEE);
    eq(await ethers.provider.getBalance(copy.address), BACKING);
    eq(await copy.feesAccrued(), 0);
  });

  it("blocks nested collectFees while accepting legitimate fee receipt", async function () {
    const actor = await createActor();
    const copy = await create(actor.address);
    await actor.setTarget(copy.address);
    await copy.connect(minter).mint(URI, { value: PRICE });
    await actor.setReenterCollect(true);
    await copy.connect(outsider).collectFees();

    expect(await actor.didTryCollect()).to.equal(true);
    expect(await actor.collectReentered()).to.equal(false);
    eq(await copy.feesAccrued(), 0);
    eq(await ethers.provider.getBalance(actor.address), FEE);
    eq(await ethers.provider.getBalance(copy.address), BACKING);
  });

  it("blocks nested mint attempt through _safeMint receiver callback", async function () {
    const actor = await createActor(nft);
    await minter.sendTransaction({ to: actor.address, value: PRICE });
    await actor.setReenterMint(true);

    await actor.connect(minter).mintHeld(URI, { value: PRICE });
    expect(await actor.didTryMint()).to.equal(true);
    expect(await actor.mintReentered()).to.equal(false);
    expect(await nft.ownerOf(1)).to.equal(actor.address);
    eq(await nft.nextTokenId(), 1);
    eq(await nft.totalRedeemableValue(), BACKING);
    eq(await nft.feesAccrued(), FEE);
    eq(await ethers.provider.getBalance(nft.address), PRICE);
    eq(await ethers.provider.getBalance(actor.address), PRICE);
  });

  it("normal direct ETH donations are rejected, not silently treated as earned fees", async function () {
    await mint();
    await reverts(
      outsider.sendTransaction({ to: nft.address, value: ethers.utils.parseEther("1") })
    );
    eq(await nft.feesAccrued(), FEE);
    eq(await nft.unallocatedETH(), 0);
    eq(await ethers.provider.getBalance(nft.address), PRICE);
  });

  it("fault-injected backing deficit blocks BOTH burn and fee collection without loss of claims", async function () {
    await mint();
    const depleted = ethers.utils.parseEther("0.11");
    await ethers.provider.send("hardhat_setBalance", [
      nft.address, ethers.utils.hexValue(depleted)
    ]);
    expect(await nft.isSolvent()).to.equal(false);
    await reverts(nft.connect(minter).burn(1));
    await reverts(nft.connect(outsider).collectFees());
    expect(await nft.ownerOf(1)).to.equal(minter.address);
    eq(await nft.totalRedeemableValue(), BACKING);
    eq(await nft.feesAccrued(), FEE);
    eq(await ethers.provider.getBalance(nft.address), depleted);
  });

  it("advertises strict ERC-8060, optional legacy query and ERC721, not random interfaces", async function () {
    expect(await nft.supportsInterface("0x88495fe7")).to.equal(true);
    expect(await nft.supportsInterface("0xcadf338f")).to.equal(true);
    expect(await nft.supportsInterface("0x80ac58cd")).to.equal(true);
    expect(await nft.supportsInterface("0x01ffc9a7")).to.equal(true);
    expect(await nft.supportsInterface("0xffffffff")).to.equal(false);
  });
});
