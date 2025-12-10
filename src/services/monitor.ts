import pm2 from 'pm2';
import { ProcessInfo, ErrorContext } from '../types.js';
import { discoverRepo } from '../utils/discovery.js';
import { sendErrorAlert } from './slack.js';
import { log, logError } from '../utils/logger.js';
import { metrics } from './metrics.js';
import { config } from '../config.js';

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
const processListCache = new Map<number, { data: ProcessInfo[]; timestamp: number }>();
const processingErrors = new Set<string>(); // Track errors being processed to avoid race conditions

const BUFFER_SIZE = config.bufferSize;
const DEBOUNCE_MS = config.debounceMs;
const PROCESS_LIST_CACHE_MS = config.processListCacheMs;
const HASH_CLEANUP_INTERVAL = 60 * 1000; // Clean up old hashes every minute

export class ProcessMonitor {
  private isRunning = false;
  private hashCleanupInterval?: NodeJS.Timeout;
  
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
          const processId = data.process?.pm_id || data.pm_id;
          log(`Process ${name} ${data.event}ed`);
          
          // Clean up log buffer and cache when process exits permanently
          if (data.event === 'exit' && processId !== undefined) {
            // Only clean up if it's not restarting (give it a moment)
            setTimeout(async () => {
              try {
                // Check if process still doesn't exist
                const processList = await this.getProcessList();
                const stillExists = processList.some(p => p.id === processId);
                
                if (!stillExists) {
                  logBuffers.delete(processId);
                  // Clear cache to force refresh
                  processListCache.clear();
                  log(`Cleaned up buffers for exited process ${processId}`);
                }
              } catch (err) {
                // If we can't check, assume it's gone and clean up anyway
                logBuffers.delete(processId);
                processListCache.clear();
              }
            }, 10000); // Wait 10 seconds to see if it restarts
          }
        }
      });
      
      // Start periodic cleanup
      this.startPeriodicCleanup();
      
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
    
    // Get process info (with caching)
    try {
      const processList = await this.getCachedProcessList();
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
      
      // Race condition prevention: Check if this error is already being processed
      const processingKey = `${processId}:${errorHash}`;
      if (processingErrors.has(processingKey)) {
        log(`Error already being processed for ${processInfo.name}`, 'warn');
        return;
      }
      
      processingErrors.add(processingKey);
      errorHashes.set(errorHash, now);
      
      try {
      // Record error metric
      metrics.incrementCounter('watchtower_errors_total', { agent: processInfo.name });
      
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
      
      // Send to Slack (fire and forget, with error handling)
      sendErrorAlert(errorContext).catch((err) => {
        logError(err, `Failed to send Slack alert for ${processInfo.name}`);
      });
      } finally {
        // Remove from processing set after a delay to prevent immediate duplicates
        setTimeout(() => {
          processingErrors.delete(processingKey);
        }, 1000);
      }
      
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
  
  private async getCachedProcessList(): Promise<ProcessInfo[]> {
    const now = Date.now();
    const cacheKey = 0; // Single cache for all processes
    
    const cached = processListCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < PROCESS_LIST_CACHE_MS) {
      metrics.incrementCounter('watchtower_process_list_cache_hits_total');
      return cached.data;
    }
    
    // Cache miss, fetch fresh data
    metrics.incrementCounter('watchtower_process_list_cache_misses_total');
    const processes = await this.getProcessList();
    processListCache.set(cacheKey, { data: processes, timestamp: now });
    return processes;
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
  
  private startPeriodicCleanup(): void {
    this.hashCleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      
      for (const [hash, timestamp] of errorHashes.entries()) {
        if (now - timestamp > DEBOUNCE_MS) {
          errorHashes.delete(hash);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        log(`Cleaned up ${cleaned} old error hashes`);
      }
    }, HASH_CLEANUP_INTERVAL);
    
    // Allow process to exit even if interval is running (for tests)
    if (this.hashCleanupInterval && typeof this.hashCleanupInterval.unref === 'function') {
      this.hashCleanupInterval.unref();
    }
  }
  
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    if (this.hashCleanupInterval) {
      clearInterval(this.hashCleanupInterval);
    }
    
    pm2.disconnect();
    this.isRunning = false;
    log('Monitor stopped');
  }
}
