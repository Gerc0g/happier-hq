import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferred, renderHook } from '@/dev/testkit';
import { createHqEntityFixture } from '@/dev/testkit/fixtures/hqEntityFixtures';
import { useHqEntity } from './useHqEntity';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));
const card = createHqEntityFixture();
const reply = (value = card) => ({ success: true, exitCode: 0, stdout: JSON.stringify(value), stderr: '' });
const input = { machineId: 'machine-1', serverId: 'server-1', scope: card.scope, available: true, active: true };

describe('selected HQ entity lifecycle', () => {
    beforeEach(() => rpc.mockReset());
    it('does not load hidden/offline cards and preserves dirty text across an explicit refresh', async () => {
        rpc.mockResolvedValueOnce(reply()).mockResolvedValue(reply({ ...card, document: { ...card.document, content: 'remote change', revision: 'revision-2' } }));
        const hook = await renderHook(useHqEntity, { initialProps: { ...input, active: false } });
        expect(rpc).not.toHaveBeenCalled();
        await hook.rerender(input);
        hook.getCurrent().draft.setState({ content: 'my draft' });
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().draft.getState().content).toBe('my draft');
        expect(hook.getCurrent().card?.document.content).toBe('remote change');
        await hook.rerender({ ...input, available: false });
        expect(hook.getCurrent().card).not.toBeNull();
        expect(hook.getCurrent().canWrite).toBe(false);
    });
    it('keeps a conflicted draft, fences new writes until refresh, and never retries the mutation', async () => {
        rpc.mockResolvedValueOnce(reply()).mockResolvedValueOnce({ success: false, exitCode: 1, stdout: '', stderr: 'HQ_ENTITY_REVISION_CONFLICT' }).mockResolvedValue(reply({ ...card, document: { ...card.document, revision: 'revision-2' } }));
        const hook = await renderHook(useHqEntity, { initialProps: input });
        hook.getCurrent().draft.setState({ content: 'my draft' });
        await act(async () => { await hook.getCurrent().update({ content: 'my draft' }); });
        expect(hook.getCurrent().error).toBe('conflict');
        expect(hook.getCurrent().draft.getState().content).toBe('my draft');
        await act(async () => { await hook.getCurrent().update({ content: 'my draft' }); });
        expect(rpc).toHaveBeenCalledTimes(2);
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().canWrite).toBe(true);
        expect(hook.getCurrent().draft.getState().content).toBe('my draft');
    });
    it('shares refresh requests and leaves no pending state after disconnect', async () => {
        const pending = createDeferred<ReturnType<typeof reply>>();
        rpc.mockReturnValue(pending.promise);
        const hook = await renderHook(useHqEntity, { initialProps: input });
        let refresh!: Promise<void>;
        await act(async () => { refresh = hook.getCurrent().refresh(); });
        expect(rpc).toHaveBeenCalledTimes(1);
        await hook.rerender({ ...input, available: false });
        expect(hook.getCurrent().loading).toBe(false);
        await act(async () => { pending.resolve(reply()); await refresh; });
        expect(hook.getCurrent().card).toBeNull();
    });
});
