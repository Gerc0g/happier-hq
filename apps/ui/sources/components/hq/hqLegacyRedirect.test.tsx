import * as React from 'react';
import { expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';

const boundary = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
installSessionShellCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit');
        return createExpoRouterMock({ router: boundary }).module;
    },
});
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));

it('replaces old WikiPedik bookmarks with Work without opening a memory screen', async () => {
    const { default: WikipediaRoute } = await import('@/app/(app)/hq/wikipedia');
    const screen = await renderScreen(<WikipediaRoute />);
    expect(screen.findAllByType('Redirect').map((node) => node.props.href)).toEqual(['/']);
});
