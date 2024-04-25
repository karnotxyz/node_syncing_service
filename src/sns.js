// Load the AWS SDK for Node.js
const AWS = require("aws-sdk");
// Set region
AWS.config.update({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function sendAlert(subject, message) {
  await new AWS.SNS({ apiVersion: "2010-03-31" })
    .publish({
      Message: message,
      Subject: subject,
      TargetArn: process.env.SYNCING_SERVICE_ALERTS_TOPIC_ARN,
    })
    .promise();
}

module.exports = sendAlert;
