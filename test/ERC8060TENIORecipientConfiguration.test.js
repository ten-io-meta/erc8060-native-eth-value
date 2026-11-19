const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ERC8060 TEN.IO beneficiary configuration — LOCAL ONLY, NO REAL ETH", function () {
  // User-confirmed historical TEN.IO wallet. Test fixture only.
  // The deployed implementation does NOT hardcode it: each fork chooses its own.
  const TENIO_WALLET = "0x75DA787FDA32092079dbe113c5c9DBC22CBBC455";
  const URI = "ipfs://tenio-local-test";
  let deployer, alice, bob, outsider, vault;
  let price, backing, fee;

  const eq = (a, b) => expect(a.toString()).to.equal(b.toString());
  async function reverts(tx) {
    let didRevert = false;
    try { await tx; } catch (_) { didRevert = true; }
    expect(didRevert).to.equal(true);
  }
  async function deployWith(wallet) {
    const Contract = await ethers.getContractFactory("ERC8060CreatorFeeReference");
    const instance = await Contract.deploy(wallet);
    await instance.deployed();
    return instance;
  }
  async function assertLedger(instance, minted, burned, collected) {
    const claim = backing.mul(minted - burned);
    const earnings = fee.mul(minted - collected);
    eq(await instance.totalRedeemableValue(), claim);
    eq(await instance.feesAccrued(), earnings);
    eq(await ethers.provider.getBalance(instance.address), claim.add(earnings));
    eq(await instance.unallocatedETH(), 0);
    expect(await instance.isSolvent()).to.equal(true);
  }

  beforeEach(async function () {
    [deployer, alice, bob, outsider] = await ethers.getSigners();
    vault = await deployWith(TENIO_WALLET);
    price = await vault.MINT_PRICE();
    backing = await vault.REDEEM_VALUE();
    fee = await vault.CREATOR_FEE();
  });

  it("pins the EXACT user-confirmed TEN.IO wallet as an immutable constructor address", async function () {
    expect(await vault.feeRecipient()).to.equal(ethers.utils.getAddress(TENIO_WALLET));
    eq(price, ethers.utils.parseEther("0.12"));
    eq(backing, ethers.utils.parseEther("0.10"));
    eq(fee, ethers.utils.parseEther("0.02"));

    // A user-controlled wallet, contract owner, fee setter or proxy upgrade
    // is deliberately absent from this no-admin implementation.
    for (const signature of [
      "owner()", "transferOwnership(address)", "withdrawSurplus(uint256)",
      "withdraw()", "setFeeRecipient(address)", "upgradeTo(address)",
      "setCreatorFee(uint256)"
    ]) {
      expect(vault.interface.functions[signature]).to.equal(undefined);
    }
    expect(await vault.supportsInterface("0x88495fe7")).to.equal(true);
    expect(await vault.supportsInterface("0xcadf338f")).to.equal(true);
  });

  it("pays earned ETH ONLY to the confirmed wallet, even when an outsider triggers the collection", async function () {
    await vault.connect(alice).mint(URI, { value: price });
    await vault.connect(bob).mint(URI, { value: price });
    await assertLedger(vault, 2, 0, 0);

    const tenioBefore = await ethers.provider.getBalance(TENIO_WALLET);
    const outsiderBefore = await ethers.provider.getBalance(outsider.address);
    const receipt = await (await vault.connect(outsider).collectFees()).wait();
    const tenioAfter = await ethers.provider.getBalance(TENIO_WALLET);
    const outsiderAfter = await ethers.provider.getBalance(outsider.address);
    const amount = fee.mul(2);

    eq(tenioAfter.sub(tenioBefore), amount);
    eq(outsiderBefore.sub(outsiderAfter), receipt.gasUsed.mul(receipt.effectiveGasPrice));
    await assertLedger(vault, 2, 0, 2);
    expect(await vault.feeRecipient()).to.equal(ethers.utils.getAddress(TENIO_WALLET));

    // Collecting again cannot extract the outstanding 0.20 ETH.
    await reverts(vault.connect(outsider).collectFees());
    eq(await vault.totalRedeemableValue(), backing.mul(2));
  });

  it("preserves individual redemption after TEN.IO has collected all earned fees", async function () {
    await vault.connect(alice).mint(URI, { value: price });
    await vault.connect(bob).mint(URI, { value: price });
    await vault.connect(outsider).collectFees();
    await assertLedger(vault, 2, 0, 2);

    await vault.connect(alice).burn(1);
    await assertLedger(vault, 2, 1, 2);
    eq(await vault["valueOf(uint256)"](2), backing);
    expect(await vault.ownerOf(2)).to.equal(bob.address);
    await reverts(vault.ownerOf(1));
    await reverts(vault.connect(alice).burn(1));

    await vault.connect(bob).burn(2);
    await assertLedger(vault, 2, 2, 2);
  });

  it("keeps creator fees payable after a holder redeems an NFT first", async function () {
    await vault.connect(alice).mint(URI, { value: price });
    await vault.connect(alice).burn(1);
    eq(await ethers.provider.getBalance(vault.address), fee);
    eq(await vault.feesAccrued(), fee);
    const before = await ethers.provider.getBalance(TENIO_WALLET);
    await vault.connect(outsider).collectFees();
    eq((await ethers.provider.getBalance(TENIO_WALLET)).sub(before), fee);
    await assertLedger(vault, 1, 1, 1);
  });

  it("different fork can use its own wallet WITHOUT changing TEN.IO's deployed instance", async function () {
    const clone = await deployWith(outsider.address);
    expect(await vault.feeRecipient()).to.equal(ethers.utils.getAddress(TENIO_WALLET));
    expect(await clone.feeRecipient()).to.equal(outsider.address);
    await clone.connect(alice).mint(URI, { value: price });

    const cloneRecipientBefore = await ethers.provider.getBalance(outsider.address);
    const tenioBefore = await ethers.provider.getBalance(TENIO_WALLET);
    await clone.connect(bob).collectFees();

    eq((await ethers.provider.getBalance(outsider.address)).sub(cloneRecipientBefore), fee);
    eq(await ethers.provider.getBalance(TENIO_WALLET), tenioBefore);
    eq(await clone.totalRedeemableValue(), backing);
    eq(await clone.feesAccrued(), 0);
    expect(await vault.feeRecipient()).to.equal(ethers.utils.getAddress(TENIO_WALLET));
    await assertLedger(vault, 0, 0, 0);
  });

  it("simulated balance shortfall cannot cause successful underpaid burn or extraction of NFT backing", async function () {
    await vault.connect(alice).mint(URI, { value: price });
    await vault.connect(bob).mint(URI, { value: price });
    await ethers.provider.send("hardhat_setBalance", [
      vault.address, ethers.utils.hexValue(ethers.utils.parseEther("0.21"))
    ]);
    expect(await vault.isSolvent()).to.equal(false);
    await reverts(vault.connect(alice).burn(1));
    await reverts(vault.connect(outsider).collectFees());
    eq(await vault.totalRedeemableValue(), backing.mul(2));
    eq(await vault.feesAccrued(), fee.mul(2));
    expect(await vault.ownerOf(1)).to.equal(alice.address);
    expect(await vault.ownerOf(2)).to.equal(bob.address);
    eq(await ethers.provider.getBalance(vault.address), ethers.utils.parseEther("0.21"));
  });
});
