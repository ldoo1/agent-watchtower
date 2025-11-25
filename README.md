# Agent Watchtower

A self-hosted monitoring service that watches your PM2 processes for errors and dispatches "Cursor-ready" alerts to Slack.

## Quick Start (Deploying & Testing)

Since you are setting this up for the first time:

1. **Initialize Git & Push to GitHub:**
   (Run this in your terminal inside the `agent-watchtower` folder)
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   gh repo create agent-watchtower --private --source=. --push
   ```

2. **Run the Test:**
   ```bash
   npm install
   npm run build
   node dist/test/test-components.js
   ```

3. **Verify:**
   - Check Slack for the alert.
   - Reply `@Cursor fix this` in the thread.
   - Check GitHub for the new Pull Request.

4. **Start the Monitor:**
   ```bash
   pm2 start ecosystem.config.js
   ```

## Features
... (rest of the file)
