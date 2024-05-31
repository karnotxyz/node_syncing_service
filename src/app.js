require("dotenv").config();
const express = require("express");
const app = express();
const sequelize = require("../models/index");
const syncBlocks = require("./sync_blocks");
const logger = require("./logger");
const { verifyEvents } = require("./verify_events");
const bodyParser = require("body-parser");
require("./sync_blocks");

// parse application/json
app.use(bodyParser.json());

const PORT = process.env.PORT;

app.post("/sync", async (req, res) => {
  try {
    syncBlocks(req.body.syncTo);
    res.status(200).send("Syncing started");
  } catch (e) {
    console.error(e);
    res.status(500).send(`Error syncing - ${e}`);
  }
});

app.post("/verifyEvents", async (req, res) => {
  try {
    verifyEvents();
    res.status(200).send("Verification started");
  } catch (e) {
    console.error(e);
    res.status(500).send(`Error verifying - ${e}`);
  }
});

app.listen(PORT, () => {
  logger.info(`Syncing service listening on port ${PORT}`);
});
