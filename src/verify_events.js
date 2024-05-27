const starknet = require("starknet");
const { originalProvider, syncingProvider } = require("./providers");
const sendAlert = require("./sns");
const {
  LAST_VERIFIED_BLOCK_KEY,
  LAST_SYNCED_BLOCK_KEY,
} = require("./constants");
const logger = require("./logger");
const { syncDbCreateOrUpdate } = require("./utils");
const syncing_db = require("../models").syncing_db;

async function getEvents(txn_hash, provider) {
  let receipt = await provider.getTransactionReceipt(txn_hash);
  return receipt.events;
}

function fitlerNonMatchableEvents(events) {
  return events.filter(
    (event) =>
      event.from_address ==
        "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7" &&
      event.data.keys[0] ==
        "0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9",
  );
}

function matchEvents(originalEvents, syncingEvents) {
  let originalMatchableEvents = fitlerNonMatchableEvents(originalEvents);
  let syncingMatchableEvents = fitlerNonMatchableEvents(syncingEvents);
  if (originalMatchableEvents.length != syncingMatchableEvents.length) {
    return false;
  }
  return (
    JSON.stringify(originalMatchableEvents) ==
    JSON.stringify(syncingMatchableEvents)
  );
}

async function matchTransactions(txn_hash, originalProvider, syncingProvider) {
  try {
    let originalTx = await originalProvider.getTransactionByHash(txn_hash);
    if (Number(originalTx.max_fee) == 0) {
      logger.info(`ℹ️ Skipping txn with zero fees: ${txn_hash}`);
      return true;
    }
    let [originalEvents, syncingEvents] = await Promise.all([
      getEvents(txn_hash, originalProvider),
      getEvents(txn_hash, syncingProvider),
    ]);
    if (matchEvents(originalEvents, syncingEvents)) {
      return true;
    } else {
      return false;
    }
  } catch (err) {
    logger.error("❌ Error matching events: ", err);
    sendAlert(
      "[SYNCING_SERVICE] Error matching events",
      `Error matching events: ${err}`,
    );
    return false;
  }
}

async function matchBlock(block_no, originalProvider, syncingProvider) {
  let block = await originalProvider.getBlockWithTxs(block_no);
  let promises = [];
  for (let tx of block.transactions) {
    if (tx.type == "L1_HANDLER") {
      logger.info(`ℹ️ Skipping L1_HANDLER txn: ${tx.transaction_hash}`);
      continue;
    }
    logger.info(`Processing txn: ${tx.transaction_hash}, ...`);
    promises.push(
      matchTransactions(tx.transaction_hash, originalProvider, syncingProvider),
    );
  }
  const matchResults = await Promise.all(promises);
  for (let i = 0; i < matchResults.length; i++) {
    if (!matchResults[i]) {
      logger.error(
        `❌ Events do not match for txn: 
        ${block.transactions[i].transaction_hash}`,
      );
      sendAlert(
        "[SYNCING_SERVICE] Events do not match",
        `Events do not match for txn - ${block.transactions[i].transaction_hash}`,
      );
      throw `❌ Events do not match for txn: 
      ${block.transactions[i].transaction_hash}`;
    } else {
      logger.info(
        `✅ Events match for txn: ,
        ${block.transactions[i].transaction_hash}`,
      );
    }
  }
}

async function verifyEvents() {
  logger.info("Verifying events...");
  let lastVerifiedBlock = await syncing_db.findOne({
    where: {
      attribute: LAST_VERIFIED_BLOCK_KEY,
    },
  });
  if (lastVerifiedBlock === null) {
    lastVerifiedBlock = Number(process.env.SKIP_VERIFCATION_BLOCKS);
  } else {
    lastVerifiedBlock = lastVerifiedBlock.value;
  }

  let lastSyncedBlock = await syncing_db.findOne({
    where: {
      attribute: LAST_SYNCED_BLOCK_KEY,
    },
  });
  if (lastSyncedBlock === null) {
    logger.info("No blocks to verify - syncing not started yet");
    return;
  }

  const latestBlock = lastSyncedBlock.value;

  logger.info(`Last verified block: ${lastVerifiedBlock}`);
  logger.info(`Latest block: ${latestBlock}`);
  for (
    let block_no = lastVerifiedBlock + 1;
    block_no <= latestBlock;
    block_no++
  ) {
    try {
      logger.info(`Verifying block: ${block_no} ...`);
      await matchBlock(block_no, originalProvider, syncingProvider);
      await syncDbCreateOrUpdate(LAST_VERIFIED_BLOCK_KEY, block_no);
    } catch (err) {
      logger.error(`❌ Error verifying block: ${block_no}, error: ${err}`);
      console.error(err);
      return;
    }
  }
}

module.exports = {
  verifyEvents,
};
