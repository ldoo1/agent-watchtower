import express from 'express';
import crypto from 'crypto';
import { ProcessMonitor } from './monitor.js';
import { log, logError } from '../utils/logger.js';
import { ProcessInfo } from '../types.js';
import { metrics } from './metrics.js';
import { getRetryQueue } from './slack.js';
import { slashCommandRateLimiter, healthRateLimiter } from './rate-limiter.js';
import { config } from '../config.js';


export class SlackServer {
  private app: express.Application;
  private monitor: ProcessMonitor;
  private port: number;

  constructor(monitor: ProcessMonitor, port: number = config.port) {
    this.monitor = monitor;
    this.port = port;
    this.app = express();
    
    // Parse raw body for signature verification
    this.app.use(express.urlencoded({ extended: true, verify: (req, res, buf) => {
      (req as any).rawBody = buf;
    }}));
    // Parse JSON bodies (just in case)
    this.app.use(express.json({ verify: (req, res, buf) => {
      (req as any).rawBody = buf;
    }}));

    this.setupRoutes();
  }
  
  private verifySlackSignature(req: express.Request): boolean {
    if (!config.slackSigningSecret) {
      // If no secret configured, allow (for development/testing)
      log('WARNING: SLACK_SIGNING_SECRET not configured, skipping signature verification', 'warn');
      return true;
    }
    
    const signature = req.headers['x-slack-signature'] as string;
    const timestamp = req.headers['x-slack-request-timestamp'] as string;
    const rawBody = (req as any).rawBody;
    
    if (!signature || !timestamp || !rawBody) {
      return false;
    }
    
    // Prevent replay attacks (older than 5 minutes)
    const currentTime = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
      return false;
    }
    
    // Create signature
    const sigBaseString = `v0:${timestamp}:${rawBody.toString()}`;
    const mySignature = 'v0=' + crypto
      .createHmac('sha256', config.slackSigningSecret)
      .update(sigBaseString)
      .digest('hex');
    
    // Compare signatures using timing-safe comparison
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(mySignature)
    );
  }

  private setupRoutes() {
    // Metrics endpoint
    this.app.get('/metrics', (req, res) => {
      if (!config.metrics.enabled) {
        return res.status(503).send('# Metrics collection is disabled\n');
      }

      try {
        const retryQueue = getRetryQueue();
        
        // Update gauge values for queue sizes
        metrics.setGauge('watchtower_retry_queue_size', retryQueue.getQueueSize());
        metrics.setGauge('watchtower_dead_letter_size', retryQueue.getDeadLetterSize());

        const prometheusOutput = metrics.exportPrometheus();
        res.set('Content-Type', 'text/plain; version=0.0.4');
        res.send(prometheusOutput);
      } catch (error) {
        logError(error, 'Failed to export metrics');
        res.status(500).send('# Error exporting metrics\n');
      }
    });

    // Slash command endpoint with rate limiting
    this.app.post('/slack/status', async (req, res) => {
      try {
        // Rate limiting
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        const rateLimitCheck = slashCommandRateLimiter.checkLimit(clientIp, config.rateLimit.slashCommandRpm);
        
        if (!rateLimitCheck.allowed) {
          res.set('Retry-After', String(rateLimitCheck.retryAfter));
          return res.status(429).json({
            response_type: 'ephemeral',
            text: `Rate limit exceeded. Please try again in ${rateLimitCheck.retryAfter} seconds.`
          });
        }

        // Verify Slack signature
        if (!this.verifySlackSignature(req)) {
          log('Invalid Slack signature received', 'warn');
          return res.status(401).send('Unauthorized');
        }
        
        log('Received Slack slash command');
        const processes = await this.monitor.getProcessList();
        const response = this.formatStatusResponse(processes);
        res.json(response);
      } catch (error) {
        logError(error, 'Failed to handle slash command');
        res.status(500).json({ 
          response_type: 'ephemeral',
          text: 'Error: Failed to retrieve agent status. Please try again later.'
        });
      }
    });

    // Health endpoint with rate limiting
    this.app.get('/health', async (req, res) => {
      try {
        // Rate limiting
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        const rateLimitCheck = healthRateLimiter.checkLimit(clientIp, config.rateLimit.healthRpm);
        
        if (!rateLimitCheck.allowed) {
          res.set('Retry-After', String(rateLimitCheck.retryAfter));
          return res.status(429).json({ 
            status: 'ERROR', 
            message: 'Rate limit exceeded',
            timestamp: new Date().toISOString()
          });
        }

        // Check PM2 connection health
        const processes = await this.monitor.getProcessList();
        res.json({ 
          status: 'OK', 
          processCount: processes.length,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(503).json({ 
          status: 'ERROR', 
          message: 'PM2 connection failed',
          timestamp: new Date().toISOString()
        });
      }
    });
  }

  private formatStatusResponse(processes: ProcessInfo[]) {
    // Sort by ID
    processes.sort((a, b) => a.id - b.id);

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🤖 Agent Status Report',
          emoji: true
        }
      },
      {
        type: 'divider'
      }
    ];

    const fields = processes.map(p => {
      const statusEmoji = p.status === 'online' ? '🟢' : '🔴';
      const memoryMb = Math.round((p.memory || 0) / 1024 / 1024);
      const uptime = this.formatUptime(p.uptime || 0);
      
      return `*${p.name}* (ID: ${p.id})\nStatus: ${statusEmoji} ${p.status}\nMemory: ${memoryMb}MB\nUptime: ${uptime}`;
    });

    // Slack blocks have a limit of 10 fields per section, so we might need to chunk them
    // or just use text sections. Let's use text sections for safety and readability.
    const processBlocks = processes.map(p => {
      const statusEmoji = p.status === 'online' ? '🟢' : '🔴';
      const memoryMb = Math.round((p.memory || 0) / 1024 / 1024);
      const uptime = this.formatUptime(p.uptime || 0);

      return {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Process:*\n${p.name} (ID: ${p.id})`
          },
          {
            type: 'mrkdwn',
            text: `*Status:*\n${statusEmoji} ${p.status?.toUpperCase()}`
          },
          {
            type: 'mrkdwn',
            text: `*Memory:*\n${memoryMb} MB`
          },
          {
            type: 'mrkdwn',
            text: `*Uptime:*\n${uptime}`
          }
        ]
      };
    });

    return {
      response_type: 'in_channel', // Visible to channel. Use 'ephemeral' for private.
      blocks: [
        ...blocks,
        ...processBlocks,
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Generated at ${new Date().toISOString()}`
            }
          ]
        }
      ]
    };
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  public start() {
    this.app.listen(this.port, () => {
      log(`Slack server listening on port ${this.port}`);
    });
  }
}

