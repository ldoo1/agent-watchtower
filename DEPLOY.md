# Deployment Guide

## Post-Fix Workflow

After Cursor Cloud Agent creates a fix PR:

1. **Review the PR** on GitHub
2. **Merge the PR** when satisfied
3. **Deploy to VPS:**

### Option A: Manual Deploy (Recommended for V1)

```bash
# SSH into your VPS
ssh user@your-vps

# Navigate to agent directory
cd /path/to/agent

# Pull latest changes
git pull origin main

# Restart the agent
pm2 restart agent-name
```

### Option B: Automated Deploy (Future Enhancement)

You can set up a GitHub Action or webhook to automatically deploy after merge:

```yaml
# .github/workflows/deploy.yml
name: Deploy Agent
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd /path/to/agent
            git pull
            pm2 restart agent-name
```

## Monitoring the Watchtower

Check Watchtower status:

```bash
pm2 status agent-watchtower
pm2 logs agent-watchtower
```

## Restarting Watchtower

If you need to restart the Watchtower itself:

```bash
pm2 restart agent-watchtower
```

