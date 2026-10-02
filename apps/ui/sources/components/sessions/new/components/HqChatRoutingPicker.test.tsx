import { act } from 'react-test-renderer';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, renderScreen } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';
import type { HqCatalog } from '@/sync/domains/hq/hqCatalog';
import type { HqAgentSnapshot } from '@/sync/domains/hq/hqAgentSettings';

installSessionShellCommonModuleMocks();
beforeEach(() => vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => { callback(0); return 0; }));
afterEach(() => vi.unstubAllGlobals());
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('@/components/ui/popover', () => ({
    Popover: ({ open, children }: any) => open ? (typeof children === 'function' ? children({ maxHeight: 600, maxWidth: 500 }) : children) : null,
    PopoverScope: ({ children }: any) => children,
    usePopoverBoundaryRef: () => null,
}));

const catalog: HqCatalog = { version: 1, root: '/work', research: { path: '/research' }, ordinary: { path: '/general' }, companies: [
    { slug: 'company', path: '/work/company', products: [{ slug: 'product', path: '/work/company/product', repos: [
        { name: 'repo', path: '/work/company/product/repo', worktrees: [{ id: 'task', path: '/branches/task', branch: 'feature', state: 'active', task: 'Task' }] },
    ] }] },
] };
const preset = { model: 'work-model', effort: 'high', webSearch: 'live', network: true, instructions: '', skills: ['skill'], hooks: { sessionContext: true, inboxCapture: false }, mcp: [] };
const snapshot: HqAgentSnapshot = { settings: { version: 1, revision: 'r1', presets: { work: preset, research: { ...preset, model: 'research-model' }, ordinary: { ...preset, model: 'general-model' } } }, skills: [] };
const base = { catalog, snapshot, loading: false, error: false, onReload: vi.fn() };

describe('HQ chat routing picker', () => {
    it('offers only Work and Research and switches authoritative paths', async () => {
        const { HqChatRoutingPicker } = await import('./HqChatRoutingPicker');
        const select = vi.fn();
        const selectType = vi.fn();
        const close = vi.fn();
        const screen = await renderScreen(<HqChatRoutingPicker {...base} path="" onSelectPath={select} onSelectType={selectType} level="type" onClose={close} />);
        expect(screen.findByTestId('hq-chat-type-ordinary')).toBeNull();
        await screen.pressByTestIdAsync('hq-chat-type-research');
        expect(selectType).toHaveBeenLastCalledWith('research');
        expect(select).toHaveBeenLastCalledWith('/research');
        expect(close).toHaveBeenCalledOnce();
    });
    it('provides separate company, product, repository and worktree chips', async () => {
        const { createHqChatRoutingChips } = await import('./HqChatRoutingPicker');
        const chips = createHqChatRoutingChips({ ...base, path: '', type: 'work', onSelectPath: vi.fn() });
        expect(chips.map(chip => chip.key)).toEqual(['hq-chat-routing', 'hq-chat-company', 'hq-chat-product', 'hq-chat-repo', 'hq-chat-branch']);
        expect(createHqChatRoutingChips({ ...base, path: '/research', type: 'research', onSelectPath: vi.fn() })).toHaveLength(1);
    });
    it('changes work scopes without offering whole-company launch options', async () => {
        const { HqChatRoutingPicker } = await import('./HqChatRoutingPicker');
        const select = vi.fn();
        const screen = await renderScreen(<HqChatRoutingPicker {...base} path="/work/company" onSelectPath={select} level="product" />);
        expect(screen.findByTestId('hq-chat-target:/work/company')).toBeNull();
        await screen.pressByTestIdAsync('hq-chat-target:/work/company/product');
        expect(select).toHaveBeenLastCalledWith('/work/company/product');
    });
    it('allows an existing worktree or a named new worktree', async () => {
        const { HqChatRoutingPicker } = await import('./HqChatRoutingPicker');
        const select = vi.fn();
        const screen = await renderScreen(<HqChatRoutingPicker {...base} path="/work/company/product/repo" taskName="Fix" onSelectPath={select} level="branch" />);
        expect(screen.findByTestId('hq-chat-worktree-task')?.props.value).toBe('Fix');
        await screen.pressByTestIdAsync('hq-chat-target:/branches/task');
        expect(select).toHaveBeenLastCalledWith('/branches/task');
        await screen.pressByTestIdAsync('hq-chat-target:/work/company/product/repo');
        expect(select).toHaveBeenLastCalledWith('/work/company/product/repo');
    });
    it('exposes retry after a load error without changing the selected path', async () => {
        const { HqChatRoutingPicker } = await import('./HqChatRoutingPicker');
        const select = vi.fn();
        const retry = vi.fn();
        const screen = await renderScreen(<HqChatRoutingPicker {...base} path="/research" onSelectPath={select} onReload={retry} error level="type" />);
        await screen.pressByTestIdAsync('hq-chat-routing-retry');
        expect(retry).toHaveBeenCalledOnce();
        expect(select).not.toHaveBeenCalled();
    });
});

it('opens every routing chip through the real AgentInput selection owner', async () => {
    const { createHqChatRoutingChips } = await import('./HqChatRoutingPicker');
    const { useAgentInputSelectionOverlayController } = await import('@/components/sessions/agentInput/selection/useAgentInputSelectionOverlayController');
    const chips = createHqChatRoutingChips({ ...base, path: '/work/company/product/repo', type: 'work', onSelectPath: vi.fn() });
    const hook = await renderHook(useAgentInputSelectionOverlayController, { initialProps: {
        extraActionChips: chips, shouldRenderSessionModeChip: false, canChangePermission: false,
        hasMachinePopover: false, hasPathPopover: false, hasResumePopover: false, hasProfilePopover: false,
        hasEnvVarsPopover: false, hasAgentPickerOptions: false,
    } });
    for (const chip of chips) {
        await act(async () => { hook.getCurrent().toggleSelectionOverlay('collapsedExtra', 'chip', chip.key); });
        expect(hook.getCurrent().activeExtraCollapsedPopoverChip?.key).toBe(chip.key);
    }
});
