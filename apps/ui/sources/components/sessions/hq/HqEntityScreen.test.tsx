import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, resetBrowserSessionDraftPersistenceForTest } from '@/dev/testkit';
import { createHqEntityFixture } from '@/dev/testkit/fixtures/hqEntityFixtures';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';

const boundary = vi.hoisted(() => ({
    rpc: vi.fn(),
    push: vi.fn(),
    accountScope: { serverId: 'server-1', accountId: 'account-1' },
    params: { machineId: 'machine-1', serverId: 'server-1', scope: 'chimera/product/repo' },
}));
installSessionShellCommonModuleMocks({
    storage: async () => {
        const { createStorageModuleStub, createMachineFixture } = await import('@/dev/testkit');
        return createStorageModuleStub({
            useActiveServerAccountScope: () => boundary.accountScope,
            useLaunchSelectionMachines: () => [createMachineFixture({ id: 'machine-1', activeAt: Date.now() })],
            storage: { getState: () => ({ machines: { 'machine-1': createMachineFixture({ id: 'machine-1', activeAt: Date.now() }) } }) },
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit');
        return createExpoRouterMock({ params: () => boundary.params, router: { push: boundary.push } }).module;
    },
});
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: boundary.rpc }));
vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({ getActiveServerAccountScope: () => boundary.accountScope }));

describe('HQ entity route', () => {
    beforeEach(() => {
        boundary.rpc.mockReset().mockResolvedValue({ success: true, exitCode: 0, stdout: JSON.stringify(createHqEntityFixture()), stderr: '' });
        boundary.push.mockReset();
        boundary.accountScope = { serverId: 'server-1', accountId: 'account-1' };
        vi.stubEnv('EXPO_PUBLIC_HAPPIER_HQ_ENABLED', '1');
    });
    afterEach(() => vi.unstubAllEnvs());
    it('does not expose the entity card or issue RPCs when the web build flag is disabled', async () => {
        vi.stubEnv('EXPO_PUBLIC_HAPPIER_HQ_ENABLED', '0');
        const { default: Screen } = await import('@/app/(app)/hq/entity');
        const screen = await renderScreen(<Screen />);
        expect(boundary.rpc).not.toHaveBeenCalled();
        expect(Boolean(screen.findByTestId('hq-entity-card'))).toBe(false);
    });
    it('refuses a machine from another account server and loads only after the active scope matches', async () => {
        boundary.accountScope = { serverId: 'server-2', accountId: 'account-2' };
        const { default: Screen } = await import('@/app/(app)/hq/entity');
        const screen = await renderScreen(<Screen />);
        expect(boundary.rpc).not.toHaveBeenCalled();
        expect(screen.findByTestId('hq-entity-offline')).not.toBeNull();
        boundary.accountScope = { serverId: 'server-1', accountId: 'account-1' };
        await screen.update(<Screen />);
        expect(boundary.rpc).toHaveBeenCalledOnce();
        expect(boundary.rpc.mock.calls[0][0]).toMatchObject({ serverId: 'server-1', machineId: 'machine-1' });
    });
    it('opens the normal composer from a manual onboarding item with a scoped prepared draft', async () => {
        await resetBrowserSessionDraftPersistenceForTest();
        const repository = await import('@/sync/ops/sessionDrafts/sessionDraftRepository');
        repository.configureSessionDraftRepository({ syncEnabled: false });
        const card = createHqEntityFixture({ agentActions: [{ id: 'onboard', skill: 'onboard-agents-md' }] });
        const task = { version: 1, scope: card.scope, kind: card.kind, directory: card.path, action: 'onboard', skill: 'onboard-agents-md', itemId: 'purpose', prompt: 'HQ task for this entity' };
        boundary.rpc.mockImplementation(async ({ payload }) => ({ success: true, exitCode: 0, stdout: JSON.stringify(payload.argv[2] === 'task' ? task : card), stderr: '' }));
        const { default: Screen } = await import('@/app/(app)/hq/entity');
        const screen = await renderScreen(<Screen />);
        await screen.pressByTestIdAsync('hq-entity-tab:onboarding');
        await screen.pressByTestIdAsync('hq-agent-onboard-purpose');
        await vi.waitFor(() => expect(boundary.push).toHaveBeenCalledOnce());
        const route = boundary.push.mock.calls[0][0];
        expect(route).toEqual({ pathname: '/new', params: { draftId: expect.any(String), machineId: 'machine-1', spawnServerId: 'server-1', directory: card.path } });
        expect(repository.getSessionDraftSnapshot(boundary.accountScope, { kind: 'newSession', draftId: route.params.draftId })?.document.composer.text.value).toBe(task.prompt);
        expect(boundary.rpc.mock.calls.map(([call]) => call.payload.argv[2])).toEqual(['show', 'task']);
    });
});
