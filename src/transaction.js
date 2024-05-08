const axios = require("axios");
const starknet = require("starknet");
const { getBalance, getNonce } = require("./utils");

async function declare(tx, originalProvider, syncingProvider) {
  let contract_class = await originalProvider.getClassByHash(tx.class_hash);
  let result;
  if (tx.sender_address == "0x1") {
    result = await postWithRetry(syncingProvider.nodeUrl, {
      id: 0,
      jsonrpc: "2.0",
      method: "starknet_addDeclareTransaction",
      params: {
        declare_transaction: {
          type: "DECLARE",
          contract_class,
          version: "0x1",
          max_fee: tx.max_fee,
          signature: ["0x1", "0x1"],
          sender_address: "0x1",
          nonce: await getNonce("0x1", syncingProvider, tx.nonce),
        },
      },
    });
  } else {
    if (tx.version == "0x2") {
      let contract_class_parsed =
        starknet.provider.parseContract(contract_class);
      contract_class = {
        ...contract_class_parsed,
        // parsing decompressed the sierra program
        sierra_program: contract_class.sierra_program,
      };
    }
    result = await postWithRetry(syncingProvider.nodeUrl, {
      id: 0,
      jsonrpc: "2.0",
      method: "starknet_addDeclareTransaction",
      params: {
        declare_transaction: {
          type: "DECLARE",
          contract_class,
          version: tx.version,
          max_fee: tx.max_fee,
          signature: tx.signature,
          sender_address: tx.sender_address,
          nonce: await getNonce(tx.sender_address, syncingProvider, tx.nonce),
          // if compiled_class_hash is undefined, it won't be sent
          compiled_class_hash: tx.compiled_class_hash,
        },
      },
    });
  }
  return result.data.result.transaction_hash;
}

async function deploy_account(tx, syncingProvider) {
  if (tx.max_fee != "0x0") {
    while (true) {
      let contract_address =
        await starknet.hash.calculateContractAddressFromHash(
          tx.contract_address_salt,
          tx.class_hash,
          tx.constructor_calldata,
          "0x0",
        );
      let balance = await getBalance(contract_address, syncingProvider);
      if (balance > 0n) {
        break;
      }
      // sleep for 6 seconds
      console.log("Can't deploy without funds, waiting for 6 seconds");
      await new Promise((resolve) => setTimeout(resolve, 6000));
    }
  }
  let result = await postWithRetry(syncingProvider.nodeUrl, {
    id: 0,
    jsonrpc: "2.0",
    method: "starknet_addDeployAccountTransaction",
    params: {
      deploy_account_transaction: {
        type: "DEPLOY_ACCOUNT",
        max_fee: tx.max_fee,
        signature: tx.signature,
        nonce: "0x0",
        contract_address_salt: tx.contract_address_salt,
        constructor_calldata: tx.constructor_calldata,
        class_hash: tx.class_hash,
        version: tx.version,
      },
    },
  });
  let txn_hash = result.data.result.transaction_hash;
  // sleep for 6 seconds
  await new Promise((resolve) =>
    setTimeout(resolve, process.env.SYNCING_NODE_BLOCK_TIME * 1000),
  );
  return txn_hash;
}

async function invoke(tx, syncingProvider) {
  let result = await postWithRetry(syncingProvider.nodeUrl, {
    id: 0,
    jsonrpc: "2.0",
    method: "starknet_addInvokeTransaction",
    params: {
      invoke_transaction: {
        type: "INVOKE",
        sender_address: tx.sender_address,
        calldata: tx.calldata,
        max_fee: tx.max_fee,
        signature: tx.signature,
        nonce: await getNonce(tx.sender_address, syncingProvider, tx.nonce),
        version: tx.version,
      },
    },
  });
  return result.data.result.transaction_hash;
}

// TODO: handle by sending the actual transaction on L1
async function l1_handler(tx, syncingProvider) {
  let result = await postWithRetry(syncingProvider.nodeUrl, {
    id: 0,
    jsonrpc: "2.0",
    method: "starknet_consumeL1Message",
    params: {
      l1_handler_transaction: {
        nonce: tx.nonce,
        contract_address: tx.contract_address,
        entry_point_selector: tx.entry_point_selector,
        calldata: tx.calldata,
        version: tx.version,
      },
      fee: "0xfffffff",
    },
  });
  console.log(result.data);
  return "L1_HANDLER";
}

async function postWithRetry(url, data) {
  const MAX_ATTEMPTS = 3;
  const SLEEP = 30000;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    let result = await axios.post(url, data);
    // code 55 means account validaton failed
    if (result.data.error && result.data.error.code === 55) {
      // it's possible that some previous txn makes this txs succesful,
      // but the previous one is still in mempool. so we wait and retry.
      // for ex: a txn to fund the account adds balance but it's still mempool
      // so the current txn fails with fee error.
      console.log("Account validation failed, retrying in 30 seconds");
      await new Promise((resolve) => setTimeout(resolve, SLEEP));
    } else {
      return result;
    }
  }
  throw new Error("Max retries exceeded for transaction");
}

module.exports = {
  declare,
  deploy_account,
  invoke,
  l1_handler,
};
