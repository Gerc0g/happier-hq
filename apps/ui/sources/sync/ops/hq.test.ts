import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHqWorktree, readHqCatalog } from './hq';

const rpc = vi.hoisted(() => vi.fn());
// The encrypted machine transport is the external boundary; commands and parsing stay real.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));

const target = { machineId: 'machine-1', company: 'chimera', product: 'aetheria', repo: 'Aetheria-AI', path: '/projects/AI' };
describe('HQ over the existing machine transport', () => {
    beforeEach(() => { rpc.mockReset(); });

    it('reads the machine-owned catalog without shell parsing', async () => {
        const catalog = { version: 1, root: '/projects', companies: [] };
        rpc.mockResolvedValue({ success: true, exitCode: 0, stdout: JSON.stringify(catalog), stderr: '' });
        expect(await readHqCatalog('machine-1', 'server-1')).toEqual(catalog);
        expect(rpc).toHaveBeenCalledWith(expect.objectContaining({
            serverId: 'server-1', machineId: 'machine-1', method: 'bash', payload: { argv: ['hq', 'ls', '--json'], cwd: '/' },
        }));
    });

    it('preserves task text as one argv argument and returns the HQ-created directory', async () => {
        rpc.mockResolvedValue({ success: true, exitCode: 0, stdout: '/projects/.worktrees/task-1\n', stderr: '' });
        const task = 'fix chat; $(touch /tmp/should-not-exist)';
        expect(await createHqWorktree(target, task, 'server-1')).toBe('/projects/.worktrees/task-1');
        expect(rpc).toHaveBeenCalledWith(expect.objectContaining({
            payload: { argv: ['hq', 'workspace', 'start', 'chimera', 'aetheria', 'Aetheria-AI', task], cwd: '/' },
        }));
    });

    it('does not treat failed or malformed output as an empty successful catalog', async () => {
        rpc.mockResolvedValueOnce({ success: false, exitCode: 127, stdout: '', stderr: 'hq unavailable' });
        await expect(readHqCatalog('machine-1', 'server-1')).rejects.toMatchObject({ kind: 'unavailable' });
        rpc.mockResolvedValueOnce({ success: true, exitCode: 0, stdout: '{}', stderr: '' });
        await expect(readHqCatalog('machine-1', 'server-1')).rejects.toMatchObject({ kind: 'invalidCatalog' });
    });

    it('preserves uncertainty when the transport returns no command result', async () => {
        rpc.mockResolvedValue(undefined);
        await expect(createHqWorktree(target, 'fix', 'server-1')).rejects.toMatchObject({ kind: 'unconfirmed' });
    });

    it('distinguishes an explicit rejection from an unconfirmed mutation', async () => {
        rpc.mockResolvedValue({ success: false, exitCode: 2, stdout: '', stderr: 'invalid task branch' });
        await expect(createHqWorktree(target, 'fix', 'server-1')).rejects.toMatchObject({ kind: 'commandFailed' });
    });

    it('does not retry a failed mutation or accept a non-path response', async () => {
        rpc.mockResolvedValueOnce({ success: false, exitCode: -1, stdout: '', stderr: 'timeout' });
        await expect(createHqWorktree(target, 'fix', 'server-1')).rejects.toMatchObject({ kind: 'unconfirmed' });
        expect(rpc).toHaveBeenCalledTimes(1);
        rpc.mockResolvedValueOnce({ success: true, exitCode: 0, stdout: 'unexpected log\n/path', stderr: '' });
        await expect(createHqWorktree(target, 'fix', 'server-1')).rejects.toMatchObject({ kind: 'unconfirmed' });
    });
});

it('sends the caller request identity and trusts only the anchored pre-effect marker', async () => {
    rpc.mockResolvedValueOnce({ success: false, exitCode: 2, stdout: '', stderr: 'Error: HQ_WORKTREE_NOT_CREATED: invalid task' });
    await expect(createHqWorktree(target, 'Fix bug', 'server-1', 'creation-1')).rejects.toMatchObject({ kind: 'commandFailed', creationNotStarted: true });
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ payload: { argv: ['hq', 'workspace', 'start', 'chimera', 'aetheria', 'Aetheria-AI', 'Fix bug', '--request-id', 'creation-1'], cwd: '/' } }));
    rpc.mockResolvedValueOnce({ success: false, exitCode: 2, stdout: '', stderr: 'context failed at /repo\nHQ_WORKTREE_NOT_CREATED:notes' });
    await expect(createHqWorktree(target, 'Fix bug', 'server-1', 'creation-1')).rejects.toMatchObject({ kind: 'commandFailed', creationNotStarted: false });
});
