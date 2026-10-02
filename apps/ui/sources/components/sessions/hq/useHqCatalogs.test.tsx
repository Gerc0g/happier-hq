import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferred, createMachineFixture, flushHookEffects, renderHook } from '@/dev/testkit';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { useHqCatalogs } from './useHqCatalogs';

const rpc = vi.hoisted(() => vi.fn());
// Only encrypted machine transport is replaced; HQ parsing and presence stay real.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));

const scope: ServerAccountScope = { serverId: 'server-1', accountId: 'account-1' };
const reply = (root = '/projects') => ({ success: true, exitCode: 0, stdout: JSON.stringify({ version: 1, root, companies: [] }), stderr: '' });
type Reply = ReturnType<typeof reply>;
type Input = Parameters<typeof useHqCatalogs>[0];
const online = (id = 'machine-1') => createMachineFixture({ id, activeAt: Date.now() });

describe('useHqCatalogs', () => {
    beforeEach(() => { rpc.mockReset(); });

    it('loads only visible online machines, stays stable on heartbeats, and reads newly online machines', async () => {
        const machine = online();
        const offline = createMachineFixture({ id: 'offline', active: true, activeAt: 1 });
        const revoked = { ...online('revoked'), revokedAt: Date.now() };
        rpc.mockResolvedValue(reply());
        const initial: Input = { scope, machines: [machine, offline, revoked], active: false };
        const hook = await renderHook(useHqCatalogs, { initialProps: initial });
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(rpc).not.toHaveBeenCalled();

        await hook.rerender({ ...initial, active: true });
        expect(rpc.mock.calls.map(([request]) => request.machineId)).toEqual(['machine-1']);
        expect(hook.getCurrent().catalogs.map(item => item.machineId)).toEqual(['machine-1']);
        const { refresh, catalogs } = hook.getCurrent();
        await hook.rerender({ ...initial, active: true, machines: [{ ...machine, updatedAt: Date.now() }, offline, revoked] });
        expect(hook.getCurrent().refresh).toBe(refresh);
        expect(hook.getCurrent().catalogs).toBe(catalogs);
        expect(rpc).toHaveBeenCalledTimes(1);

        await hook.rerender({ ...initial, active: true, machines: [machine, online('offline'), revoked] });
        expect(rpc.mock.calls.map(([request]) => request.machineId)).toEqual(['machine-1', 'offline']);
        await hook.rerender(initial);
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(rpc).toHaveBeenCalledTimes(2);
        expect(hook.getCurrent().loading).toBe(false);
    });

    it('shares in-flight reads between consumers and refreshes, but never caches a settled result globally', async () => {
        const pending = createDeferred<Reply>();
        rpc.mockReturnValueOnce(pending.promise).mockResolvedValue(reply('/refreshed'));
        const initial: Input = { scope, machines: [online()], active: true };
        const first = await renderHook(useHqCatalogs, { initialProps: initial });
        const second = await renderHook(useHqCatalogs, { initialProps: initial });
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(first.getCurrent().loading).toBe(true);
        expect(second.getCurrent().loading).toBe(true);
        await act(async () => {
            const refresh = Promise.all([first.getCurrent().refresh(), second.getCurrent().refresh()]);
            pending.resolve(reply());
            await refresh;
        });
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(first.getCurrent().catalogs).toEqual(second.getCurrent().catalogs);
        expect(first.getCurrent().catalogs[0]?.catalog.root).toBe('/projects');
        expect(second.getCurrent().loading).toBe(false);
        const third = await renderHook(useHqCatalogs, { initialProps: initial });
        expect(rpc).toHaveBeenCalledTimes(2);
        expect(third.getCurrent().catalogs[0]?.catalog.root).toBe('/refreshed');
    });

    it.each([
        { serverId: 'server-2', accountId: 'account-1' },
        { serverId: 'server-1', accountId: 'account-2' },
    ])('clears old scope synchronously and ignores late responses when switching to %j', async (nextScope) => {
        const stale = createDeferred<Reply>();
        const next = createDeferred<Reply>();
        rpc.mockResolvedValueOnce(reply('/old')).mockReturnValueOnce(stale.promise).mockReturnValueOnce(next.promise);
        const seen: Array<{ scope: ServerAccountScope | null; roots: string[] }> = [];
        const initial: Input = { scope, machines: [online()], active: true };
        const hook = await renderHook((props: Input) => {
            const result = useHqCatalogs(props);
            seen.push({ scope: props.scope, roots: result.catalogs.map(item => item.catalog.root) });
            return result;
        }, { initialProps: initial });
        expect(hook.getCurrent().catalogs[0]?.catalog.root).toBe('/old');
        let oldRefresh!: Promise<void>;
        await act(async () => { oldRefresh = hook.getCurrent().refresh(); });
        await hook.rerender({ ...initial, scope: nextScope });
        expect(seen.filter(value => value.scope === nextScope).every(value => value.roots.length === 0)).toBe(true);
        expect(rpc).toHaveBeenCalledTimes(3);
        await act(async () => { next.resolve(reply('/new')); });
        await flushHookEffects();
        expect(hook.getCurrent().catalogs[0]?.catalog.root).toBe('/new');
        await act(async () => { stale.resolve(reply('/stale')); await oldRefresh; });
        expect(hook.getCurrent().catalogs[0]?.catalog.root).toBe('/new');
        await hook.rerender({ ...initial, scope: null });
        expect(hook.getCurrent()).toMatchObject({ catalogs: [], failedMachineIds: [], loading: false });
    });

    it('preserves last-known catalogs on a transient failure and clears failure on explicit recovery', async () => {
        rpc.mockResolvedValueOnce(reply('/known')).mockRejectedValueOnce(new Error('disconnected')).mockResolvedValue(reply('/recovered'));
        const hook = await renderHook(useHqCatalogs, { initialProps: { scope, machines: [online()], active: true } });
        const known = hook.getCurrent().catalogs;
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().catalogs).toBe(known);
        expect(hook.getCurrent().failedMachineIds).toEqual(['machine-1']);
        expect(hook.getCurrent().loading).toBe(false);
        expect(rpc).toHaveBeenCalledTimes(2);
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().catalogs[0]?.catalog.root).toBe('/recovered');
        expect(hook.getCurrent().failedMachineIds).toEqual([]);
    });

    it('prunes removed machines immediately and ignores their pending responses', async () => {
        const pending = createDeferred<Reply>();
        rpc.mockResolvedValueOnce(reply('/first')).mockReturnValueOnce(pending.promise);
        const initial: Input = { scope, machines: [online('first'), online('second')], active: true };
        const seen: Array<{ machineCount: number; catalogCount: number }> = [];
        const hook = await renderHook((props: Input) => {
            const result = useHqCatalogs(props);
            seen.push({ machineCount: props.machines.length, catalogCount: result.catalogs.length });
            return result;
        }, { initialProps: initial });
        expect(hook.getCurrent().catalogs.map(item => item.machineId)).toEqual(['first']);
        expect(hook.getCurrent().loading).toBe(true);
        await hook.rerender({ ...initial, machines: [] });
        expect(seen.filter(value => value.machineCount === 0).every(value => value.catalogCount === 0)).toBe(true);
        await act(async () => { pending.resolve(reply('/removed')); });
        await flushHookEffects();
        expect(hook.getCurrent()).toMatchObject({ catalogs: [], failedMachineIds: [], loading: false });
        expect(rpc).toHaveBeenCalledTimes(2);
    });
});
