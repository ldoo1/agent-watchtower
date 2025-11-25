import fs from 'fs';
import path from 'path';

const LOG_FILE = path.join(process.cwd(), 'watchtower.log');

export function log(message: string, level: 'info' | 'error' | 'warn' = 'info') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  
  // Console output
  console.log(logMessage.trim());
  
  // File output
  try {
    fs.appendFileSync(LOG_FILE, logMessage);
  } catch (err) {
    console.error('Failed to write to log file:', err);
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
