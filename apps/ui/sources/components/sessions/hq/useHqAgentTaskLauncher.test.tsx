import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferred, renderHook, resetBrowserSessionDraftPersistenceForTest } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';
import { clearActiveUnsavedChangesGuard, setActiveUnsavedChangesGuard } from '@/utils/navigation/runGuardedNavigation';
import {
    configureSessionDraftRepository, getSessionDraftSnapshot, listNewSessionDraftProjections,
    readOrdinaryEntryDraftId, setOrdinaryEntryDraftId, writeNewSessionDraft,
} from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import { useHqAgentTaskLauncher } from './useHqAgentTaskLauncher';

installSessionShellCommonModuleMocks();
const boundary = vi.hoisted(() => ({ rpc: vi.fn(), accountScope: { serverId: 'server-1', accountId: 'account-1' }, machineOnline: true }));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: boundary.rpc }));
vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({ getActiveServerAccountScope: () => boundary.accountScope }));
const request = { scope: 'chimera/product/repo', kind: 'repo' as const, directory: '/projects/repo', itemId: 'purpose' };
const task = { version: 1, ...request, action: 'onboard', skill: 'onboard-agents-md', prompt: 'HQ prepared task: заполни контекст' };
const reply = () => ({ success: true, exitCode: 0, stdout: JSON.stringify(task), stderr: '' });
let accountNumber = 0;
const input = () => ({
    machineId: 'machine-1', serverId: 'server-1', scope: request.scope, accountScope: boundary.accountScope,
    available: true, active: true, isMachineAvailable: () => boundary.machineOnline, onNavigate: vi.fn(),
});

