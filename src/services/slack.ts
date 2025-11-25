import axios from 'axios';
import { ErrorContext } from '../types.js';
import { redactSecrets } from '../utils/redactor.js';
import { log, logError } from '../utils/logger.js';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

if (!SLACK_WEBHOOK_URL) {
  throw new Error('SLACK_WEBHOOK_URL environment variable is required');
}

export async function sendErrorAlert(context: ErrorContext): Promise<void> {
  const sanitizedContext = redactSecrets(context.logContext.join('\n'));
  const sanitizedError = redactSecrets(context.errorMessage);
  const sanitizedStack = redactSecrets(context.stackTrace);
  
  // Build the Cursor-ready message
  const repoInfo = context.repo 
    ? `repo: \`${context.repo}\`` + (context.branch ? ` | branch: \`${context.branch}\`` : '')
    : 'repo: *unknown*';
  
  // Extract file path and line number from stack trace if available
  const stackMatch = sanitizedStack.match(/at\s+([^\s]+):(\d+):(\d+)/);
  const fileInfo = stackMatch 
    ? `\`${stackMatch[1]}:${stackMatch[2]}\``
    : 'unknown location';
  
  const cursorCommand = context.repo
    ? `@Cursor [repo=${context.repo}${context.branch ? `, branch=${context.branch}` : ''}] Fix the error in ${fileInfo}. See logs above for context.`
    : `@Cursor Fix the error in ${context.processName}. See logs above for context.`;
  
  const message = {
    text: `🚨 Critical Error in \`${context.processName}\``,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `🚨 Critical Error in ${context.processName}`
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Git Context:*\n${repoInfo}`
          },
          {
            type: 'mrkdwn',
            text: `*Timestamp:*\n${context.timestamp.toISOString()}`
          }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Error:*\n\`\`\`${sanitizedError}\`\`\``
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Stack Trace:*\n\`\`\`${sanitizedStack.substring(0, 1000)}\`\`\``
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Recent Logs (last 20 lines):*\n\`\`\`${sanitizedContext.split('\n').slice(-20).join('\n')}\`\`\``
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*To Fix:*\n\`${cursorCommand}\``
        }
      }
    ]
  };
  
  try {
    await axios.post(SLACK_WEBHOOK_URL as string, message, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    log(`Sent error alert to Slack for ${context.processName}`);
  } catch (error) {
    logError(error, 'Failed to send Slack alert');
    throw error;
  }
}
