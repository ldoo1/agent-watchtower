# Deployment Guide

## Prerequisites

- Node.js 18+ and npm
- PM2 installed globally: `npm install -g pm2`
- Access to VPS (Ubuntu/Debian recommended)
- Slack webhook URL

## Deployment Steps

### 1. Initial Setup on VPS

```bash
# SSH into your VPS
ssh root@your-vps-ip

# Navigate to agents directory
cd /root/agents

# Clone repository
git clone https://github.com/ldoo1/agent-watchtower.git
cd agent-watchtower
```

### 2. Install Dependencies

```bash
npm install
npm run build
```

### 3. Configure Environment

Create `.env` file:

```bash
cat > .env << EOF
# Required
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# VPS Configuration
VPS_IP=$(hostname -I | awk '{print $1}')  # Or set manually
PORT=3333

# Slack Configuration
SLACK_TIMEOUT_MS=10000
SLACK_SIGNING_SECRET=your_signing_secret_here

# Features
METRICS_ENABLED=true

# Retry Queue (optional - defaults shown)
RETRY_MAX_RETRIES=5
RETRY_INITIAL_BACKOFF_MS=1000
RETRY_MAX_BACKOFF_MS=32000

# Rate Limiting (optional - defaults shown)
RATE_LIMIT_SLASH_COMMAND_RPM=10
RATE_LIMIT_HEALTH_RPM=60

# Performance (optional - defaults shown)
BUFFER_SIZE=50
DEBOUNCE_MS=300000
PROCESS_LIST_CACHE_MS=5000
EOF
```

### 4. Start with PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

PM2 will automatically:
- Restart on crashes
- Restart on server reboot (after `pm2 save`)
- Log to `./logs/` directory

### 5. Verify Deployment

```bash
# Check status
pm2 status

# View logs
pm2 logs agent-watchtower

# Test health endpoint
curl http://localhost:3333/health

# Test metrics endpoint
curl http://localhost:3333/metrics
```

## Updating the Watchtower

```bash
cd /root/agents/agent-watchtower

# Pull latest changes
git pull

# Rebuild
npm install
npm run build

# Restart
pm2 restart agent-watchtower
```

## Slack App Configuration

### 1. Create Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Name it "Agent Watchtower" and select your workspace

### 2. Configure Slash Command

1. Go to "Slash Commands" in sidebar
2. Click "Create New Command"
3. Fill in:
   - **Command**: `/agent-status`
   - **Request URL**: `http://your-vps-ip:3333/slack/status`
   - **Short Description**: Check status of all agents
   - **Usage Hint**: (optional)
4. Click "Save"

### 3. Get Signing Secret

1. Go to "Basic Information" → "App Credentials"
2. Copy "Signing Secret"
3. Add to `.env` as `SLACK_SIGNING_SECRET`

### 4. Install to Workspace

1. Go to "Install App"
2. Click "Install to Workspace"
3. Authorize the app

## Monitoring

### View Logs

```bash
# All logs
pm2 logs agent-watchtower

# Last 100 lines
pm2 logs agent-watchtower --lines 100

# Error logs only
pm2 logs agent-watchtower --err
```

### Metrics Dashboard

Set up Prometheus + Grafana to scrape metrics:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'watchtower'
    scrape_interval: 15s
    static_configs:
      - targets: ['your-vps-ip:3333']
```

Then query metrics like:
```
watchtower_errors_total
rate(watchtower_alerts_sent_total[5m])
histogram_quantile(0.95, watchtower_slack_latency_seconds_bucket)
```

### Dead Letter Queue Inspection

Dead letter queue items are stored in memory. To inspect them, you can add a debug endpoint (future enhancement) or check logs for "moved to dead letter queue" messages.

## Troubleshooting

### Watchtower Not Starting

```bash
# Check PM2 logs
pm2 logs agent-watchtower --err

# Common issues:
# 1. Missing SLACK_WEBHOOK_URL in .env
# 2. Port already in use (change PORT in .env)
# 3. PM2 not connected (run: pm2 connect)
```

### No Alerts in Slack

1. Check webhook URL is correct in `.env`
2. Verify webhook URL is still active in Slack
3. Check logs: `pm2 logs agent-watchtower`
4. Check retry queue: `curl http://localhost:3333/metrics | grep retry_queue`

### High Memory Usage

```bash
# Check process memory
pm2 monit

# If memory grows unbounded, check for:
# 1. Too many processes being monitored
# 2. Large log buffers (reduce BUFFER_SIZE)
# 3. Dead letter queue size (check metrics)
```

### Rate Limiting Issues

If slash command returns 429:
- Default limit: 10 requests/minute per IP
- Increase `RATE_LIMIT_SLASH_COMMAND_RPM` in `.env` if needed

## Security Considerations

1. **Slack Signature Verification**: Always set `SLACK_SIGNING_SECRET` in production
2. **Firewall**: Only expose port 3333 to trusted networks or use a reverse proxy
3. **Secrets**: Never commit `.env` file to git
4. **Rate Limiting**: Keep default limits unless you have specific needs

## Backup & Recovery

The Watchtower stores state in memory only. To persist:

1. **Configuration**: `.env` file (backup regularly)
2. **Logs**: PM2 logs in `./logs/` directory
3. **PM2 State**: `pm2 save` persists process list

To restore after server rebuild:
```bash
git clone <repo>
cp .env.backup .env
npm install && npm run build
pm2 start ecosystem.config.cjs
pm2 save
```
