import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';
installSessionShellCommonModuleMocks();
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));
describe('HQ runtime visibility', () => {
    beforeEach(() => rpc.mockReset());
    it('shows observed limits and failed task state and refreshes from the selected machine', async () => {
        rpc.mockResolvedValue({ v: 1, ok: true, result: { limits: { tasks: 2, perCompany: 1, memory: '2g', cpus: '1.5', pids: '256', diskBytes: 4294967296, diskEnforcement: 'watchdog' }, tasks: [{ id: 'task', state: 'git-conflict', startedAt: '2026-09-28T10:00:00Z', finishedAt: '2026-09-28T10:01:00Z', binding: { directory: '/repo', repoId: 'co/product/repo', preset: 'work' } }] } });
        const { HqRuntimePanel } = await import('./HqRuntimePanel');
        const screen = await renderScreen(<HqRuntimePanel target={{ machineId: 'machine', serverId: 'relay' }} active />);
        expect(screen.getTextContent()).toContain('co/product/repo');
        expect(screen.getTextContent()).toContain('Git');
        await screen.pressByTestIdAsync('hq-runtime-refresh');
        expect(rpc).toHaveBeenCalledTimes(2);
        expect(rpc.mock.calls[0][0]).toMatchObject({ machineId: 'machine', serverId: 'relay', payload: { operation: 'runtime.status' } });
    });
    it('labels ordinary and research tasks by their configured preset', async () => {
        rpc.mockResolvedValue({ v: 1, ok: true, result: {
            limits: { tasks: 2, perCompany: 1, memory: '2g', cpus: '1.5', pids: '256', diskBytes: 4294967296, diskEnforcement: 'watchdog' },
            tasks: ['ordinary', 'research'].map(preset => ({ id: preset, state: 'running', startedAt: '2026-09-28T10:00:00Z', binding: { directory: '/' + preset, preset } })),
        } });
        const { HqRuntimePanel } = await import('./HqRuntimePanel');
        const { t } = await import('@/text');
        const screen = await renderScreen(<HqRuntimePanel target={{ machineId: 'machine', serverId: 'relay' }} active />);
        expect(screen.getTextContent()).toContain(t('hq.routing.ordinary'));
        expect(screen.getTextContent()).toContain(t('hq.agent.research'));
    });
    it('does not read through an inactive screen', async () => {
        const { HqRuntimePanel } = await import('./HqRuntimePanel');
        await renderScreen(<HqRuntimePanel target={{ machineId: 'machine', serverId: 'relay' }} active={false} />);
        expect(rpc).not.toHaveBeenCalled();
    });
});
