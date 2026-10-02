import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearActiveUnsavedChangesGuard, setActiveUnsavedChangesGuard } from '@/utils/navigation/runGuardedNavigation';
import { renderHook } from '@/dev/testkit';
import { installNavigationShellCommonModuleMocks } from '../navigationShellTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const routerPushSpy = vi.hoisted(() => vi.fn());
const shellFeatureState = vi.hoisted(() => ({
    friendsEnabled: false,
    inboxAvailable: false,
    inboxHasContent: false,
}));

installNavigationShellCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: { push: routerPushSpy },
        }).module;
    },
    storage: async (importOriginal) => {
        const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createPartialStorageModuleMock(importOriginal, {
            useFriendRequestCount: () => 0,
        });
    },
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
    Octicons: 'Octicons',
}));

vi.mock('@/hooks/inbox/useInboxHasContent', () => ({
    useInboxHasContent: () => shellFeatureState.inboxHasContent,
}));

vi.mock('@/hooks/inbox/useInboxAvailable', () => ({
    useInboxAvailable: () => shellFeatureState.inboxAvailable,
}));

vi.mock('@/hooks/server/useFriendsEnabled', () => ({
    useFriendsEnabled: () => shellFeatureState.friendsEnabled,
}));

afterEach(() => { vi.unstubAllEnvs(); clearActiveUnsavedChangesGuard(); vi.clearAllMocks(); });

describe('useSidebarHeaderActions', () => {
    it('opens HQ settings from both header presentations and honors unsaved changes', async () => {
        vi.stubEnv('EXPO_PUBLIC_HAPPIER_HQ_ENABLED', '1');
        const { useSidebarHeaderActions } = await import('./useSidebarHeaderActions');
        const hook = await renderHook(() => useSidebarHeaderActions());
        const settings = [hook.getCurrent().headerActions, hook.getCurrent().topUtilityActions]
            .map(actions => actions.find(action => action.id === 'settings')!);
        setActiveUnsavedChangesGuard({ isDirtyRef: { current: true }, tag: 'settings', requestDecision: async () => 'keepEditing' });
        for (const action of settings) action.onPress?.();
        await Promise.resolve();
        expect(routerPushSpy).not.toHaveBeenCalled();
        clearActiveUnsavedChangesGuard();
        for (const action of settings) action.onPress?.();
        expect(routerPushSpy.mock.calls).toEqual([['/hq/settings'], ['/hq/settings']]);
    });

    it('keeps ordinary settings when HQ is disabled', async () => {
        vi.stubEnv('EXPO_PUBLIC_HAPPIER_HQ_ENABLED', '0');
        const { useSidebarHeaderActions } = await import('./useSidebarHeaderActions');
        const hook = await renderHook(() => useSidebarHeaderActions());
        hook.getCurrent().headerActions.find(action => action.id === 'settings')?.onPress?.();
        expect(routerPushSpy).toHaveBeenCalledWith('/settings');
    });
    it('exposes only implemented sidebar header actions when social and inbox actions are unavailable', async () => {
        const { useSidebarHeaderActions } = await import('./useSidebarHeaderActions');

        const hook = await renderHook(() => useSidebarHeaderActions());

        expect(hook.getCurrent().headerActions.map((action) => action.id)).toEqual([
            'settings',
            'newSession',
        ]);
    });

    it('opens the canonical ordinary draft route and forwards pointer modifiers', async () => {
        const { useSidebarHeaderActions } = await import('./useSidebarHeaderActions');
        const hook = await renderHook(() => useSidebarHeaderActions());

        hook.getCurrent().headerActions.find((action) => action.id === 'newSession')?.onPress?.({
            nativeEvent: { ctrlKey: true },
        } as never);

        expect(routerPushSpy).toHaveBeenCalledWith({
            pathname: '/new',
            params: {
                draftId: expect.any(String),
                draftOrigin: 'ordinary',
            },
        });
    });
});
