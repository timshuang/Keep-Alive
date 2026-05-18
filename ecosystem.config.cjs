const path = require('path');

const root = __dirname;
const logsDir = path.join(root, 'logs', 'pm2');

module.exports = {
  apps: [
    {
      name: 'keep-alive',
      cwd: root,
      script: path.join(root, 'dist', 'index.js'),
      interpreter: 'node',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      out_file: path.join(logsDir, 'keepalive.out.log'),
      error_file: path.join(logsDir, 'keepalive.err.log'),
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        ADMIN_HOST: '127.0.0.1',
        ADMIN_PORT: '3210',
      },
    },
  ],
};