describe('HQ agent task handoff', () => {
    beforeEach(async () => {
        boundary.accountScope = { serverId: 'server-1', accountId: `hq-task-account-${++accountNumber}` };
        boundary.machineOnline = true;
        boundary.rpc.mockReset().mockResolvedValue(reply());
        clearActiveUnsavedChangesGuard();
        await resetBrowserSessionDraftPersistenceForTest();
        configureSessionDraftRepository({ syncEnabled: false });
    });
    afterEach(() => { clearActiveUnsavedChangesGuard(); vi.restoreAllMocks(); });

    it('seeds a fresh scoped durable draft and opens review without overwriting ordinary work or sending', async () => {
        const origin = input();
        const ordinaryId = '00000000-0000-4000-8000-000000000001';
        writeNewSessionDraft({ scope: origin.accountScope, draftId: ordinaryId, patch: { text: 'My unrelated unfinished request' }, materializationIntent: 'userEdit' });
        setOrdinaryEntryDraftId(origin.accountScope, ordinaryId);
        const previous = getSessionDraftSnapshot(origin.accountScope, { kind: 'newSession', draftId: ordinaryId });
        const hook = await renderHook(useHqAgentTaskLauncher, { initialProps: origin });
        await act(async () => { await hook.getCurrent().launch(request); });
        expect(origin.onNavigate).toHaveBeenCalledOnce();
        const route = origin.onNavigate.mock.calls[0][0];
        expect(route).toEqual({ pathname: '/new', params: { draftId: expect.any(String), machineId: origin.machineId, directory: request.directory, spawnServerId: origin.serverId } });
        expect(route.params.draftId).not.toBe(ordinaryId);
        const draft = getSessionDraftSnapshot(origin.accountScope, { kind: 'newSession', draftId: route.params.draftId });
        expect(draft).toMatchObject({ materialized: true, document: {
            composer: { text: { value: task.prompt } },
            target: { kind: 'newSession', authoring: {
                targetType: { value: 'new_session' }, machineId: { value: origin.machineId },
                serverId: { value: origin.serverId }, directory: { value: request.directory },
            } },
        } });
        expect(draft?.localSupplement.launchUserAttemptId).toBeUndefined();
        expect(getSessionDraftSnapshot(origin.accountScope, { kind: 'newSession', draftId: ordinaryId })).toBe(previous);
        expect(readOrdinaryEntryDraftId(origin.accountScope)).toBe(ordinaryId);
        expect(boundary.rpc.mock.calls.map(([call]) => call.payload.argv)).toEqual([
            ['hq', 'entity', 'task', request.scope, '--action', 'onboard', '--item', 'purpose', '--json'],
        ]);
    });

    it('keeps unsaved context and creates no draft when navigation after the read-only preparation is canceled', async () => {
        const origin = input();
        const isDirtyRef = { current: true };
        const onDiscard = vi.fn();
        setActiveUnsavedChangesGuard({ isDirtyRef, onDiscard, tag: 'hq', requestDecision: async () => 'keepEditing' });
        const hook = await renderHook(useHqAgentTaskLauncher, { initialProps: origin });
        await act(async () => { await hook.getCurrent().launch(request); });
        expect(isDirtyRef.current).toBe(true);
        expect(onDiscard).not.toHaveBeenCalled();
        expect(boundary.rpc).toHaveBeenCalledOnce();
        expect(origin.onNavigate).not.toHaveBeenCalled();
        expect(listNewSessionDraftProjections(origin.accountScope)).toHaveLength(0);
    });

    it.each(['task', 'storage'] as const)('preserves dirty context without asking to discard when %s preparation fails', async (failure) => {
        const origin = input();
        const isDirtyRef = { current: true };
        const onDiscard = vi.fn();
        const requestDecision = vi.fn(async () => 'discard' as const);
        setActiveUnsavedChangesGuard({ isDirtyRef, onDiscard, tag: 'hq', requestDecision });
        if (failure === 'task') boundary.rpc.mockRejectedValueOnce(new Error('Machine disconnected'));
        if (failure === 'storage') {
            const persistence = await import('@/sync/ops/sessionDrafts/sessionDraftPersistenceStorage');
            vi.spyOn(persistence, 'prepareSessionDraftPersistenceStorage').mockRejectedValueOnce(new Error('Draft storage unavailable'));
        }
        const hook = await renderHook(useHqAgentTaskLauncher, { initialProps: origin });
        await act(async () => { await hook.getCurrent().launch(request); });
        expect(requestDecision).not.toHaveBeenCalled();
        expect(onDiscard).not.toHaveBeenCalled();
        expect(isDirtyRef.current).toBe(true);
        expect(hook.getCurrent().failed).toBe(true);
        expect(origin.onNavigate).not.toHaveBeenCalled();
        expect(listNewSessionDraftProjections(origin.accountScope)).toHaveLength(0);
    });

    it('rechecks unsaved edits made during preparation and coalesces repeated clicks', async () => {
        const origin = input();
        const pending = createDeferred<ReturnType<typeof reply>>();
        boundary.rpc.mockReturnValue(pending.promise);
        const isDirtyRef = { current: false };
        setActiveUnsavedChangesGuard({ isDirtyRef, tag: 'hq', requestDecision: async () => 'keepEditing' });
        const hook = await renderHook(useHqAgentTaskLauncher, { initialProps: origin });
        let launch!: Promise<void>;
        await act(async () => { launch = hook.getCurrent().launch(request); });
        expect(hook.getCurrent().busy).toBe(true);
        await act(async () => { await hook.getCurrent().launch(request); });
        expect(boundary.rpc).toHaveBeenCalledOnce();
        isDirtyRef.current = true;
        await act(async () => { pending.resolve(reply()); await launch; });
        expect(isDirtyRef.current).toBe(true);
        expect(origin.onNavigate).not.toHaveBeenCalled();
        expect(listNewSessionDraftProjections(origin.accountScope)).toHaveLength(0);
        expect(hook.getCurrent().busy).toBe(false);
    });

    it.each(['account', 'machine', 'route', 'blur-return', 'unmount'] as const)('drops a late task after %s changes', async (change) => {
        const origin = input();
        const pending = createDeferred<ReturnType<typeof reply>>();
        boundary.rpc.mockReturnValue(pending.promise);
        const hook = await renderHook(useHqAgentTaskLauncher, { initialProps: origin });
        let launch!: Promise<void>;
        await act(async () => { launch = hook.getCurrent().launch(request); });
        if (change === 'account') boundary.accountScope = { ...origin.accountScope, accountId: 'different-account' };
        if (change === 'machine') boundary.machineOnline = false;
        if (change === 'route') await hook.rerender({ ...origin, scope: 'chimera/another/repo', machineId: 'machine-2' });
        if (change === 'blur-return') {
            await hook.rerender({ ...origin, active: false });
            await hook.rerender(origin);
        }
        if (change === 'unmount') await hook.unmount();
        await act(async () => { pending.resolve(reply()); await launch; });
        expect(origin.onNavigate).not.toHaveBeenCalled();
        expect(listNewSessionDraftProjections(origin.accountScope)).toHaveLength(0);
    });

    it('allows an explicit retry after a failed task read without creating a partial draft', async () => {
        const origin = input();
        boundary.rpc.mockResolvedValueOnce({ success: false, exitCode: 1, stdout: '', stderr: 'Skill unavailable' });
        const hook = await renderHook(useHqAgentTaskLauncher, { initialProps: origin });
        await act(async () => { await hook.getCurrent().launch(request); });
        expect(hook.getCurrent().failed).toBe(true);
        expect(listNewSessionDraftProjections(origin.accountScope)).toHaveLength(0);
        await act(async () => { await hook.getCurrent().launch(request); });
        expect(hook.getCurrent().failed).toBe(false);
        expect(origin.onNavigate).toHaveBeenCalledOnce();
        expect(listNewSessionDraftProjections(origin.accountScope)).toHaveLength(1);
    });
    it('reports local draft storage failure without navigating or changing existing drafts', async () => {
        const origin = input();
        const persistence = await import('@/sync/ops/sessionDrafts/sessionDraftPersistenceStorage');
        vi.spyOn(persistence, 'prepareSessionDraftPersistenceStorage').mockRejectedValueOnce(new Error('Draft storage unavailable'));
        const hook = await renderHook(useHqAgentTaskLauncher, { initialProps: origin });
        await act(async () => { await hook.getCurrent().launch(request); });
        expect(hook.getCurrent().failed).toBe(true);
        expect(origin.onNavigate).not.toHaveBeenCalled();
        expect(listNewSessionDraftProjections(origin.accountScope)).toHaveLength(0);
    });
});
