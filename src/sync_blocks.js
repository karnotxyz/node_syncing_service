const syncing_db = require("../models").syncing_db;
const { LAST_SYNCED_BLOCK_KEY, LAST_SYNCED_TXN_INDEX } = require("./constants");
const logger = require("./logger");
const {
  declare,
  deploy_account,
  invoke,
  l1_handler,
} = require("./transaction");
const {
  setDisableFee,
  syncDbCreateOrUpdate,
  getLatestBlockNumber,
} = require("./utils");
const sendAlert = require("./sns");
const { originalProvider, syncingProvider } = require("./providers");
const { verifyEvents } = require("./verify_events");

let feesDisabled = false;

async function syncBlocks() {
  try {
    await setDisableFee(false);
  } catch (err) {
    logger.error(`Error setting disable fee to false, error - ${err}`);
    console.error(err);
    await sendAlert(
      "[SYNCING_SERVICE] Error setting disable fee to false",
      `Error setting disable fee to false, error - ${err}`,
    );
    return;
  }

  feesDisabled = false;
  let lastSyncedBlock = await syncing_db.findOne({
    where: {
      attribute: LAST_SYNCED_BLOCK_KEY,
    },
  });
  if (lastSyncedBlock === null) {
    lastSyncedBlock = -1;
  } else {
    lastSyncedBlock = lastSyncedBlock.value;
  }

  let skipTransactions = await syncing_db.findOne({
    where: {
      attribute: LAST_SYNCED_TXN_INDEX,
    },
  });
  if (skipTransactions === null) {
    skipTransactions = -1;
  } else {
    skipTransactions = skipTransactions.value;
  }

  const latestBlock = await getLatestBlockNumber(originalProvider);
  logger.info(`Last synced block - ${lastSyncedBlock}`);
  logger.info(`Latest block - ${latestBlock}`);

  for (let i = lastSyncedBlock + 1; i <= latestBlock; i++) {
    logger.info(`Syncing block - ${i}`);
    try {
      await syncBlock(i, skipTransactions + 1);
      skipTransactions = -1;
    } catch (e) {
      logger.error(`Error syncing block - ${i}, error - ${e}`);
      console.error(e);
      await sendAlert(
        "[SYNCING_SERVICE] Error syncing block",
        `Error syncing block - ${i}, error - ${e}`,
      );
      return;
    }

    try {
      await syncDbCreateOrUpdate(LAST_SYNCED_BLOCK_KEY, i);
      await syncDbCreateOrUpdate(LAST_SYNCED_TXN_INDEX, -1);
    } catch (e) {
      logger.error(
        `Error updating last synced block in DB, block - ${i}, error - ${e}`,
      );
      console.error(e);
      await sendAlert(
        "[SYNCING_SERVICE] Error updating last synced block in DB",
        `Error updating last synced block in DB, block - ${i}, error - ${e}`,
      );
      throw e;
    }
  }

  await verifyEvents();
}

async function syncBlock(block_no, skip_transactions) {
  let blockWithTxs = await originalProvider.getBlockWithTxs(block_no);
  logger.info(
    `Found ${blockWithTxs.transactions.length} transactions to process in block - ${block_no}`,
  );
  if (blockWithTxs.transactions.length == 0) {
    logger.error(
      `No transactions to process in block - ${block_no}. This shouldn't be possible, throwing an error`,
    );
    await sendAlert(
      "[SYNCING_SERVICE] No transactions to process",
      `No transactions to process in block - ${block_no}. This shouldn't be possible`,
    );
    throw "No transactions to process in block";
  }
  for (let i = skip_transactions; i < blockWithTxs.transactions.length; i++) {
    let tx = blockWithTxs.transactions[i];
    console.log(`Processing transaction - ${tx.transaction_hash}`);
    let tx_hash;
    try {
      tx_hash = await processTx(tx, block_no);
    } catch (err) {
      logger.error(
        `Error processing transaction - ${tx.transaction_hash}, error - ${err}`,
      );
      console.error(err);
      await sendAlert(
        "[SYNCING_SERVICE] Error processing transaction",
        `Error processing transaction - ${tx.transaction_hash}, error - ${err}`,
      );
      throw err;
    }

    if (tx_hash != tx.transaction_hash && tx.type != "L1_HANDLER") {
      await sendAlert(
        "[SYNCING_SERVICE] Transaction hash mismatch",
        `Transaction hash mismatch, original - ${tx.transaction_hash}, synced - ${tx_hash}`,
      );
      logger.warn(
        `Transaction hash mismatch, original - ${tx.transaction_hash}, synced - ${tx_hash}`,
      );
    }
    try {
      syncDbCreateOrUpdate(LAST_SYNCED_TXN_INDEX, i);
    } catch (e) {
      logger.error(
        `Error updating last synced transaction index in DB, transaction - ${tx.transaction_hash}, error - ${e}`,
      );
      console.error(e);
      throw "Error updating last synced transaction index in DB";
    }
    logger.info(`Completed transaction - ${i}`);
  }
}

async function processTx(tx) {
  if (tx.max_fee == "0x0" && !feesDisabled) {
    await setDisableFee(true);
    feesDisabled = true;
  } else if (tx.max_fee != "0x0" && feesDisabled) {
    await setDisableFee(false);
    feesDisabled = false;
  }
  switch (tx.type) {
    case "DECLARE": {
      let tx_hash = await declare(tx, originalProvider, syncingProvider);
      return tx_hash;
    }
    case "DEPLOY_ACCOUNT": {
      let tx_hash = await deploy_account(tx, syncingProvider);
      return tx_hash;
    }
    case "INVOKE": {
      let tx_hash = await invoke(tx, syncingProvider);
      return tx_hash;
    }
    case "L1_HANDLER": {
      await l1_handler(tx, syncingProvider);
      return `L1_HANDLER-${(tx.transaction_hash, syncingProvider)}`;
    }
  }
}

module.exports = syncBlocks;
