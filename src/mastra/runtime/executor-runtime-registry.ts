import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runsRoot } from '../lib/paths';

export type ExecutorRuntimeKind = 'claude-code' | 'codeagentcli' | 'codex' | 'gemini' | 'opencode' | 'custom';
export type ExecutorRuntimeStatus = 'available' | 'busy' | 'missing' | 'disabled' | 'error';

export type ExecutorRuntime = {
  runtimeId: string;
  kind: ExecutorRuntimeKind;
  command: string;
  version?: string;
  capabilities: string[];
  maxConcurrency: number;
  status: ExecutorRuntimeStatus;
  lastHeartbeatAt?: string;
  detectedAt: string;
  error?: string;
};

export type ExecutorRuntimeCandidate = {
  runtimeId: string;
  kind: ExecutorRuntimeKind;
  command: string;
  versionArgs?: string[];
  capabilities?: string[];
  maxConcurrency?: number;
  disabled?: boolean;
};

export type ExecutorRuntimeRegistry = {
  schemaVersion: 1;
  detectedAt: string;
  runtimes: ExecutorRuntime[];
};

export type ExecutorCommandResult = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

export type ExecutorCommandRunner = (command: string, args: string[]) => Promise<ExecutorCommandResult>;

const executorRuntimesRoot = path.join(runsRoot, 'executor-runtimes');
const executorRuntimeRegistryFile = path.join(executorRuntimesRoot, 'registry.json');

export async function detectExecutorRuntimes(input: {
  candidates?: ExecutorRuntimeCandidate[];
  commandRunner?: ExecutorCommandRunner;
  now?: Date;
} = {}): Promise<ExecutorRuntimeRegistry> {
  const now = input.now ?? new Date();
  const commandRunner = input.commandRunner ?? defaultCommandRunner;
  const candidates = input.candidates ?? defaultExecutorRuntimeCandidates();
  const runtimes: ExecutorRuntime[] = [];

  for (const candidate of candidates) {
    runtimes.push(await detectExecutorRuntime(candidate, commandRunner, now));
  }

  const registry: ExecutorRuntimeRegistry = {
    schemaVersion: 1,
    detectedAt: now.toISOString(),
    runtimes,
  };
  await writeExecutorRuntimeRegistry(registry);
  return registry;
}

export async function listExecutorRuntimes(): Promise<ExecutorRuntime[]> {
  return (await readExecutorRuntimeRegistry()).runtimes;
}

export async function upsertExecutorRuntime(runtime: ExecutorRuntime): Promise<ExecutorRuntimeRegistry> {
  const registry = await readExecutorRuntimeRegistry();
  const index = registry.runtimes.findIndex(item => item.runtimeId === runtime.runtimeId);
  if (index === -1) {
    registry.runtimes.push(runtime);
  } else {
    registry.runtimes[index] = runtime;
  }
  registry.detectedAt = new Date().toISOString();
  await writeExecutorRuntimeRegistry(registry);
  return registry;
}

export async function heartbeatExecutorRuntime(input: {
  runtimeId: string;
  status?: Extract<ExecutorRuntimeStatus, 'available' | 'busy' | 'error' | 'disabled'>;
  now?: Date;
  error?: string;
}): Promise<ExecutorRuntime> {
  const registry = await readExecutorRuntimeRegistry();
  const runtime = registry.runtimes.find(item => item.runtimeId === input.runtimeId);
  if (!runtime) throw new Error(`Executor runtime not found: ${input.runtimeId}`);

  runtime.status = input.status ?? runtime.status;
  runtime.lastHeartbeatAt = (input.now ?? new Date()).toISOString();
  runtime.error = input.error;
  await writeExecutorRuntimeRegistry(registry);
  return runtime;
}

export async function readExecutorRuntimeRegistry(): Promise<ExecutorRuntimeRegistry> {
  await ensureExecutorRuntimeRegistry();
  try {
    return JSON.parse(await fs.readFile(executorRuntimeRegistryFile, 'utf8')) as ExecutorRuntimeRegistry;
  } catch {
    return emptyExecutorRuntimeRegistry();
  }
}

