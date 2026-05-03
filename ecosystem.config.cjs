// PM2 process manifest. Single-instance because agent runtimes hold
// in-memory state (LocalBus, Agent process per ENS) that doesn't survive
// fork. Cluster mode would silently break A2A signature verification
// since each worker has different keypairs in memory.
//
// Deploy on EC2:
//   cd /opt/agentdir
//   git pull
//   pnpm install --frozen-lockfile
//   cd Frontend && pnpm build
//   cd /opt/agentdir
//   pm2 startOrReload ecosystem.config.cjs --env production
//
// Logs: pm2 logs agentdir-app
// Status: pm2 status

module.exports = {
  apps: [
    {
      name: "agentdir-app",
      cwd: "/opt/agentdir/Frontend",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 127.0.0.1",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      max_memory_restart: "1G",
      kill_timeout: 10000, // give in-flight calls a chance to drain
      env: {
        NODE_ENV: "production",
      },
      // Pull all secrets out of /opt/agentdir/.env at startup.
      env_file: "/opt/agentdir/.env",
      error_file: "/var/log/agentdir/err.log",
      out_file: "/var/log/agentdir/out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
