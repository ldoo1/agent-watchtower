import express from 'express';
import { ProcessMonitor } from './monitor.js';
import { log, logError } from '../utils/logger.js';
import { ProcessInfo } from '../types.js';

export class SlackServer {
  private app: express.Application;
  private monitor: ProcessMonitor;
  private port: number;

  constructor(monitor: ProcessMonitor, port: number = 3333) {
    this.monitor = monitor;
    this.port = port;
    this.app = express();
    
    // Parse form-urlencoded bodies (Slack default)
    this.app.use(express.urlencoded({ extended: true }));
    // Parse JSON bodies (just in case)
    this.app.use(express.json());

    this.setupRoutes();
  }

  private setupRoutes() {
    this.app.post('/slack/status', async (req, res) => {
      try {
        log('Received Slack slash command');
        const processes = await this.monitor.getProcessList();
        const response = this.formatStatusResponse(processes);
        res.json(response);
      } catch (error) {
        logError(error, 'Failed to handle slash command');
        res.status(500).send('Internal Server Error');
      }
    });

    this.app.get('/health', (req, res) => {
      res.send('OK');
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

