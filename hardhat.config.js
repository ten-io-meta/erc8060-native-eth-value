import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";

export default defineConfig({
  plugins: [
    hardhatEthers,
    hardhatEthersChaiMatchers,
    hardhatMocha
  ],

  solidity: "0.8.28",

  paths: {
    tests: {
      mocha: "./test"
    }
  },

  test: {
    mocha: {
      timeout: 20000
    }
  }
});