# Agent Watchtower

A self-hosted monitoring service that watches your PM2 processes for errors and dispatches "Cursor-ready" alerts to Slack. Features professional-grade error handling, retry queues, metrics, and rate limiting.

## Features

- **Real-time Monitoring**: Listens to PM2 process events and logs (stdout/stderr)
- **Smart Error Detection**: Detects crashes and critical application errors (404s, FATAL, etc.)
- **Retry Queue**: Automatic retry of failed Slack alerts with exponential backoff
- **Metrics & Observability**: Prometheus-compatible metrics endpoint
- **Rate Limiting**: Protects slash command endpoint from abuse
- **Smart Alerts**: Sends Slack notifications with error details, stack traces, and recent logs
- **Cursor Integration**: Includes `@Cursor` commands linking errors to GitHub repos for AI-powered fixes
- **Redaction**: Automatically redacts sensitive information (API keys, passwords) from logs
- **Debouncing**: Prevents duplicate alerts for the same error

## Quick Start

### Installation

```bash
git clone https://github.com/ldoo1/agent-watchtower.git
cd agent-watchtower
npm install
npm run build
```

### Configuration

Create a `.env` file:

```bash
# Required
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Optional (with defaults)
VPS_IP=193.43.134.134
PORT=3333
SLACK_TIMEOUT_MS=10000
SLACK_SIGNING_SECRET=your_signing_secret  # For signature verification
METRICS_ENABLED=true

# Retry Queue Configuration
RETRY_MAX_RETRIES=5
RETRY_INITIAL_BACKOFF_MS=1000
RETRY_MAX_BACKOFF_MS=32000

# Rate Limiting
RATE_LIMIT_SLASH_COMMAND_RPM=10
RATE_LIMIT_HEALTH_RPM=60

# Performance Tuning
BUFFER_SIZE=50
DEBOUNCE_MS=300000
PROCESS_LIST_CACHE_MS=5000
```

### Start the Monitor

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

## API Endpoints

### `/health`
Health check endpoint with PM2 connection verification.

**Rate Limit**: 60 requests/minute per IP

**Response**:
```json
{
  "status": "OK",
  "processCount": 5,
  "timestamp": "2025-12-09T12:00:00.000Z"
}
```

### `/metrics`
Prometheus-compatible metrics endpoint.

**Response**: Text/plain format with metrics:
- `watchtower_errors_total{agent}` - Total errors per agent
- `watchtower_alerts_sent_total` - Successful Slack alerts
- `watchtower_alerts_failed_total` - Failed Slack alerts
- `watchtower_retry_queue_size` - Current retry queue size
- `watchtower_dead_letter_size` - Dead letter queue size
- `watchtower_slack_latency_seconds` - Slack API latency histogram
- `watchtower_process_list_cache_hits_total` - Cache hits
- `watchtower_process_list_cache_misses_total` - Cache misses

### `/slack/status` (POST)
Slack slash command endpoint for agent status reports.

**Rate Limit**: 10 requests/minute per IP

**Authentication**: Requires valid Slack signature (if `SLACK_SIGNING_SECRET` configured)

## Error Retry Queue

When Slack webhook calls fail, alerts are automatically queued for retry with exponential backoff:

- **Initial backoff**: 1 second
- **Max backoff**: 32 seconds
- **Max retries**: 5 attempts
- **Dead letter queue**: Alerts that fail after max retries are stored (last 100)

The retry queue runs automatically in the background and processes queued alerts every second.

## Agent Configuration Requirement

For the Watchtower to link errors to the correct source code, every monitored agent **must** have a `repository` field in its `package.json`:

```json
{
  "name": "email-agent",
  "repository": {
    "type": "git",
    "url": "https://github.com/ldoo1/email-agent.git"
  }
}
```

## Deployment to VPS

```bash
# SSH into VPS
ssh root@your-vps-ip

# Navigate to agents directory
cd /root/agents

# Clone repository
git clone https://github.com/ldoo1/agent-watchtower.git
cd agent-watchtower

# Install dependencies
npm install
npm run build

# Copy .env file (create it first)
cp .env.example .env  # Edit with your values

# Start with PM2
pm2 start ecosystem.config.cjs
pm2 save
```

## Monitoring & Maintenance

### View Logs
```bash
pm2 logs agent-watchtower
```

### Check Status
```bash
pm2 status agent-watchtower
```

### Restart
```bash
pm2 restart agent-watchtower
```

### View Metrics
```bash
curl http://localhost:3333/metrics
```

## Development

### Running Tests
```bash
npm test
npm run test:watch
npm run test:coverage
```

### Local Development
```bash
npm run dev
```

## Architecture

```
PM2 Processes → ProcessMonitor → Error Detection → Retry Queue → Slack
                                         ↓
                                    Metrics Collector → /metrics
                                         ↓
                                  Rate Limiter → /slack/status
```

## Post-Fix Workflow

When the Watchtower reports an error:

1. Click the **Fix** button (or use the `@Cursor` command in the alert)
2. Cursor AI will analyze the repo and propose a fix via Pull Request
3. **Review & Merge** the PR on GitHub
4. **Pull Changes on VPS**:
   ```bash
   cd /root/agents/your-broken-agent
   git pull origin main
   npm install  # if dependencies changed
   npm run build  # if TypeScript
   pm2 restart your-broken-agent
   ```

## License

ISC
