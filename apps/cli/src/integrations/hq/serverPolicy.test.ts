import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCodexCliInvocation } from '@/backends/codex/utils/resolveCodexCliInvocation';
import { resolveCodexAcpSpawn } from '@/backends/codex/acp/resolveCommand';
import { resolveCodexMcpServerSpawn } from '@/backends/codex/mcp/resolveCodexMcpServerSpawn';
import { assertHQExecutionBackend, authorizeHQSpawn, validateHQSpawnRequest } from './serverPolicy';
import { resolveHQSessionOptions } from './sessionOptions';

afterEach(() => vi.unstubAllEnvs());
describe('HQ server execution authority', () => {
  it('routes canonical Codex stdio launch through HQ even when a caller supplies its own binary and disables mode in its overlay', async () => {
    vi.stubEnv('HAPPIER_HQ_SERVER_MODE', '1');
    vi.stubEnv('HAPPIER_HQ_BINARY', '/trusted/hq');
    expect(await resolveCodexCliInvocation({ args: ['app-server', '--listen', 'stdio://'], cwd: '/srv/projects/acme/prod/repo', processEnv: { HAPPIER_HQ_SERVER_MODE: '0', HAPPIER_CODEX_APP_SERVER_BIN: '/untrusted/codex' }, overrideEnvVarKeys: ['HAPPIER_CODEX_APP_SERVER_BIN'] })).toEqual({ command: '/trusted/hq', args: ['runner', 'app-server', '--directory', '/srv/projects/acme/prod/repo', '--preset', 'work'] });
  });
  it('rejects the legacy MCP and host socket execution paths in server mode', async () => {
    vi.stubEnv('HAPPIER_HQ_SERVER_MODE', '1');
    expect(() => resolveCodexAcpSpawn()).toThrow('HQ');
    await expect(resolveCodexMcpServerSpawn()).rejects.toThrow('HQ');
    expect(() => assertHQExecutionBackend('claude')).toThrow('HQ');
    expect(() => assertHQExecutionBackend('customAcp', { kind: 'configuredAcpBackend', backendId: 'custom' })).toThrow('HQ');
    for (const args of [['mcp-server'], ['app-server', '--listen', 'unix:///tmp/host.sock'], ['exec', 'prompt']]) {
      await expect(resolveCodexCliInvocation({ args })).rejects.toThrow('HQ');
    }
  });
  it('rejects alternate providers, arbitrary child environment and external runtime auth', () => {
    vi.stubEnv('HAPPIER_HQ_SERVER_MODE', '1');
    expect(() => validateHQSpawnRequest({ directory: '/srv/projects/acme/prod/repo', backendTarget: { kind: 'builtInAgent', agentId: 'claude' } })).toThrow('Codex');
    expect(() => validateHQSpawnRequest({ directory: '/srv/projects/acme/prod/repo', environmentVariables: { HAPPIER_HQ_SERVER_MODE: '0' } })).toThrow('environment');
    expect(() => validateHQSpawnRequest({ directory: '/srv/projects/acme/prod/repo', connectedServices: { any: true } })).toThrow('HQ');
    expect(() => validateHQSpawnRequest({ directory: '/srv/projects/acme/prod/repo', environmentVariables: { HQ_PRESET: 'research' } })).not.toThrow();
  });
  it('accepts strictly typed per-session options and preserves the owner authentication boundary', async () => {
    vi.stubEnv('HAPPIER_HQ_SERVER_MODE', '1');
    const options = { v: 1 as const, model: 'session-model', effort: 'high', permissionMode: 'safe-yolo', mcpSelection: { v: 1 as const, managedServersEnabled: true, forceIncludeServerIds: ['docs'], forceExcludeServerIds: [] } };
    expect(() => validateHQSpawnRequest({ directory: '/srv/projects/acme/prod/repo', environmentVariables: { HQ_SESSION_OPTIONS: JSON.stringify(options) }, mcpSelection: options.mcpSelection })).not.toThrow();
    for (const override of [{ ...options, auth: {} }, { ...options, network: 'yes' }, { ...options, model: '../host-model' }, { ...options, permissionMode: 'unchecked' }]) {
      expect(() => validateHQSpawnRequest({ directory: '/srv/projects/acme/prod/repo', environmentVariables: { HQ_SESSION_OPTIONS: JSON.stringify(override) } })).toThrow('session');
    }
    vi.stubEnv('HAPPIER_HQ_BINARY', '/trusted/hq');
    expect(await resolveCodexCliInvocation({ args: ['app-server', '--listen', 'stdio://'], cwd: '/srv/projects/acme/prod/repo', processEnv: { HQ_SESSION_OPTIONS: JSON.stringify(options) } })).toEqual({ command: '/trusted/hq', args: ['runner', 'app-server', '--directory', '/srv/projects/acme/prod/repo', '--preset', 'work', '--session-options', JSON.stringify(options)] });
  });
  it('preflights session overrides with HQ and carries editable model, permissions and MCP into the child envelope', async () => {
    vi.stubEnv('HAPPIER_HQ_SERVER_MODE', '1');
    const directory = mkdtempSync(join(tmpdir(), 'happier-hq-options-'));
    try {
      const binary = join(directory, 'hq');
      // A real OS process boundary supplies the registered binding and checks
      // the exact preflight request; no internal policy helper is mocked.
      writeFileSync(binary, `#!/bin/sh
[ "$1" = runner ] && [ "$2" = resolve ] && [ "$7" = --session-options ] || exit 2
printf '%s' '{"directory":"/srv/projects/acme/prod/repo"}'
`, { mode: 0o700 });
      vi.stubEnv('HAPPIER_HQ_BINARY', binary);
      const mcpSelection = { v: 1 as const, managedServersEnabled: true, forceIncludeServerIds: ['docs'], forceExcludeServerIds: [] };
      const request = { directory: '/srv/projects/acme/prod/repo', modelId: 'chat-model', permissionMode: 'yolo' as const, mcpSelection, environmentVariables: { HQ_PRESET: 'work', HQ_SESSION_OPTIONS: JSON.stringify({ v: 1, effort: 'ultra' }) } };
      const authorized = await authorizeHQSpawn(request);
      expect(JSON.parse(authorized.environmentVariables?.HQ_SESSION_OPTIONS ?? '{}')).toEqual({ v: 1, effort: 'ultra', model: 'chat-model', permissionMode: 'yolo', mcpSelection });
      expect(authorized.mcpSelection).toBeUndefined();
      expect(authorized.codexBackendMode).toBe('appServer');
      expect(request.environmentVariables.HQ_SESSION_OPTIONS).toBe(JSON.stringify({ v: 1, effort: 'ultra' }));
      expect(request.mcpSelection).toEqual(mcpSelection);
      expect(resolveHQSessionOptions({ directory: request.directory, modelId: 'default' })).toEqual({ v: 1 });
      expect(resolveHQSessionOptions({ directory: request.directory, modelId: 'default', environmentVariables: { HQ_SESSION_OPTIONS: JSON.stringify({ v: 1, model: 'preset-model' }) } })).toEqual({ v: 1, model: 'preset-model' });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('preserves the predecessor non-server spawn contract', () => {
    vi.stubEnv('HAPPIER_HQ_SERVER_MODE', '0');
    expect(() => validateHQSpawnRequest({ directory: '/tmp/custom', backendTarget: { kind: 'builtInAgent', agentId: 'claude' }, environmentVariables: { ANYTHING: 'allowed' } })).not.toThrow();
  });
});
