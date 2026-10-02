import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';
import { useActiveUnsavedChangesGuard } from '@/utils/navigation/useActiveUnsavedChangesGuard';

const boundary = vi.hoisted(() => ({ online: true, confirm: vi.fn(), machines: [] as unknown[] }));
installSessionShellCommonModuleMocks({
    storage: async () => {
        const { createStorageModuleStub, createMachineFixture } = await import('@/dev/testkit');
        return createStorageModuleStub({ useActiveServerAccountScope: () => ({ serverId: 's', accountId: 'a' }), useLaunchSelectionMachines: () => [createMachineFixture({ id: 'm1', active: boundary.online, activeAt: boundary.online ? Date.now() : 0 }), createMachineFixture({ id: 'm2', active: true, activeAt: Date.now() })] });
    },
    router: async () => { const { createExpoRouterMock } = await import('@/dev/testkit'); return createExpoRouterMock({ params: {} }).module; },
});
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
const navigation = {};
function Draft({ machineId, active }: { machineId: string; active: boolean }) {
    const [value, setValue] = React.useState('');
    const dirty = React.useRef(false); dirty.current = Boolean(value);
    const guard = React.useMemo(() => ({ isDirtyRef: dirty, requestDecision: boundary.confirm, tag: 'fixture' }), []);
    useActiveUnsavedChangesGuard({ navigation, guard });
    return React.createElement('TextInput', { testID: 'shell-draft', accessibilityLabel: machineId, editable: active, value, onChangeText: setValue });
}
beforeEach(() => { boundary.online = true; boundary.confirm.mockReset(); vi.stubEnv('EXPO_PUBLIC_HAPPIER_HQ_ENABLED', '1'); });
afterEach(() => vi.unstubAllEnvs());
it('retains a selected machine draft offline and guards explicit machine changes', async () => {
    const { HqScreenShell } = await import('./HqScreenShell');
    const view = () => <HqScreenShell title="Settings">{(target, active) => <Draft machineId={target.machineId} active={active} />}</HqScreenShell>;
    const screen = await renderScreen(view());
    await act(async () => { screen.changeTextByTestId('shell-draft', 'keep this'); });
    boundary.online = false;
    await screen.update(view());
    expect(screen.findByTestId('shell-draft')?.props.accessibilityLabel).toBe('m1');
    expect(screen.findByTestId('shell-draft')?.props.value).toBe('keep this');
    expect(screen.findByTestId('shell-draft')?.props.editable).toBe(false);
    boundary.confirm.mockResolvedValueOnce('keepEditing');
    await screen.pressByTestIdAsync('hq-machine-m2');
    expect(screen.findByTestId('shell-draft')?.props.value).toBe('keep this');
    boundary.confirm.mockResolvedValueOnce('discard');
    await screen.pressByTestIdAsync('hq-machine-m2');
    expect(screen.findByTestId('shell-draft')?.props.accessibilityLabel).toBe('m2');
    expect(screen.findByTestId('shell-draft')?.props.value).toBe('');
});