export async function writeExecutorRuntimeRegistry(registry: ExecutorRuntimeRegistry): Promise<void> {
  await fs.mkdir(executorRuntimesRoot, { recursive: true });
  await fs.writeFile(executorRuntimeRegistryFile, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

export function defaultExecutorRuntimeCandidates(env: NodeJS.ProcessEnv = process.env): ExecutorRuntimeCandidate[] {
  const customCommand = env.OMNI_CODE_AGENT_COMMAND?.trim();
  return [
    {
      runtimeId: 'claude-code',
      kind: 'claude-code',
      command: env.OMNI_CLAUDE_COMMAND || customCommand || 'cc',
      capabilities: ['code.execute', 'workspace.edit', 'patch_proposal'],
      maxConcurrency: numberFromEnv(env.OMNI_CLAUDE_MAX_CONCURRENCY, 1),
    },
    {
      runtimeId: 'opencode',
      kind: 'opencode',
      command: env.OMNI_OPENCODE_COMMAND || 'opencode',
      capabilities: ['code.execute', 'workspace.edit', 'patch_proposal'],
      maxConcurrency: numberFromEnv(env.OMNI_OPENCODE_MAX_CONCURRENCY, 1),
    },
    {
      runtimeId: 'codex',
      kind: 'codex',
      command: env.OMNI_CODEX_COMMAND || 'codex',
      capabilities: ['code.execute', 'workspace.edit', 'patch_proposal'],
      maxConcurrency: numberFromEnv(env.OMNI_CODEX_MAX_CONCURRENCY, 1),
    },
    {
      runtimeId: 'gemini',
      kind: 'gemini',
      command: env.OMNI_GEMINI_COMMAND || 'gemini',
      capabilities: ['code.execute', 'workspace.edit', 'patch_proposal'],
      maxConcurrency: numberFromEnv(env.OMNI_GEMINI_MAX_CONCURRENCY, 1),
    },
    {
      runtimeId: 'custom',
      kind: 'custom',
      command: customCommand || '',
      capabilities: ['code.execute', 'workspace.edit'],
      maxConcurrency: numberFromEnv(env.OMNI_CUSTOM_EXECUTOR_MAX_CONCURRENCY, 1),
      disabled: !customCommand,
    },
  ];
}

async function detectExecutorRuntime(
  candidate: ExecutorRuntimeCandidate,
  commandRunner: ExecutorCommandRunner,
  now: Date,
): Promise<ExecutorRuntime> {
  const base = {
    runtimeId: candidate.runtimeId,
    kind: candidate.kind,
    command: candidate.command,
    capabilities: candidate.capabilities ?? [],
    maxConcurrency: candidate.maxConcurrency ?? 1,
    detectedAt: now.toISOString(),
  };

  if (candidate.disabled || !candidate.command.trim()) {
    return { ...base, status: 'disabled' };
  }

  try {
    const result = await commandRunner(candidate.command, candidate.versionArgs ?? ['--version']);
    const version = firstNonEmptyLine(result.stdout) || firstNonEmptyLine(result.stderr);
    if (result.exitCode && result.exitCode !== 0) {
      return { ...base, status: 'error', version, error: `Version command exited with code ${result.exitCode}.` };
    }
    return { ...base, status: 'available', version };
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    return {
      ...base,
      status: code === 'ENOENT' ? 'missing' : 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function defaultCommandRunner(command: string, args: string[]): Promise<ExecutorCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, timeout: 5_000 }, (error, stdout, stderr) => {
      if (error && isRecord(error) && error.code === 'ENOENT') {
        reject(error);
        return;
      }
      resolve({
        stdout,
        stderr,
        exitCode: typeof (error as NodeJS.ErrnoException | null)?.code === 'number' ? Number((error as NodeJS.ErrnoException).code) : 0,
      });
    });
  });
}

async function ensureExecutorRuntimeRegistry() {
  await fs.mkdir(executorRuntimesRoot, { recursive: true });
  try {
    await fs.access(executorRuntimeRegistryFile);
  } catch {
    await writeExecutorRuntimeRegistry(emptyExecutorRuntimeRegistry());
  }
}

function emptyExecutorRuntimeRegistry(): ExecutorRuntimeRegistry {
  return {
    schemaVersion: 1,
    detectedAt: new Date(0).toISOString(),
    runtimes: [],
  };
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function firstNonEmptyLine(value: string | undefined): string | undefined {
  return value
    ?.split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);
}

function isRecord(value: unknown): value is { code?: unknown } {
  return Boolean(value && typeof value === 'object');
}
