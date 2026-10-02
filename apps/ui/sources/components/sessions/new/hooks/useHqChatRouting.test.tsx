import { act } from 'react-test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
import { createDeferred, renderHook } from '@/dev/testkit';
import { useHqChatRouting } from './useHqChatRouting';

vi.mock('@/platform/randomUUID', () => ({ randomUUID: () => 'creation-1' }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));
const preset = { model: 'model-work', effort: 'high', webSearch: 'live', network: true, instructions: '', skills: [], hooks: { sessionContext: false, inboxCapture: false }, mcp: [] };
const catalog = { version: 1, root: '/projects', companies: [{ slug: 'acme', path: '/projects/acme', products: [{ slug: 'app', path: '/projects/acme/app', repos: [{ name: 'web', path: '/projects/acme/app/web', worktrees: [{ id: 'fix', path: '/tasks/fix', branch: 'fix', state: 'active', task: 'Fix' }] }] }] }], research: { path: '/wiki/research' }, ordinary: { path: '/ordinary' } };
const snapshot = { settings: { version: 1, revision: 'r1', presets: { work: preset, research: { ...preset, model: 'model-research' }, ordinary: { ...preset, model: 'model-ordinary' } } }, skills: [] };
const input = { enabled: true, machineId: 'm1', serverId: 's1', accountId: 'a1', online: true, path: '/projects/acme' };
const reply = (request: { method: string }) => request.method === 'hq.control.v1'
    ? { v: 1, ok: true, result: snapshot }
    : { success: true, exitCode: 0, stdout: JSON.stringify(catalog), stderr: '' };
beforeEach(() => { rpc.mockReset(); rpc.mockImplementation(async request => reply(request)); });

it('restores the route from the draft path and selects that route’s authoritative preset', async () => {
    const hook = await renderHook(useHqChatRouting, { initialProps: input });
    expect(hook.getCurrent()).toMatchObject({ ready: false, target: { type: 'work' }, preset: { model: 'model-work' } });
    await hook.rerender({ ...input, path: '/wiki/research' });
    expect(hook.getCurrent()).toMatchObject({ ready: true, target: { type: 'research' }, preset: { model: 'model-research' } });
    await hook.rerender({ ...input, path: '/ordinary' });
    expect(hook.getCurrent()).toMatchObject({ ready: false, target: null });
    expect(rpc).toHaveBeenCalledTimes(2);
    await hook.rerender({ ...input, path: '/unregistered' });
    expect(hook.getCurrent().ready).toBe(false);
});

it('blocks offline or incomplete targets and drops stale data on account/machine changes', async () => {
    const hook = await renderHook(useHqChatRouting, { initialProps: input });
    const pending = createDeferred<unknown>();
    rpc.mockReturnValue(pending.promise);
    await hook.rerender({ ...input, machineId: 'm2', accountId: 'a2' });
    expect(hook.getCurrent()).toMatchObject({ ready: false, catalog: null, preset: null });
    await hook.rerender({ ...input, online: false });
    await act(async () => { pending.resolve({ v: 1, ok: true, result: snapshot }); });
    expect(hook.getCurrent().ready).toBe(false);
});

it('fails closed on unavailable settings and recovers through retry', async () => {
    rpc.mockRejectedValue(new Error('offline'));
    const hook = await renderHook(useHqChatRouting, { initialProps: input });
    expect(hook.getCurrent()).toMatchObject({ ready: false, error: true });
    rpc.mockImplementation(async request => reply(request));
    await act(async () => { hook.getCurrent().reload(); });
    expect(hook.getCurrent().ready).toBe(false);
});

it('requires a repository and named new worktree, or an existing worktree', async () => {
    const hook = await renderHook(useHqChatRouting, { initialProps: { ...input, type: 'work' as const, taskName: '', path: '/projects/acme/app/web' } });
    expect(hook.getCurrent().ready).toBe(false);
    await hook.rerender({ ...input, type: 'work', taskName: 'Fix bug', path: '/projects/acme/app/web' });
    expect(hook.getCurrent().ready).toBe(true);
    await hook.rerender({ ...input, type: 'work', taskName: '', path: '/tasks/fix' });
    expect(hook.getCurrent().ready).toBe(true);
});

it('shares worktree creation and persists its path before session launch', async () => {
    const selected = vi.fn();
    const hook = await renderHook(useHqChatRouting, { initialProps: { ...input, type: 'work' as const, taskName: 'Fix bug', path: '/projects/acme/app/web', onSelectPath: selected } });
    const deferred = createDeferred<unknown>();
    rpc.mockImplementation(request => request.payload?.argv?.[1] === 'workspace' ? deferred.promise : Promise.resolve(reply(request)));
    let first!: Promise<string>;
    let second!: Promise<string>;
    await act(async () => {
        first = hook.getCurrent().prepareLaunch();
        second = hook.getCurrent().prepareLaunch();
    });
    expect(first).toBe(second);
    await act(async () => {
        deferred.resolve({ success: true, exitCode: 0, stdout: '/tasks/new', stderr: '' });
        expect(await first).toBe('/tasks/new');
    });
    expect(selected).toHaveBeenCalledWith('/tasks/new');
    expect(rpc.mock.calls.filter(([request]) => request.payload?.argv?.[1] === 'workspace')).toHaveLength(1);
});

