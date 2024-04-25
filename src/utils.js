const starknet = require("starknet");
const ERC20 = require("./contracts/ERC20.json");
const { ApiPromise, WsProvider, HttpProvider } = require("@polkadot/api");
const logger = require("./logger");
const syncing_db = require("../models").syncing_db;

const eth_address =
  "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const nonce_tracker = {};
const polkadotProvider = new HttpProvider(process.env.RPC_URL_SYNCING_NODE);

// Only returning lower part for now as it solves the need
async function getBalance(address, provider) {
  const erc20 = new starknet.Contract(ERC20.abi, eth_address, provider);
  const balance = await erc20.call("balanceOf", [address]);
  return balance.balance.low;
}

async function getNonce(address, provider, nonce) {
  if (address != "0x1") {
    return nonce;
  }
  if (nonce_tracker[address] == undefined) {
    nonce_tracker[address] = Number(await provider.getNonceForAddress(address));
  }
  let address_nonce = nonce_tracker[address];
  nonce_tracker[address] += 1;
  console.log(nonce_tracker[address]);
  return `0x${address_nonce.toString(16)}`;
}

async function setDisableFee(value) {
  logger.info(`Setting disable fees to - ${value}`);
  const api = await ApiPromise.create({ provider: polkadotProvider });
  const extrinsic = api.tx.starknet.setDisableFee(value);
  await extrinsic.send();
  // sleep
  await new Promise((resolve) => setTimeout(resolve, 7000));
}

async function syncDbCreateOrUpdate(attribute, value) {
  let row = await syncing_db.findOne({
    where: {
      attribute: attribute,
    },
  });
  if (row != null) {
    row.value = value;
    await row.save();
    return;
  }
  await syncing_db.create({
    attribute: attribute,
    value: value,
  });
}

async function getLatestBlockNumber(provider) {
  const latestBlock = await provider.getBlockLatestAccepted();
  return latestBlock.block_number;
}

module.exports = {
  getBalance,
  getNonce,
  setDisableFee,
  syncDbCreateOrUpdate,
  getLatestBlockNumber,
};
