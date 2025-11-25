import 'dotenv/config';
import { ProcessMonitor } from './services/monitor.js';
import { log, logError } from './utils/logger.js';

const monitor = new ProcessMonitor();

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

log('Agent Watchtower starting...');
