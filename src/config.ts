import { z } from 'zod';

const configSchema = z.object({
  // Retry queue configuration
  retry: z.object({
    maxRetries: z.number().int().min(1).max(10).default(5),
    initialBackoffMs: z.number().int().min(100).default(1000),
    maxBackoffMs: z.number().int().min(1000).default(32000),
  }).default({}),
  
  // Rate limiting configuration
  rateLimit: z.object({
    slashCommandRpm: z.number().int().min(1).default(10),
    healthRpm: z.number().int().min(1).default(60),
  }).default({}),
  
  // Metrics configuration
  metrics: z.object({
    enabled: z.boolean().default(true),
  }).default({}),
  
  // Existing environment variables
  slackWebhookUrl: z.string().url(),
  vpsIp: z.string().default('193.43.134.134'),
  slackTimeoutMs: z.number().int().min(1000).default(10000),
  slackSigningSecret: z.string().optional(),
  port: z.number().int().min(1).max(65535).default(3333),
  bufferSize: z.number().int().min(10).default(50),
  debounceMs: z.number().int().min(1000).default(300000),
  processListCacheMs: z.number().int().min(1000).default(5000),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  // Allow tests to skip validation by setting TEST_MODE
  if (process.env.TEST_MODE === 'true' && !process.env.SLACK_WEBHOOK_URL) {
    // Return a valid test config
    return {
      retry: {
        maxRetries: 5,
        initialBackoffMs: 1000,
        maxBackoffMs: 32000,
      },
      rateLimit: {
        slashCommandRpm: 10,
        healthRpm: 60,
      },
      metrics: {
        enabled: true,
      },
      slackWebhookUrl: 'https://hooks.slack.com/services/TEST/TEST/TEST',
      vpsIp: '127.0.0.1',
      slackTimeoutMs: 10000,
      slackSigningSecret: undefined,
      port: 3333,
      bufferSize: 50,
      debounceMs: 300000,
      processListCacheMs: 5000,
    } as Config;
  }

  const rawConfig = {
    retry: {
      maxRetries: parseInt(process.env.RETRY_MAX_RETRIES || '5', 10),
      initialBackoffMs: parseInt(process.env.RETRY_INITIAL_BACKOFF_MS || '1000', 10),
      maxBackoffMs: parseInt(process.env.RETRY_MAX_BACKOFF_MS || '32000', 10),
    },
    rateLimit: {
      slashCommandRpm: parseInt(process.env.RATE_LIMIT_SLASH_COMMAND_RPM || '10', 10),
      healthRpm: parseInt(process.env.RATE_LIMIT_HEALTH_RPM || '60', 10),
    },
    metrics: {
      enabled: process.env.METRICS_ENABLED !== 'false',
    },
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || '',
    vpsIp: process.env.VPS_IP || '193.43.134.134',
    slackTimeoutMs: parseInt(process.env.SLACK_TIMEOUT_MS || '10000', 10),
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
    port: parseInt(process.env.PORT || '3333', 10),
    bufferSize: parseInt(process.env.BUFFER_SIZE || '50', 10),
    debounceMs: parseInt(process.env.DEBOUNCE_MS || '300000', 10),
    processListCacheMs: parseInt(process.env.PROCESS_LIST_CACHE_MS || '5000', 10),
  };

  try {
    return configSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Configuration validation failed: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }
    throw error;
  }
}

export const config = loadConfig();

