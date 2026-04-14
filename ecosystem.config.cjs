module.exports = {
  apps: [
    {
      name: 'mission-control',
      script: 'npm',
      args: 'start',
      cwd: '/home/alan/.openclaw/workspace/projects/mission-control',
      env: {
        NODE_ENV: 'production',
        PORT: '4000',
        OPENCLAW_GATEWAY_URL: 'ws://127.0.0.1:18789',
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      max_memory_restart: '512M',
    },
  ],
};