it('reconciles a lost create response without emitting another worktree command', async () => {
    const selected = vi.fn();
    const hook = await renderHook(useHqChatRouting, { initialProps: { ...input, type: 'work' as const, taskName: 'Fix bug', path: '/projects/acme/app/web', onSelectPath: selected } });
    const refreshed = structuredClone(catalog);
    refreshed.companies[0].products[0].repos[0].worktrees.push({ id: 'new', path: '/tasks/new', branch: 'agent/fix', state: 'active', task: 'fix-bug', creationRequestId: 'creation-1' } as typeof refreshed.companies[0]['products'][0]['repos'][0]['worktrees'][number]);
    rpc.mockImplementation(async request => request.payload?.argv?.[1] === 'workspace'
        ? Promise.reject(new Error('reply lost'))
        : request.method === 'bash' ? { success: true, exitCode: 0, stdout: JSON.stringify(refreshed), stderr: '' } : reply(request));
    await act(async () => { expect(await hook.getCurrent().prepareLaunch()).toBe('/tasks/new'); });
    await act(async () => { expect(await hook.getCurrent().prepareLaunch()).toBe('/tasks/new'); });
    expect(selected).toHaveBeenCalledWith('/tasks/new');
    expect(rpc.mock.calls.filter(([request]) => request.payload?.argv?.[1] === 'workspace')).toHaveLength(1);
});

it('restores a durable issuance fence and only reconciles after a browser reload', async () => {
    const refreshed = structuredClone(catalog);
    refreshed.companies[0].products[0].repos[0].worktrees.push({ id: 'new', path: '/tasks/new', branch: 'agent/fix', state: 'active', task: 'fix-bug', creationRequestId: 'creation-1' } as typeof refreshed.companies[0]['products'][0]['repos'][0]['worktrees'][number]);
    rpc.mockImplementation(async request => request.method === 'bash'
        ? { success: true, exitCode: 0, stdout: JSON.stringify(refreshed), stderr: '' } : reply(request));
    const fence = vi.fn();
    const hook = await renderHook(useHqChatRouting, { initialProps: { ...input, type: 'work' as const, taskName: 'Fix bug', path: '/projects/acme/app/web', creationAttempt: { machineId: 'm1', serverId: 's1', repoPath: '/projects/acme/app/web', taskName: 'Fix bug', requestId: 'creation-1', beforeIds: ['fix'] }, onCreationAttemptChange: fence } });
    await act(async () => { expect(await hook.getCurrent().prepareLaunch()).toBe('/tasks/new'); });
    expect(fence).toHaveBeenCalledWith(null);
    expect(rpc.mock.calls.filter(([request]) => request.payload?.argv?.[1] === 'workspace')).toHaveLength(0);
});

it('never re-emits an unconfirmed creation, and allows later catalog reconciliation', async () => {
    const hook = await renderHook(useHqChatRouting, { initialProps: { ...input, type: 'work' as const, taskName: 'Fix bug', path: '/projects/acme/app/web' } });
    rpc.mockImplementation(async request => request.payload?.argv?.[1] === 'workspace' ? Promise.reject(new Error('reply lost')) : reply(request));
    await act(async () => { await expect(hook.getCurrent().prepareLaunch()).rejects.toThrow('not confirmed'); });
    await act(async () => { await expect(hook.getCurrent().prepareLaunch()).rejects.toThrow('not confirmed'); });
    expect(rpc.mock.calls.filter(([request]) => request.payload?.argv?.[1] === 'workspace')).toHaveLength(1);
});

it('clears the issuance fence on a definitive rejection so a corrected task can launch', async () => {
    const fence = vi.fn();
    const hook = await renderHook(useHqChatRouting, { initialProps: { ...input, type: 'work' as const, taskName: 'Invalid task', path: '/projects/acme/app/web', onCreationAttemptChange: fence } });
    rpc.mockImplementation(async request => request.payload?.argv?.[1] === 'workspace'
        ? { success: false, exitCode: 2, stdout: '', stderr: 'HQ_WORKTREE_NOT_CREATED: invalid branch' } : reply(request));
    await act(async () => { await expect(hook.getCurrent().prepareLaunch()).rejects.toMatchObject({ kind: 'commandFailed' }); });
    expect(fence).toHaveBeenLastCalledWith(null);
    await hook.rerender({ ...input, type: 'work', taskName: 'Valid task', path: '/projects/acme/app/web', onCreationAttemptChange: fence });
    rpc.mockImplementation(async request => request.payload?.argv?.[1] === 'workspace'
        ? { success: true, exitCode: 0, stdout: '/tasks/new', stderr: '' } : reply(request));
    await act(async () => { expect(await hook.getCurrent().prepareLaunch()).toBe('/tasks/new'); });
});

