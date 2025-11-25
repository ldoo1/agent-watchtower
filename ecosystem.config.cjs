module.exports = {
  apps: [
    {
      name: 'agent-watchtower',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/watchtower-error.log',
      out_file: './logs/watchtower-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
};

