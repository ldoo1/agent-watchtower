import 'dotenv/config';
import { ProcessMonitor } from './services/monitor.js';
import { SlackServer } from './services/server.js';
import { log, logError } from './utils/logger.js';

const monitor = new ProcessMonitor();
const slackServer = new SlackServer(monitor, parseInt(process.env.PORT || '3333', 10));

// Graceful shutdown
process.on('SIGINT', async () => {
  log('Received SIGINT, shutting down gracefully...');
  await monitor.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('Received SIGTERM, shutting down gracefully...');
  await monitor.stop();
  process.exit(0);
});

// Start monitoring
monitor.start().catch((error) => {
  logError(error, 'Failed to start monitor');
  process.exit(1);
});

// Start Slack server
slackServer.start();

log('Agent Watchtower starting...');
