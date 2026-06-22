const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ERC8060Reference", function () {
  const URI = "ipfs://example";

  let owner;
  let user;
  let other;
  let nft;
  let MINT_PRICE;
  let REDEEM_VALUE;

  beforeEach(async function () {
    [owner, user, other] = await ethers.getSigners();

    const ERC8060Reference = await ethers.getContractFactory("ERC8060Reference");
    nft = await ERC8060Reference.deploy();
    await nft.deployed();

    MINT_PRICE = await nft.MINT_PRICE();
    REDEEM_VALUE = await nft.REDEEM_VALUE();
  });

  async function expectRevert(txPromise) {
    let reverted = false;

    try {
      await txPromise;
    } catch (error) {
      reverted = true;
    }

    expect(reverted).to.equal(true);
  }

  async function valueOf(tokenId) {
    return nft["valueOf(uint256)"](tokenId);
  }

  async function mintAs(signer, uri = URI) {
    await nft.connect(signer).mint(uri, { value: MINT_PRICE });
  }

  it("mints only with the exact mint price", async function () {
    await expectRevert(
      nft.connect(user).mint(URI, { value: ethers.utils.parseEther("0.119") })
    );

    await expectRevert(
      nft.connect(user).mint(URI, { value: ethers.utils.parseEther("0.121") })
    );

    await mintAs(user);

    expect(await nft.ownerOf(1)).to.equal(user.address);
  });

  it("valueOf returns the redeemable ETH value for an existing token", async function () {
    await mintAs(user);

    const value = await valueOf(1);

    expect(value.toString()).to.equal(REDEEM_VALUE.toString());
  });

  it("valueOf reverts for nonexistent tokens", async function () {
    await expectRevert(valueOf(999));
  });

  it("only the current token owner can burn", async function () {
    await mintAs(user);

    await expectRevert(nft.connect(other).burn(1));
  });

  it("burn destroys the token and redeems the value", async function () {
    await mintAs(user);

    const contractBalanceBefore = await ethers.provider.getBalance(nft.address);

    await nft.connect(user).burn(1);

    const contractBalanceAfter = await ethers.provider.getBalance(nft.address);

    expect(contractBalanceAfter.toString()).to.equal(
      contractBalanceBefore.sub(REDEEM_VALUE).toString()
    );

    await expectRevert(nft.ownerOf(1));
  });

  it("cannot redeem the same token twice", async function () {
    await mintAs(user);

    await nft.connect(user).burn(1);

    await expectRevert(nft.connect(user).burn(1));
  });

  it("direct ETH sent to the contract does not change valueOf", async function () {
    await mintAs(user);

    await owner.sendTransaction({
      to: nft.address,
      value: ethers.utils.parseEther("1"),
    });

    const value = await valueOf(1);

    expect(value.toString()).to.equal(REDEEM_VALUE.toString());
  });

  it("transfer preserves redeemable value for the new owner", async function () {
    await mintAs(user);

    await nft.connect(user).transferFrom(user.address, other.address, 1);

    expect(await nft.ownerOf(1)).to.equal(other.address);

    const value = await valueOf(1);

    expect(value.toString()).to.equal(REDEEM_VALUE.toString());

    await expectRevert(nft.connect(user).burn(1));

    await nft.connect(other).burn(1);
  });

  it("tracks total redeemable value after mint", async function () {
    await mintAs(user);

    expect((await nft.totalRedeemableValue()).toString()).to.equal(
      REDEEM_VALUE.toString()
    );
  });

  it("tracks total redeemable value across multiple tokens", async function () {
    await mintAs(user);
    await mintAs(other);

    expect((await nft.totalRedeemableValue()).toString()).to.equal(
      REDEEM_VALUE.mul(2).toString()
    );

    expect((await valueOf(1)).toString()).to.equal(REDEEM_VALUE.toString());
    expect((await valueOf(2)).toString()).to.equal(REDEEM_VALUE.toString());
  });

  it("burning one token does not affect another token value", async function () {
    await mintAs(user);
    await mintAs(other);

    await nft.connect(user).burn(1);

    await expectRevert(valueOf(1));

    expect(await nft.ownerOf(2)).to.equal(other.address);
    expect((await valueOf(2)).toString()).to.equal(REDEEM_VALUE.toString());
  });

  it("burning one token decreases total redeemable value only once", async function () {
    await mintAs(user);
    await mintAs(other);

    await nft.connect(user).burn(1);

    expect((await nft.totalRedeemableValue()).toString()).to.equal(
      REDEEM_VALUE.toString()
    );
  });

  it("surplus value equals contract balance minus redeemable obligations", async function () {
    await mintAs(user);

    const surplus = await nft.surplusValue();

    expect(surplus.toString()).to.equal(
      MINT_PRICE.sub(REDEEM_VALUE).toString()
    );
  });

  it("owner can withdraw surplus value", async function () {
    await mintAs(user);

    const surplus = await nft.surplusValue();

    await nft.connect(owner).withdrawSurplus(surplus);

    expect((await nft.surplusValue()).toString()).to.equal("0");

    expect((await valueOf(1)).toString()).to.equal(REDEEM_VALUE.toString());
  });

  it("owner cannot withdraw redeemable value as surplus", async function () {
    await mintAs(user);

    const surplus = await nft.surplusValue();

    await expectRevert(
      nft.connect(owner).withdrawSurplus(surplus.add(1))
    );

    expect((await valueOf(1)).toString()).to.equal(REDEEM_VALUE.toString());
  });

  it("non-owner cannot withdraw surplus", async function () {
    await mintAs(user);

    const surplus = await nft.surplusValue();

    await expectRevert(
      nft.connect(user).withdrawSurplus(surplus)
    );
  });

  it("tokenURI remains ERC721-compatible", async function () {
    await mintAs(user, "ipfs://token-1");

    expect(await nft.tokenURI(1)).to.equal("ipfs://token-1");
  });
});