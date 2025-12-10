import { ErrorContext } from '../types.js';
import { config } from '../config.js';
import { log, logError } from '../utils/logger.js';
import axios from 'axios';

export interface QueuedAlert {
  errorContext: ErrorContext;
  attemptCount: number;
  nextRetryAt: number;
  createdAt: number;
  lastError?: string;
}

export type AlertSender = (context: ErrorContext) => Promise<void>;

const SLACK_WEBHOOK_URL = config.slackWebhookUrl;
const MAX_DEAD_LETTER_SIZE = 100;

export class RetryQueue {
  private queue = new Map<string, QueuedAlert>();
  private deadLetterQueue: QueuedAlert[] = [];
  private processorInterval?: NodeJS.Timeout;
  private isProcessing = false;
  private alertSender: AlertSender;

  constructor(alertSender: AlertSender) {
    this.alertSender = alertSender;
  }

  /**
   * Queue an alert for retry
   */
  queueAlert(errorContext: ErrorContext, error?: Error): void {
    const queueKey = this.getQueueKey(errorContext);
    
    // If already queued, update the error context but keep attempt count
    const existing = this.queue.get(queueKey);
    const attemptCount = existing ? existing.attemptCount : 0;
    
    if (attemptCount >= config.retry.maxRetries) {
      // Move to dead letter queue
      this.moveToDeadLetter(errorContext, error);
      return;
    }

    const backoffMs = this.calculateBackoff(attemptCount);
    const queuedAlert: QueuedAlert = {
      errorContext,
      attemptCount,
      nextRetryAt: Date.now() + backoffMs,
      createdAt: existing?.createdAt || Date.now(),
      lastError: error?.message,
    };

    this.queue.set(queueKey, queuedAlert);
    log(`Queued alert for retry (attempt ${attemptCount + 1}/${config.retry.maxRetries}): ${errorContext.processName}`);
    
    this.startProcessor();
  }

  /**
   * Start the periodic processor if not already running
   */
  private startProcessor(): void {
    if (this.processorInterval) return;
    
    this.processorInterval = setInterval(() => {
      this.processQueue();
    }, 1000);
    
    // Allow process to exit even if interval is running (for tests)
    if (this.processorInterval && typeof this.processorInterval.unref === 'function') {
      this.processorInterval.unref();
    }
    
    log('Retry queue processor started');
  }

  /**
   * Stop the periodic processor
   */
  stop(): void {
    if (this.processorInterval) {
      clearInterval(this.processorInterval);
      this.processorInterval = undefined;
      log('Retry queue processor stopped');
    }
  }

  /**
   * Process queued alerts that are ready for retry
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.size === 0) return;
    
    this.isProcessing = true;
    const now = Date.now();
    const ready: QueuedAlert[] = [];

    // Find alerts ready for retry
    for (const alert of this.queue.values()) {
      if (alert.nextRetryAt <= now) {
        ready.push(alert);
      }
    }

    // Process ready alerts
    for (const alert of ready) {
      await this.retryAlert(alert);
    }

    this.isProcessing = false;
  }

  /**
   * Retry sending an alert
   */
  private async retryAlert(queuedAlert: QueuedAlert): Promise<void> {
    const queueKey = this.getQueueKey(queuedAlert.errorContext);
    
    try {
      await this.alertSender(queuedAlert.errorContext);
      
      // Success - remove from queue
      this.queue.delete(queueKey);
      log(`Successfully sent queued alert after ${queuedAlert.attemptCount + 1} attempts: ${queuedAlert.errorContext.processName}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      queuedAlert.attemptCount++;
      queuedAlert.lastError = err.message;

      if (queuedAlert.attemptCount >= config.retry.maxRetries) {
        // Max retries reached - move to dead letter queue
        this.queue.delete(queueKey);
        this.moveToDeadLetter(queuedAlert.errorContext, err);
        logError(err, `Failed to send alert after ${config.retry.maxRetries} attempts: ${queuedAlert.errorContext.processName}`);
      } else {
        // Schedule next retry
        const backoffMs = this.calculateBackoff(queuedAlert.attemptCount);
        queuedAlert.nextRetryAt = Date.now() + backoffMs;
        log(`Retry ${queuedAlert.attemptCount}/${config.retry.maxRetries} failed, will retry in ${backoffMs}ms: ${queuedAlert.errorContext.processName}`);
      }
    }
  }

  /**
   * Move alert to dead letter queue
   */
  private moveToDeadLetter(errorContext: ErrorContext, error?: Error): void {
    const deadLetter: QueuedAlert = {
      errorContext,
      attemptCount: config.retry.maxRetries,
      nextRetryAt: 0,
      createdAt: Date.now(),
      lastError: error?.message,
    };

    this.deadLetterQueue.push(deadLetter);

    // Maintain size limit
    if (this.deadLetterQueue.length > MAX_DEAD_LETTER_SIZE) {
      this.deadLetterQueue.shift();
    }

    log(`Alert moved to dead letter queue: ${errorContext.processName}`);
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoff(attemptCount: number): number {
    const backoff = Math.min(
      config.retry.initialBackoffMs * Math.pow(2, attemptCount),
      config.retry.maxBackoffMs
    );
    return backoff;
  }

  /**
   * Generate a unique key for an error context
   */
  private getQueueKey(errorContext: ErrorContext): string {
    // Use process name + first 50 chars of error message for uniqueness
    const errorPreview = errorContext.errorMessage.substring(0, 50);
    return `${errorContext.processName}:${errorPreview}`;
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.queue.size;
  }

  /**
   * Get dead letter queue size
   */
  getDeadLetterSize(): number {
    return this.deadLetterQueue.length;
  }

  /**
   * Get dead letter queue items (for inspection)
   */
  getDeadLetterQueue(): readonly QueuedAlert[] {
    return [...this.deadLetterQueue];
  }

  /**
   * Clear dead letter queue
   */
  clearDeadLetterQueue(): void {
    this.deadLetterQueue = [];
    log('Dead letter queue cleared');
  }
}

