const starknet = require("starknet");

const originalProvider = new starknet.RpcProvider({
  nodeUrl: process.env.RPC_URL_ORIGINAL_NODE,
});
const syncingProvider = new starknet.RpcProvider({
  nodeUrl: process.env.RPC_URL_SYNCING_NODE,
});

module.exports = {
  originalProvider,
  syncingProvider,
};