it('never reconciles or replays a restored attempt against another machine', async () => {
    const hook = await renderHook(useHqChatRouting, { initialProps: { ...input, type: 'work' as const, taskName: 'Fix bug', path: '/projects/acme/app/web', creationAttempt: { machineId: 'another-machine', serverId: 's1', repoPath: '/projects/acme/app/web', taskName: 'Fix bug', requestId: 'creation-1', beforeIds: ['fix'] } } });
    rpc.mockClear();
    await expect(hook.getCurrent().prepareLaunch()).rejects.toThrow('previous');
    expect(rpc).not.toHaveBeenCalled();
});

it('preserves an explicitly refused setup even when its worktree was created, without duplicating it', async () => {
    const selected = vi.fn();
    const fence = vi.fn();
    const hook = await renderHook(useHqChatRouting, { initialProps: { ...input, type: 'work' as const, taskName: 'Fix bug', path: '/projects/acme/app/web', onSelectPath: selected, onCreationAttemptChange: fence } });
    const refreshed = structuredClone(catalog);
    refreshed.companies[0].products[0].repos[0].worktrees.push({ id: 'new', path: '/tasks/new', branch: 'agent/fix', state: 'active', task: 'fix-bug', creationRequestId: 'creation-1' } as typeof refreshed.companies[0]['products'][0]['repos'][0]['worktrees'][number]);
    rpc.mockImplementation(async request => request.payload?.argv?.[1] === 'workspace'
        ? { success: false, exitCode: 1, stdout: '', stderr: 'context requires repair' }
        : request.method === 'bash' ? { success: true, exitCode: 0, stdout: JSON.stringify(refreshed), stderr: '' } : reply(request));
    await act(async () => { await expect(hook.getCurrent().prepareLaunch()).rejects.toThrow('context requires repair'); });
    expect(selected).toHaveBeenCalledWith('/tasks/new');
    expect(fence).toHaveBeenLastCalledWith(null);
    await hook.rerender({ ...input, type: 'work', taskName: 'Fix bug', path: '/tasks/new', onSelectPath: selected, onCreationAttemptChange: fence });
    expect(await hook.getCurrent().prepareLaunch()).toBe('/tasks/new');
    expect(rpc.mock.calls.filter(([request]) => request.payload?.argv?.[1] === 'workspace')).toHaveLength(1);
});

it('waits for durable creation fencing before issuing HQ and fails without issuance on persistence errors', async () => {
    const persisted = createDeferred<void>();
    const fence = vi.fn(async (attempt: unknown) => { if (attempt) await persisted.promise; });
    const props = { ...input, draftId: 'draft-a', type: 'work' as const, taskName: 'Fix bug', path: '/projects/acme/app/web', onCreationAttemptChange: fence };
    const hook = await renderHook(useHqChatRouting, { initialProps: props });
    rpc.mockImplementation(async request => request.payload?.argv?.[1] === 'workspace' ? { success: true, exitCode: 0, stdout: '/tasks/new', stderr: '' } : reply(request));
    let result!: Promise<string>;
    await act(async () => { result = hook.getCurrent().prepareLaunch(); });
    expect(rpc.mock.calls.filter(([request]) => request.payload?.argv?.[1] === 'workspace')).toHaveLength(0);
    await act(async () => { persisted.resolve(); await result; });
    await hook.rerender({ ...props, draftId: 'draft-b', onCreationAttemptChange: vi.fn(async (attempt: unknown) => { if (attempt) throw new Error('disk failed'); }) });
    await act(async () => { await expect(hook.getCurrent().prepareLaunch()).rejects.toThrow('disk failed'); });
    expect(rpc.mock.calls.filter(([request]) => request.payload?.argv?.[1] === 'workspace')).toHaveLength(1);
});

it('does not publish a worktree into another draft and creates independently there', async () => {
    const selected = vi.fn();
    const pending = createDeferred<unknown>();
    const props = { ...input, draftId: 'draft-a', type: 'work' as const, taskName: 'Fix bug', path: '/projects/acme/app/web', onSelectPath: selected };
    const hook = await renderHook(useHqChatRouting, { initialProps: props });
    rpc.mockImplementation(request => request.payload?.argv?.[1] === 'workspace' ? pending.promise : Promise.resolve(reply(request)));
    let first!: Promise<string>;
    await act(async () => { first = hook.getCurrent().prepareLaunch(); });
    await hook.rerender({ ...props, draftId: 'draft-b' });
    await act(async () => { pending.resolve({ success: true, exitCode: 0, stdout: '/tasks/new', stderr: '' }); await expect(first).rejects.toThrow('context changed'); });
    expect(selected).not.toHaveBeenCalled();
    await act(async () => { expect(await hook.getCurrent().prepareLaunch()).toBe('/tasks/new'); });
    expect(rpc.mock.calls.filter(([request]) => request.payload?.argv?.[1] === 'workspace')).toHaveLength(2);
});
