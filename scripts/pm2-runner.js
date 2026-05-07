const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ecosystemPath = path.join(root, 'ecosystem.config.cjs');
const logsDir = path.join(root, 'logs', 'pm2');
const pm2Home = path.join(root, '.pm2');

function ensureLogsDir() {
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(pm2Home, { recursive: true });
}

function resolveFromPath() {
  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(command, ['pm2'], { encoding: 'utf8' });
  if (result.status === 0) {
    const matches = result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (process.platform === 'win32') {
      const cmdMatch = matches.find(line => line.toLowerCase().endsWith('.cmd'));
      if (cmdMatch) {
        return cmdMatch;
      }
    }
    if (matches[0]) {
      return matches[0];
    }
  }
  return null;
}

function resolveFromNpmPrefix() {
  try {
    const prefix = execFileSync('npm', ['prefix', '-g'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const candidate = process.platform === 'win32'
      ? path.join(prefix, 'pm2.cmd')
      : path.join(prefix, 'bin', 'pm2');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

function resolvePm2Command() {
  return resolveFromPath() || resolveFromNpmPrefix();
}

function runPm2(subcommand) {
  ensureLogsDir();

  const pm2 = resolvePm2Command();
  if (!pm2) {
    console.error('Unable to locate pm2. Add it to PATH or install it in the current npm global prefix.');
    process.exit(1);
  }

  let args;
  switch (subcommand) {
    case 'start':
      args = ['start', ecosystemPath];
      break;
    case 'restart':
      args = ['restart', ecosystemPath];
      break;
    case 'stop':
      args = ['stop', ecosystemPath];
      break;
    case 'logs':
      args = ['logs', '--lines', '100'];
      break;
    default:
      console.error(`Unsupported pm2 command: ${subcommand}`);
      process.exit(1);
  }

  const result = spawnSync(pm2, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32' && pm2.toLowerCase().endsWith('.cmd'),
    env: {
      ...process.env,
      PM2_HOME: pm2Home,
    },
  });

  if (typeof result.status === 'number') {
    process.exit(result.status);
  }

  console.error(result.error ? String(result.error) : 'pm2 command failed');
  process.exit(1);
}

runPm2(process.argv[2]);
