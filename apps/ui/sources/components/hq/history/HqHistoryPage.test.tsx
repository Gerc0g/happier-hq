import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';

const boundary = vi.hoisted(() => ({ rpc: vi.fn() }));
installSessionShellCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit');
        const { createCapturingFlatListMock } = await import('@/dev/testkit/mocks/flashList');
        return createReactNativeWebMock(createCapturingFlatListMock({ renderItems: true }).module);
    },
    storage: async () => {
        const { createStorageModuleStub, createMachineFixture } = await import('@/dev/testkit');
        return createStorageModuleStub({
            useActiveServerAccountScope: () => ({ serverId: 's', accountId: 'a' }),
            useLaunchSelectionMachines: () => [createMachineFixture({ id: 'm', active: true, activeAt: Date.now() })],
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit');
        return createExpoRouterMock({ params: { company: 'acme' } }).module;
    },
});
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: boundary.rpc }));

beforeEach(() => {
    vi.stubEnv('EXPO_PUBLIC_HAPPIER_HQ_ENABLED', '1');
    boundary.rpc.mockReset().mockImplementation(async ({ payload }: { payload: { operation: string } }) => {
        if (payload.operation === 'knowledge.scopes') return { v: 1, ok: true, result: [{ kind: 'work' }, { kind: 'research' }, { kind: 'company', company: 'acme' }] };
        if (payload.operation === 'history.list') return { v: 1, ok: true, result: { threads: [], total: 0, nextOffset: null } };
        throw new Error(`Unexpected archive operation: ${payload.operation}`);
    });
});
afterEach(() => vi.unstubAllEnvs());

it('keeps scoped archive bookmarks and filters without requesting notes or memory jobs', async () => {
    const { default: ImportedHistoryRoute } = await import('@/app/(app)/hq/history');
    const screen = await renderScreen(<ImportedHistoryRoute />);
    expect(boundary.rpc).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'm', serverId: 's', payload: { v: 1, operation: 'history.list', args: { scope: { kind: 'company', company: 'acme' }, offset: 0 } } }));
    expect(screen.findByTestId('hq-history-scope:work:')).toBeNull();
    await screen.pressByTestIdAsync('hq-history-scope:personal:');
    expect(boundary.rpc).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { v: 1, operation: 'history.list', args: { scope: { kind: 'personal' }, offset: 0 } } }));
    expect(boundary.rpc.mock.calls.every(([request]) => ['knowledge.scopes', 'history.list'].includes(request.payload.operation))).toBe(true);
});
