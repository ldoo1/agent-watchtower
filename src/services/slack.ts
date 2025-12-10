import axios from 'axios';
import { ErrorContext } from '../types.js';
import { redactSecrets } from '../utils/redactor.js';
import { log, logError } from '../utils/logger.js';
import { config } from '../config.js';
import { RetryQueue } from './retry-queue.js';
import { metrics } from './metrics.js';

const SLACK_WEBHOOK_URL = config.slackWebhookUrl;
const VPS_IP = config.vpsIp;

/**
 * Directly send to Slack API (used by retry queue)
 */
async function sendToSlack(context: ErrorContext): Promise<void> {
  const startTime = Date.now();
  
  try {
    await axios.post(SLACK_WEBHOOK_URL, buildMessage(context), {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: config.slackTimeoutMs,
      validateStatus: (status) => status >= 200 && status < 300
    });
    
    const latency = (Date.now() - startTime) / 1000;
    metrics.incrementCounter('watchtower_alerts_sent_total');
    metrics.observeHistogram('watchtower_slack_latency_seconds', latency);
    log(`Sent error alert to Slack for ${context.processName}`);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    metrics.incrementCounter('watchtower_alerts_failed_total');
    throw err; // Re-throw for retry queue to handle
  }
}

/**
 * Build Slack message from error context
 */
function buildMessage(context: ErrorContext) {
  const sanitizedContext = redactSecrets(context.logContext.join('\n'));
  const sanitizedError = redactSecrets(context.errorMessage);
  const sanitizedStack = redactSecrets(context.stackTrace);
  
  // Extract file path and line number from stack trace if available
  const stackMatch = sanitizedStack.match(/at\s+([^\s]+):(\d+):(\d+)/);
  const fileInfo = stackMatch 
    ? `${stackMatch[1]}:${stackMatch[2]}`
    : 'unknown location';
  
  // Human-readable timestamp
  const timestamp = new Date(context.timestamp);
  const timeStr = timestamp.toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit',
    timeZoneName: 'short'
  });
  
  // Build deploy command
  const agentName = context.processName;
  const deployCommand = `ssh root@${VPS_IP} "cd /root/agents/${agentName} && git pull && npm install && npm run build && pm2 restart ${agentName}"`;
  
  // Build Cursor command
  const cursorCommand = context.repo
    ? `@Cursor [repo=${context.repo}${context.branch ? `, branch=${context.branch}` : ''}] Fix the error in ${fileInfo}. See logs above for context.`
    : `@Cursor Fix the error in ${context.processName}. See logs above for context.`;
  
  // Truncate long error messages
  const maxErrorLength = 500;
  const displayError = sanitizedError.length > maxErrorLength 
    ? sanitizedError.substring(0, maxErrorLength) + '...'
    : sanitizedError;
  
  // Get last 10 lines of logs (more manageable)
  const recentLogs = sanitizedContext.split('\n').slice(-10).join('\n');
  const truncatedLogs = recentLogs.length > 800 ? recentLogs.substring(0, 800) + '\n... (truncated)' : recentLogs;
  
  return {
    text: `🚨 Critical Error in \`${context.processName}\``,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `🚨 ${context.processName} Error`,
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*When:*\n${timeStr}`
          },
          {
            type: 'mrkdwn',
            text: `*Repo:*\n${context.repo || '*unknown*'}${context.branch ? `\n*Branch:* \`${context.branch}\`` : ''}`
          }
        ]
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Error Message:*\n\`\`\`\n${displayError}\n\`\`\``
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📍 Location:* \`${fileInfo}\``
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🔧 Fix with Cursor:*\n\`\`\`\n${cursorCommand}\n\`\`\``
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🚀 Deploy Fix:*\n\`\`\`bash\n${deployCommand}\n\`\`\``
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📋 Recent Logs:*\n\`\`\`\n${truncatedLogs || '(no logs)'}\n\`\`\``
        }
      }
    ]
  };
}

// Create retry queue instance (after sendToSlack is defined)
const retryQueue = new RetryQueue(sendToSlack);

/**
 * Public API: Send error alert (with retry queue integration)
 */
export async function sendErrorAlert(context: ErrorContext): Promise<void> {
  try {
    await sendToSlack(context);
  } catch (error) {
    // Queue for retry instead of losing the alert
    const err = error instanceof Error ? error : new Error(String(error));
    retryQueue.queueAlert(context, err);
    logError(err, `Failed to send Slack alert for ${context.processName} - queued for retry`);
  }
}

/**
 * Get retry queue instance (for monitoring/debugging)
 */
export function getRetryQueue(): RetryQueue {
  return retryQueue;
}
