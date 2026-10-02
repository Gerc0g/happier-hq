import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadHqChatType, saveHqChatType } from '@/sync/domains/state/persistence';
import { createDeferred, createMachineFixture, resetBrowserSessionDraftPersistenceForTest } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';
import { clearActiveUnsavedChangesGuard, setActiveUnsavedChangesGuard } from '@/utils/navigation/runGuardedNavigation';
import { configureSessionDraftRepository, getSessionDraftSnapshot, listNewSessionDraftProjections } from '@/sync/ops/sessionDrafts/sessionDraftRepository';
let prepareResearchSession: typeof import('./launchHqSession')['prepareResearchSession'];

installSessionShellCommonModuleMocks({ storage: async () => {
    const { createStorageModuleStub, createReactiveStorageStoreMock } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({ storage: createReactiveStorageStoreMock({}) });
} });
const boundary = vi.hoisted(() => ({ rpc: vi.fn(), scope: { serverId: 's', accountId: 'a' } }));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: boundary.rpc }));
vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({ getActiveServerAccountScope: () => boundary.scope }));
const result = { v: 1, ok: true, result: { directory: '/wiki/research', prompt: 'Research within the isolated workspace.' } };
let account = 0;
beforeEach(async () => {
    ({ prepareResearchSession } = await import('./launchHqSession'));
    boundary.scope = { serverId: 's', accountId: `research-${++account}` };
    boundary.rpc.mockReset().mockResolvedValue(result);
    clearActiveUnsavedChangesGuard();
    saveHqChatType('work');
    await resetBrowserSessionDraftPersistenceForTest();
    configureSessionDraftRepository({ syncEnabled: false });
    const { storage } = await import('@/sync/domains/state/storage');
    storage.setState({ machines: { m: createMachineFixture({ id: 'm', active: true, activeAt: Date.now() }) } });
});
afterEach(() => clearActiveUnsavedChangesGuard());
const input = () => ({ machineId: 'm', serverId: 's', isCurrent: () => true, navigate: vi.fn() });

describe('Research session preparation', () => {
    it('opens a fresh Codex draft in the HQ research directory with the scoped context', async () => {
        const launch = input();
        await prepareResearchSession(launch);
        expect(boundary.rpc).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'm', serverId: 's', payload: { v: 1, operation: 'knowledge.context', args: { scope: { kind: 'research' } } } }));
        expect(launch.navigate).toHaveBeenCalledOnce();
        expect(loadHqChatType()).toBe('research');
        const route = launch.navigate.mock.calls[0][0];
        const draft = getSessionDraftSnapshot(boundary.scope, { kind: 'newSession', draftId: route.params.draftId });
        expect(draft).toMatchObject({ document: { composer: { text: { value: result.result.prompt } }, target: { authoring: {
            agentId: { value: 'codex' }, directory: { value: '/wiki/research' }, machineId: { value: 'm' }, codexBackendMode: { value: 'appServer' },
        } } } });
    });
    it('does not leave unsaved edits or create a draft when navigation is declined', async () => {
        const launch = input();
        setActiveUnsavedChangesGuard({ isDirtyRef: { current: true }, tag: 'research', requestDecision: async () => 'keepEditing' });
        await prepareResearchSession(launch);
        expect(launch.navigate).not.toHaveBeenCalled();
        expect(loadHqChatType()).toBe('work');
        expect(listNewSessionDraftProjections(boundary.scope)).toHaveLength(0);
    });
    it('ignores late preparation after leaving the Research context', async () => {
        const launch = input();
        const pending = createDeferred<typeof result>();
        boundary.rpc.mockReturnValue(pending.promise);
        let current = true;
        launch.isCurrent = () => current;
        const preparation = prepareResearchSession(launch);
        current = false;
        pending.resolve(result);
        await preparation;
        expect(launch.navigate).not.toHaveBeenCalled();
        expect(listNewSessionDraftProjections(boundary.scope)).toHaveLength(0);
    });
    it('never carries a prepared Research context into another account on the same relay', async () => {
        const launch = input();
        const originScope = boundary.scope;
        const pending = createDeferred<typeof result>();
        boundary.rpc.mockReturnValue(pending.promise);
        const preparation = prepareResearchSession(launch);
        boundary.scope = { ...boundary.scope, accountId: 'new-owner' };
        pending.resolve(result);
        await preparation;
        expect(launch.navigate).not.toHaveBeenCalled();
        expect(listNewSessionDraftProjections(originScope)).toHaveLength(0);
        expect(listNewSessionDraftProjections(boundary.scope)).toHaveLength(0);
    });

});
