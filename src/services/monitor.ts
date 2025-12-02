import pm2 from 'pm2';
import { ProcessInfo, ErrorContext } from '../types.js';
import { discoverRepo } from '../utils/discovery.js';
import { sendErrorAlert } from './slack.js';
import { log, logError } from '../utils/logger.js';

// PM2 type definitions
interface PM2LogData {
  process?: {
    pm_id?: number;
    name?: string;
  };
  data?: string;
}

interface PM2ProcessDescription {
  pm_id?: number;
  name?: string;
  pm_cwd?: string;
}

// Ring buffer for each process: stores last N lines of stdout
const logBuffers = new Map<number, string[]>();
const errorHashes = new Map<string, number>(); // Track recent errors to debounce

const BUFFER_SIZE = parseInt(process.env.BUFFER_SIZE || '50', 10);
const DEBOUNCE_MS = parseInt(process.env.DEBOUNCE_MS || '300000', 10); // 5 minutes

export class ProcessMonitor {
  private isRunning = false;
  
  async start(): Promise<void> {
    if (this.isRunning) {
      log('Monitor is already running', 'warn');
      return;
    }
    
    return new Promise((resolve, reject) => {
      pm2.connect((err) => {
        if (err) {
          logError(err, 'Failed to connect to PM2');
          reject(err);
          return;
        }
        
        log('Connected to PM2');
        this.setupEventListeners();
        this.isRunning = true;
        resolve();
      });
    });
  }
  
  private setupEventListeners(): void {
    pm2.launchBus((err, bus) => {
      if (err) {
        logError(err, 'Failed to launch PM2 bus');
        return;
      }

      // Listen to all log events (stdout + stderr)
      bus.on('log:out', (data: any) => {
        this.handleLog(data, 'stdout');
      });
      
      bus.on('log:err', (data: any) => {
        this.handleLog(data, 'stderr');
        this.handleError(data);
      });
      
      // Listen for process restarts/crashes
      bus.on('process:event', (data: any) => {
        if (data.event === 'restart' || data.event === 'exit') {
          const name = data.process?.name || data.name || 'unknown';
          log(`Process ${name} ${data.event}ed`);
        }
      });
      
      log('Event listeners set up');
    });
  }
  
  private handleLog(data: PM2LogData, type: 'stdout' | 'stderr'): void {
    const processId = data.process?.pm_id;
    if (processId === undefined) return;
    
    // Add to ring buffer
    if (!logBuffers.has(processId)) {
      logBuffers.set(processId, []);
    }
    
    const buffer = logBuffers.get(processId)!;
    const logData = data.data || '';
    buffer.push(logData);
    
    // Maintain buffer size
    if (buffer.length > BUFFER_SIZE) {
      buffer.shift();
    }

    // Check stdout for critical error patterns
    if (type === 'stdout') {
      const CRITICAL_PATTERNS = [
        '[404 Not Found]',
        'Error:',
        'Exception:',
        'FATAL',
        '[ERROR]'
      ];

      const hasError = CRITICAL_PATTERNS.some(pattern => 
        logData.includes(pattern)
      );

      if (hasError) {
        this.handleError(data);
      }
    }
  }
  
  private async handleError(data: PM2LogData): Promise<void> {
    const processId = data.process?.pm_id;
    if (processId === undefined) return;
    
    const errorMessage = data.data?.trim();
    if (!errorMessage) return;
    
    // Get process info
    try {
      const processList = await this.getProcessList();
      const processInfo = processList.find(p => p.id === processId);
      
      if (!processInfo) {
        log(`Could not find process info for ID ${processId}`, 'warn');
        return;
      }
      
      // Debounce: Check if we've seen this exact error recently
      const errorHash = this.hashError(errorMessage, processInfo.name);
      const lastSeen = errorHashes.get(errorHash);
      const now = Date.now();
      
      if (lastSeen && (now - lastSeen) < DEBOUNCE_MS) {
        log(`Skipping duplicate error for ${processInfo.name} (debounced)`);
        return;
      }
      
      errorHashes.set(errorHash, now);
      
      // Clean up old hashes (older than debounce window)
      for (const [hash, timestamp] of errorHashes.entries()) {
        if (now - timestamp > DEBOUNCE_MS) {
          errorHashes.delete(hash);
        }
      }
      
      // Get log context
      const logContext = logBuffers.get(processId) || [];
      
      // Discover repo info
      const repoInfo = await discoverRepo(processInfo);
      
      // Build error context
      const errorContext: ErrorContext = {
        processId,
        processName: processInfo.name,
        errorMessage,
        stackTrace: this.extractStackTrace(logContext, errorMessage),
        logContext,
        repo: repoInfo.repo,
        branch: repoInfo.branch,
        timestamp: new Date()
      };
      
      // Send to Slack
      await sendErrorAlert(errorContext);
      
    } catch (error) {
      logError(error, `Failed to handle error for process ${processId}`);
    }
  }
  
  private extractStackTrace(logContext: string[], errorMessage: string): string {
    // Try to find stack trace in recent logs
    const errorIndex = logContext.findIndex(line => line.includes(errorMessage));
    if (errorIndex === -1) {
      return errorMessage; // Fallback to just the error message
    }
    
    // Extract stack trace (usually follows the error message)
    const stackLines: string[] = [];
    for (let i = errorIndex; i < logContext.length && i < errorIndex + 20; i++) {
      const line = logContext[i];
      if (line.includes('at ') || line.includes('Error:') || line.trim().startsWith('at')) {
        stackLines.push(line);
      }
    }
    
    return stackLines.length > 0 ? stackLines.join('\n') : errorMessage;
  }
  
  private hashError(errorMessage: string, processName: string): string {
    // Simple hash for debouncing
    const normalized = `${processName}:${errorMessage.substring(0, 100)}`;
    return Buffer.from(normalized).toString('base64').substring(0, 50);
  }
  
  public async getProcessList(): Promise<ProcessInfo[]> {
    return new Promise((resolve, reject) => {
      pm2.list((err, list) => {
        if (err) {
          reject(err);
          return;
        }
        
        const processes: ProcessInfo[] = (list || []).map((proc: any) => {
          return {
            id: proc.pm_id!,
            name: proc.name!,
            pm_cwd: proc.pm2_env?.pm_cwd || proc.pm_cwd || '',
            status: proc.pm2_env?.status || 'unknown',
            memory: proc.monit?.memory || 0,
            cpu: proc.monit?.cpu || 0,
            uptime: proc.pm2_env?.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : 0
          };
        });
        
        resolve(processes);
      });
    });
  }
  
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    pm2.disconnect();
    this.isRunning = false;
    log('Monitor stopped');
  }
}
