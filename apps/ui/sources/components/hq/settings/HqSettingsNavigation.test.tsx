import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';
import { clearActiveUnsavedChangesGuard, setActiveUnsavedChangesGuard } from '@/utils/navigation/runGuardedNavigation';

const boundary = vi.hoisted(() => ({ push: vi.fn() }));
installSessionShellCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit');
        return createExpoRouterMock({ router: boundary }).module;
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit');
        return createStorageModuleStub({ useActiveServerAccountScope: () => null });
    },
});
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
afterEach(() => { clearActiveUnsavedChangesGuard(); vi.clearAllMocks(); });

it('keeps general app settings accessible without a machine and guards leaving unsaved agent settings', async () => {
    const { default: HqSettingsScreen } = await import('@/app/(app)/hq/settings');
    const screen = await renderScreen(<HqSettingsScreen />);
    setActiveUnsavedChangesGuard({ isDirtyRef: { current: true }, tag: 'settings', requestDecision: async () => 'keepEditing' });
    await screen.pressByTestIdAsync('hq-app-settings');
    expect(boundary.push).not.toHaveBeenCalled();
    clearActiveUnsavedChangesGuard();
    await screen.pressByTestIdAsync('hq-app-settings');
    expect(boundary.push).toHaveBeenCalledWith('/settings');
});
