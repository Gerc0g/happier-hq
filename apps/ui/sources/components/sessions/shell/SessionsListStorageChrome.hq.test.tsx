import * as React from 'react';
import { View } from 'react-native';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from './sessionShellTestHelpers';
import { clearActiveUnsavedChangesGuard, setActiveUnsavedChangesGuard } from '@/utils/navigation/runGuardedNavigation';

const boundary = vi.hoisted(() => ({ push: vi.fn() }));
installSessionShellCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit');
        return createExpoRouterMock({ router: boundary }).module;
    },
});

const { SessionsListStorageChrome } = await import('./SessionsListStorageChrome');

function Navigation({ pathname = '/', directEnabled = true }: { pathname?: string; directEnabled?: boolean }) {
    const [storageKind, setStorageKind] = React.useState<'persisted' | 'direct'>('persisted');
    const [view, setView] = React.useState<'projects' | 'history'>('projects');
    return <>
        <SessionsListStorageChrome directSessionsEnabled={directEnabled} storageKind={storageKind} onSelectStorageKind={setStorageKind}
            hqNavigation={{ view, onSelectView: setView, pathname }} />
        <View testID={`content-${storageKind === 'direct' ? 'direct' : view}`} />
    </>;
}

beforeEach(() => { vi.clearAllMocks(); clearActiveUnsavedChangesGuard(); });
afterEach(() => clearActiveUnsavedChangesGuard());

it('selects projects, history and direct sessions from one row and returns from direct to persisted history', async () => {
    const screen = await renderScreen(<Navigation />);
    expect(screen.findByTestId('content-projects')).not.toBeNull();
    expect(screen.findByTestId('sessions-list-storage-tab:persisted')).toBeNull();
    await screen.pressByTestIdAsync('hq-view:history');
    expect(screen.findByTestId('content-history')).not.toBeNull();
    await screen.pressByTestIdAsync('hq-view:direct');
    expect(screen.findByTestId('content-direct')).not.toBeNull();
    expect(screen.findByTestId('direct-sessions-browse-button')).not.toBeNull();
    await screen.pressByTestIdAsync('hq-view:history');
    expect(screen.findByTestId('content-history')).not.toBeNull();
    expect(screen.findByTestId('direct-sessions-browse-button')).toBeNull();
    await screen.pressByTestIdAsync('hq-view:projects');
    expect(screen.findByTestId('content-projects')).not.toBeNull();
});

it('keeps both the selected view and settings route when unsaved changes are retained', async () => {
    const screen = await renderScreen(<Navigation pathname="/hq/settings" />);
    setActiveUnsavedChangesGuard({ isDirtyRef: { current: true }, tag: 'settings', requestDecision: async () => 'keepEditing' });
    await screen.pressByTestIdAsync('hq-view:direct');
    expect(screen.findByTestId('content-projects')).not.toBeNull();
    expect(boundary.push).not.toHaveBeenCalled();
    clearActiveUnsavedChangesGuard();
    await screen.pressByTestIdAsync('hq-view:history');
    expect(screen.findByTestId('content-history')).not.toBeNull();
    expect(boundary.push).toHaveBeenLastCalledWith('/');
});

it('keeps projects and history available when direct sessions are disabled', async () => {
    const screen = await renderScreen(<Navigation directEnabled={false} />);
    expect(screen.findByTestId('hq-view:direct')).toBeNull();
    await screen.pressByTestIdAsync('hq-view:history');
    expect(screen.findByTestId('content-history')).not.toBeNull();
});
