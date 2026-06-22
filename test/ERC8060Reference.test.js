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

  async function mintToUser() {
    await nft.connect(user).mint(URI, { value: MINT_PRICE });
  }

  async function valueOf(tokenId) {
    return nft["valueOf(uint256)"](tokenId);
  }

  it("mints only with the exact mint price", async function () {
    await expectRevert(
      nft.connect(user).mint(URI, { value: ethers.utils.parseEther("0.119") })
    );

    await expectRevert(
      nft.connect(user).mint(URI, { value: ethers.utils.parseEther("0.121") })
    );

    await nft.connect(user).mint(URI, { value: MINT_PRICE });

    expect(await nft.ownerOf(1)).to.equal(user.address);
  });

  it("valueOf returns the redeemable ETH value for an existing token", async function () {
    await mintToUser();

    const value = await valueOf(1);

    expect(value.toString()).to.equal(REDEEM_VALUE.toString());
  });

  it("valueOf reverts for nonexistent tokens", async function () {
    await expectRevert(valueOf(999));
  });

  it("only the current token owner can burn", async function () {
    await mintToUser();

    await expectRevert(nft.connect(other).burn(1));
  });

  it("burn destroys the token and redeems the value", async function () {
    await mintToUser();

    const contractBalanceBefore = await ethers.provider.getBalance(nft.address);

    await nft.connect(user).burn(1);

    const contractBalanceAfter = await ethers.provider.getBalance(nft.address);

    expect(contractBalanceAfter.toString()).to.equal(
      contractBalanceBefore.sub(REDEEM_VALUE).toString()
    );

    await expectRevert(nft.ownerOf(1));
  });

  it("cannot redeem the same token twice", async function () {
    await mintToUser();

    await nft.connect(user).burn(1);

    await expectRevert(nft.connect(user).burn(1));
  });

  it("direct ETH sent to the contract does not change valueOf", async function () {
    await mintToUser();

    await owner.sendTransaction({
      to: nft.address,
      value: ethers.utils.parseEther("1"),
    });

    const value = await valueOf(1);

    expect(value.toString()).to.equal(REDEEM_VALUE.toString());
  });

  it("transfer preserves redeemable value for the new owner", async function () {
    await mintToUser();

    await nft.connect(user).transferFrom(user.address, other.address, 1);

    expect(await nft.ownerOf(1)).to.equal(other.address);

    const value = await valueOf(1);

    expect(value.toString()).to.equal(REDEEM_VALUE.toString());

    await expectRevert(nft.connect(user).burn(1));

    await nft.connect(other).burn(1);
  });
});