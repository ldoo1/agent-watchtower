import fs from 'fs/promises';
import path from 'path';

const LOG_FILE = path.join(process.cwd(), 'watchtower.log');

// Queue for file writes to avoid blocking
const logQueue: string[] = [];
let isWriting = false;

async function writeLogQueue(): Promise<void> {
  if (isWriting || logQueue.length === 0) return;
  
  isWriting = true;
  const messages = logQueue.splice(0); // Drain queue
  
  try {
    await fs.appendFile(LOG_FILE, messages.join(''));
  } catch (err) {
    console.error('Failed to write to log file:', err);
  } finally {
    isWriting = false;
    
    // If more logs arrived while writing, write them now
    if (logQueue.length > 0) {
      // Use setTimeout with 0 to ensure it runs in next tick
      setTimeout(() => writeLogQueue(), 0);
    }
  }
}

export function log(message: string, level: 'info' | 'error' | 'warn' = 'info') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  
  // Console output (synchronous, but fast)
  console.log(logMessage.trim());
  
  // File output (async, non-blocking)
  logQueue.push(logMessage);
  if (!isWriting) {
    // Use setTimeout to ensure async execution in test environment
    setTimeout(() => writeLogQueue(), 0);
  }
}

export function logError(error: Error | unknown, context?: string) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  
  log(`${context ? `[${context}] ` : ''}${message}`, 'error');
  if (stack) {
    log(stack, 'error');
  }
}
