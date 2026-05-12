import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import 'dotenv/config';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const omniRoot = path.resolve(process.env.OMNI_HOME || path.join(os.homedir(), '.omni'));
const gatewayRoot = path.join(omniRoot, 'gateway');
const pidFile = path.join(gatewayRoot, 'gateway.pid');
const logFile = path.join(gatewayRoot, 'gateway.log');
const errFile = path.join(gatewayRoot, 'gateway.err.log');
const tsxPackage = path.join(repoRoot, 'node_modules', 'tsx', 'package.json');
const gatewayEntry = path.join(repoRoot, 'src', 'gateway', 'main.ts');
const gatewayPort = Number(process.env.OMNI_GATEWAY_PORT || 4120);

const command = (process.argv[2] || 'start').toLowerCase();

await main();

async function main() {
  switch (command) {
    case 'start':
      await start();
      break;
    case 'stop':
      stop();
      break;
    case 'restart':
      stop({ quietIfMissing: true });
      await start();
      break;
    default:
      console.error(`Unknown gateway command: ${command}`);
      console.error('Usage: npm run gateway [start|stop|restart]');
      process.exitCode = 1;
  }
}

async function start() {
  const existingPid = readPid();
  if (existingPid && isRunning(existingPid)) {
    print(`Gateway is already running (pid ${existingPid}).`);
    return;
  }

  const portPids = pidsListeningOnPort(gatewayPort);
  if (portPids.length > 0) {
    console.error(`Gateway port ${gatewayPort} is already in use by pid(s): ${portPids.join(', ')}.`);
    console.error('Run `npm run gateway stop` first, or set OMNI_GATEWAY_PORT to a different port.');
    process.exitCode = 1;
    return;
  }

  ensureLocalTsx();
  fs.mkdirSync(gatewayRoot, { recursive: true });

  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(errFile, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', gatewayEntry], {
    cwd: repoRoot,
    detached: true,
    env: process.env,
    stdio: ['ignore', out, err],
    windowsHide: true,
  });

  child.unref();
  fs.writeFileSync(pidFile, `${child.pid}\n`, 'utf8');

  await delay(1200);
  if (!isRunning(child.pid)) {
    removePidFile();
    console.error(`Gateway failed to stay running. Check ${errFile} for details.`);
    process.exitCode = 1;
    return;
  }

  print(`Gateway started (pid ${child.pid}).`);
  print(`Logs: ${logFile} / ${errFile}`);
}

function stop(options = {}) {
  const pid = readPid();
  if (!pid) {
    const portPids = pidsListeningOnPort(gatewayPort);
    if (portPids.length === 0) {
      if (!options.quietIfMissing) console.log('Gateway is not running: pid file not found and port is free.');
      return;
    }

    for (const portPid of portPids) {
      killProcessTree(portPid);
      console.log(`Gateway stopped by port ${gatewayPort} (pid ${portPid}).`);
    }
    return;
  }

  if (!isRunning(pid)) {
    removePidFile();
    const portPids = pidsListeningOnPort(gatewayPort);
    if (portPids.length === 0) {
      if (!options.quietIfMissing) console.log(`Gateway is not running: stale pid ${pid} removed and port is free.`);
      return;
    }

    for (const portPid of portPids) {
      killProcessTree(portPid);
      console.log(`Gateway stopped by port ${gatewayPort} (pid ${portPid}); stale pid ${pid} removed.`);
    }
    return;
  }

  if (!killProcessTree(pid)) {
    return;
  }

  removePidFile();
  console.log(`Gateway stopped (pid ${pid}).`);
}

function readPid() {
  try {
    const raw = fs.readFileSync(pidFile, 'utf8').trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function removePidFile() {
  try {
    fs.rmSync(pidFile, { force: true });
  } catch {
    // ignore cleanup errors
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessTree(pid) {
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      cwd: repoRoot,
      stdio: 'pipe',
      windowsHide: true,
      encoding: 'utf8',
    });
    if (result.status !== 0 && isRunning(pid)) {
      console.error(result.stderr || result.stdout || `Failed to stop gateway pid ${pid}.`);
      process.exitCode = 1;
      return false;
    }
    return true;
  }

  process.kill(pid, 'SIGTERM');
  return true;
}

function pidsListeningOnPort(port) {
  if (process.platform === 'win32') {
    const result = spawnSync('netstat', ['-ano', '-p', 'tcp'], {
      cwd: repoRoot,
      stdio: 'pipe',
      windowsHide: true,
      encoding: 'utf8',
    });
    if (result.status !== 0) return [];

    return result.stdout
      .split(/\r?\n/)
      .filter(line => line.includes(`:${port}`) && line.includes('LISTENING'))
      .map(line => Number(line.trim().split(/\s+/).at(-1)))
      .filter(pid => Number.isInteger(pid) && pid > 0);
  }

  const result = spawnSync('lsof', ['-ti', `tcp:${port}`], {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map(line => Number(line.trim()))
    .filter(pid => Number.isInteger(pid) && pid > 0);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function print(message) {
  fs.writeSync(1, `${message}\n`);
}

function ensureLocalTsx() {
  if (!fs.existsSync(tsxPackage)) {
    console.error('Local tsx package not found. Run npm install first.');
    process.exit(1);
  }
}
