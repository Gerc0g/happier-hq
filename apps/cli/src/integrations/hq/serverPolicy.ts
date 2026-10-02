import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';

import type { BackendTargetRefV1 } from '@happier-dev/protocol';

import type { SpawnSessionOptions } from '@/rpc/handlers/registerSessionHandlers';
import { parseHQSessionOptions, resolveHQSessionOptions } from './sessionOptions';

// The root-owned marker prevents session/profile environment overlays from
// disabling the server's execution boundary. Workstation behavior is unchanged.
export function isHQServerMode(): boolean {
    return process.env.HAPPIER_HQ_SERVER_MODE === '1' || existsSync('/etc/hq/server-mode');
}

export function hqBinary(): string {
    const path = existsSync('/etc/hq/server-mode') ? '/usr/local/bin/hq' : process.env.HAPPIER_HQ_BINARY || '/home/agent/.local/bin/hq';
    if (!isAbsolute(path)) throw new Error('HQ binary must be an absolute owner-managed path');
    return path;
}

export function hqPreset(env: NodeJS.ProcessEnv): 'work' | 'research' {
    const preset = env.HQ_PRESET || 'work';
    if (preset !== 'work' && preset !== 'research') throw new Error('HQ preset must be work or research');
    return preset;
}

export function validateHQSpawnRequest(options: SpawnSessionOptions): void {
    if (!isHQServerMode()) return;
    if (options.backendTarget && (options.backendTarget.kind !== 'builtInAgent' || options.backendTarget.agentId !== 'codex')) {
        throw new Error('HQ server supports Codex only');
    }
    if (options.connectedServices != null) {
        throw new Error('HQ owns runtime authentication on this server');
    }
    if (Object.keys(options.environmentVariables ?? {}).some((key) => key !== 'HQ_PRESET' && key !== 'HQ_SESSION_OPTIONS')) {
        throw new Error('HQ server does not accept arbitrary session environment overrides');
    }
    hqPreset(options.environmentVariables ?? {});
    try { resolveHQSessionOptions(options); } catch { throw new Error('HQ session options are invalid'); }
    if (!isAbsolute(options.directory)) throw new Error('HQ requires an absolute registered workspace directory');
}

export async function authorizeHQSpawn(options: SpawnSessionOptions): Promise<SpawnSessionOptions> {
    if (!isHQServerMode()) return options;
    validateHQSpawnRequest(options);
    const preset = hqPreset(options.environmentVariables ?? {});
    // HQ resolves the directory and company; client-supplied IDs are never trusted.
    const sessionOptions = resolveHQSessionOptions(options);
    const sessionArgs = Object.keys(sessionOptions).length > 1 ? ['--session-options', JSON.stringify(sessionOptions)] : [];
    const { stdout } = await promisify(execFile)(hqBinary(), ['runner', 'resolve', '--directory', options.directory, '--preset', preset, ...sessionArgs], { timeout: 15_000, maxBuffer: 64 * 1024, encoding: 'utf8' });
    const resolved: unknown = JSON.parse(stdout);
    if (!resolved || typeof resolved !== 'object' || !('directory' in resolved) || typeof resolved.directory !== 'string' || !isAbsolute(resolved.directory)) {
        throw new Error('HQ returned an invalid workspace binding');
    }
    return { ...options, mcpSelection: undefined, environmentVariables: sessionArgs.length > 0 ? { ...options.environmentVariables, HQ_SESSION_OPTIONS: JSON.stringify(sessionOptions) } : options.environmentVariables, permissionMode: sessionOptions.permissionMode ?? options.permissionMode, profileId: undefined, directory: resolved.directory, backendTarget: { kind: 'builtInAgent', agentId: 'codex' }, codexBackendMode: 'appServer', experimentalCodexAcp: false, approvedNewDirectoryCreation: false };
}

export function resolveHQCodexInvocation(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Readonly<{ command: string; args: string[] }> {
    if (args.length !== 3 || args[0] !== 'app-server' || args[1] !== '--listen' || args[2] !== 'stdio://') {
        throw new Error('HQ server permits only isolated Codex app-server stdio execution');
    }
    const sessionOptions = env.HQ_SESSION_OPTIONS === undefined ? [] : ['--session-options', JSON.stringify(parseHQSessionOptions(env.HQ_SESSION_OPTIONS))];
    return { command: hqBinary(), args: ['runner', 'app-server', '--directory', cwd, '--preset', hqPreset(env), ...sessionOptions] };
}

export function assertHQExecutionBackend(backendId: string, target?: BackendTargetRefV1): void {
    if (!isHQServerMode()) return;
    if (backendId !== 'codex' || (target && (target.kind !== 'builtInAgent' || target.agentId !== 'codex'))) {
        throw new Error('HQ server supports isolated Codex execution only');
    }
}
