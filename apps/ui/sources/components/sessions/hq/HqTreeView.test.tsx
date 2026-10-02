import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCapturingFlatListMock, createSessionFixture, renderScreen } from '@/dev/testkit';
import { getVitestNodeBuiltin } from '@/dev/vitestNodeBuiltins';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';
import type { HqTreeRow } from '@/sync/domains/hq/hqCatalog';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import * as registryUi from '@/agents/registry/registryUi';

installSessionShellCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock(createCapturingFlatListMock({ renderItems: true }).module);
    },
});

beforeEach(() => {
    const nodeModule = getVitestNodeBuiltin<{
        _load: (id: string, ...args: unknown[]) => unknown;
    }>('node:module');
    const originalLoad = nodeModule._load;
    // Node lacks Metro's lazy alias resolution; supply the real registry at the loader boundary.
    vi.spyOn(nodeModule, '_load').mockImplementation((id, ...args) => (
        id === '@/agents/registry/registryUi' ? registryUi : originalLoad.call(nodeModule, id, ...args)
    ));
});
afterEach(() => vi.restoreAllMocks());

const target = { machineId: 'machine-1', company: 'chimera', product: 'aetheria', repo: 'Aetheria-AI', path: '/projects/AI' };
const rows: HqTreeRow[] = [
    { kind: 'repo', key: 'repo', title: 'Aetheria-AI', depth: 2, target, path: target.path },
    { kind: 'worktree', key: 'worktree', title: 'Fix chat', depth: 3, target, path: '/worktrees/fix', branch: 'agent/fix' },
    { kind: 'session', key: 'chat', depth: 4, item: { type: 'session', serverId: 'server-1', session: buildSessionListRenderableFromSession(createSessionFixture({ id: 'chat-1' })) } },
];
const callbacks = () => ({ onOpenEntity: vi.fn(), onToggle: vi.fn(), onCreateWorktree: vi.fn(), onNewChat: vi.fn(), onSession: vi.fn() });

describe('HQ tree interactions', () => {
    it('opens company/product/repo cards without expanding the row or starting a session', async () => {
        const { HqTreeView } = await import('./HqTreeView');
        const actions = callbacks();
        const entity = { machineId: 'machine-1', scope: 'chimera' };
        const cardRows: HqTreeRow[] = ['company', 'product', 'repo'].map((kind) => ({
            kind: kind as 'company' | 'product' | 'repo', key: kind, title: kind, depth: 0, entity,
        }));
        const screen = await renderScreen(<HqTreeView rows={cardRows} expanded={new Set(["repo", "worktree", "company", "product"])} interactive availableMachineIds={new Set()} busy={false} {...actions} />);
        for (const kind of ['company', 'product', 'repo']) await screen.pressByTestIdAsync(`hq-card-${kind}`);
        expect(actions.onOpenEntity).toHaveBeenCalledTimes(3);
        expect(actions.onOpenEntity).toHaveBeenCalledWith(entity);
        expect(actions.onToggle).not.toHaveBeenCalled();
        expect(actions.onNewChat).not.toHaveBeenCalled();
    });
    it('offers HQ worktree creation on a repo and a new chat in the selected worktree', async () => {
        const { HqTreeView } = await import('./HqTreeView');
        const actions = callbacks();
        const screen = await renderScreen(<HqTreeView rows={rows} expanded={new Set(["repo", "worktree", "company", "product"])} interactive availableMachineIds={new Set(['machine-1'])} busy={false} {...actions} />);
        expect(screen.findByTestId('hq-create-repo')).not.toBeNull();
        await screen.pressByTestIdAsync('hq-create-repo');
        expect(actions.onCreateWorktree).toHaveBeenCalledWith(target);
        await screen.pressByTestIdAsync('hq-chat-worktree');
        expect(actions.onNewChat).toHaveBeenCalledWith(target, '/worktrees/fix');
        expect(actions.onToggle).not.toHaveBeenCalled();
        await screen.pressByTestIdAsync('hq-row-chat');
        expect(actions.onSession).toHaveBeenCalledWith(rows[2]);
    });

    it('disables machine actions while offline and restores them after reconnect', async () => {
        const { HqTreeView } = await import('./HqTreeView');
        const actions = callbacks();
        const screen = await renderScreen(<HqTreeView rows={rows} expanded={new Set(["repo", "worktree", "company", "product"])} interactive availableMachineIds={new Set()} busy={false} {...actions} />);
        expect(screen.findByTestId('hq-create-repo')?.props.disabled).toBe(true);
        expect(screen.findByTestId('hq-chat-worktree')?.props.disabled).toBe(true);
        await screen.pressByTestIdAsync('hq-row-chat');
        expect(actions.onSession).toHaveBeenCalledWith(rows[2]);
        await screen.update(<HqTreeView rows={rows} expanded={new Set(["repo", "worktree", "company", "product"])} interactive availableMachineIds={new Set(['machine-1'])} busy={false} {...actions} />);
        expect(screen.findByTestId('hq-create-repo')?.props.disabled).toBe(false);
    });

    it('exposes expanded state and prevents duplicate mutations while a worktree is being created', async () => {
        const { HqTreeView } = await import('./HqTreeView');
        const actions = callbacks();
        const screen = await renderScreen(<HqTreeView rows={rows} expanded={new Set(['worktree'])} interactive availableMachineIds={new Set(['machine-1'])} busy {...actions} />);
        expect(screen.findByTestId('hq-row-repo')?.props.accessibilityState).toMatchObject({ expanded: false });
        expect(screen.findByTestId('hq-create-repo')?.props.disabled).toBe(true);
        expect(screen.findByTestId('hq-chat-worktree')?.props.disabled).toBe(true);
        await screen.pressByTestIdAsync('hq-row-repo');
        expect(actions.onToggle).toHaveBeenCalledWith('repo');
    });
});


it('opens the Research creation action independently of section disclosure', async () => {
    const { HqTreeView } = await import('./HqTreeView');
    const actions = callbacks();
    const onNewResearch = vi.fn();
    const screen = await renderScreen(<HqTreeView rows={[{ kind: 'research', key: 'research', title: '', depth: 0, sessionCount: 0 }]} expanded={new Set()} interactive busy={false} availableMachineIds={new Set(['machine-1'])} onNewResearch={onNewResearch} {...actions} />);
    expect(screen.findByTestId('hq-row-research')?.props.accessibilityState).toMatchObject({ expanded: false });
    await screen.pressByTestIdAsync('hq-new-research');
    expect(onNewResearch).toHaveBeenCalledOnce();
    expect(actions.onToggle).not.toHaveBeenCalled();
    await screen.pressByTestIdAsync('hq-row-research');
    expect(actions.onToggle).toHaveBeenCalledWith('research');
});
