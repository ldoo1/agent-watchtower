// Set test environment variables before config loads
process.env.TEST_MODE = 'true';
process.env.SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || 'https://hooks.slack.com/services/TEST/TEST/TEST';

