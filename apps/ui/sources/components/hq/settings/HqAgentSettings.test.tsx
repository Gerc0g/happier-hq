import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';

const navigation = vi.hoisted(() => ({ listeners: new Map<string, (event: unknown) => void>(), dispatch: vi.fn() }));
installSessionShellCommonModuleMocks({ router: async () => { const { createExpoRouterMock } = await import('@/dev/testkit'); return createExpoRouterMock({ navigation: { dispatch: navigation.dispatch, isFocused: () => true, addListener: (name: string, handler: (event: unknown) => void) => { navigation.listeners.set(name, handler); return () => navigation.listeners.delete(name); } } }).module; } });
vi.mock('./HqRuntimePanel', () => ({ HqRuntimePanel: () => null }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));
const preset = { model: '', effort: 'high', webSearch: 'live', network: true, skills: [], instructions: '', hooks: { sessionContext: true, inboxCapture: true }, mcp: [] };
const settings = { version: 1, revision: 'original', presets: { work: preset, research: preset } };
const ok = (result: unknown) => ({ v: 1, ok: true, result });

describe('HQ Codex settings', () => {
    beforeEach(() => { navigation.listeners.clear(); navigation.dispatch.mockReset(); rpc.mockReset(); rpc.mockResolvedValue(ok({ settings, skills: [], provider: 'codex', applyTo: 'new-sessions' })); });
    it('offers an ordinary preset only when provided and keeps edits when switching presets', async () => {
        rpc.mockResolvedValueOnce(ok({ settings: { ...settings, presets: { ...settings.presets, ordinary: { ...preset, model: 'general-model' } } }, skills: [] }));
        const { HqAgentSettings } = await import('./HqAgentSettings');
        const screen = await renderScreen(<HqAgentSettings target={{ machineId: 'm', serverId: 's' }} active />);
        await act(async () => { screen.changeTextByTestId('hq-agent-model', 'work-edited'); });
        await screen.pressByTestIdAsync('hq-agent-preset:ordinary');
        expect(screen.findByTestId('hq-agent-model')?.props.value).toBe('general-model');
        await act(async () => { screen.changeTextByTestId('hq-agent-model', 'ordinary-edited'); });
        await screen.pressByTestIdAsync('hq-agent-preset:work');
        expect(screen.findByTestId('hq-agent-model')?.props.value).toBe('work-edited');
        await screen.pressByTestIdAsync('hq-agent-preset:ordinary');
        expect(screen.findByTestId('hq-agent-model')?.props.value).toBe('ordinary-edited');
        rpc.mockResolvedValueOnce(ok({ config: 'reviewed' }));
        await screen.pressByTestIdAsync('hq-agent-preview');
        expect(rpc.mock.calls.at(-1)?.[0].payload.args).toMatchObject({ preset: 'ordinary', settings: { presets: { work: { model: 'work-edited' }, ordinary: { model: 'ordinary-edited' } } } });
        const reviewed = rpc.mock.calls.at(-1)?.[0].payload.args.settings;
        rpc.mockResolvedValueOnce(ok({ ...reviewed, revision: 'saved' }));
        await screen.pressByTestIdAsync('hq-agent-save');
        expect(screen.findByTestId('hq-agent-model')?.props.value).toBe('ordinary-edited');
        expect(screen.findByTestId('hq-agent-save')?.props.disabled).toBe(true);
    });
    it('keeps legacy two-preset servers editable without offering ordinary', async () => {
        const { HqAgentSettings } = await import('./HqAgentSettings');
        const screen = await renderScreen(<HqAgentSettings target={{ machineId: 'm', serverId: 's' }} active />);
        expect(screen.findByTestId('hq-agent-preset:ordinary')).toBeNull();
        await act(async () => { screen.changeTextByTestId('hq-agent-model', 'legacy-edit'); });
        expect(screen.findByTestId('hq-agent-model')?.props.value).toBe('legacy-edit');
    });
    it('previews before saving and retains edits on revision conflict', async () => {
        const { HqAgentSettings } = await import('./HqAgentSettings');
        const screen = await renderScreen(<HqAgentSettings target={{ machineId: 'm', serverId: 's' }} active />);
        await act(async () => { screen.changeTextByTestId('hq-agent-model', 'gpt-5.6-sol'); });
        expect(screen.findByTestId('hq-agent-save')?.props.disabled).toBe(true);
        rpc.mockResolvedValueOnce(ok({ config: 'model = "gpt-5.6-sol"' }));
        await screen.pressByTestIdAsync('hq-agent-preview');
        expect(screen.findByTestId('hq-agent-save')?.props.disabled).toBe(false);
        rpc.mockResolvedValueOnce({ v: 1, ok: false, error: { code: 'HQ_AGENT_REVISION_CONFLICT', message: 'conflict' } });
        await screen.pressByTestIdAsync('hq-agent-save');
        expect(screen.findByTestId('hq-agent-model')?.props.value).toBe('gpt-5.6-sol');
        expect(screen.findByTestId('hq-agent-error')).not.toBeNull();
        expect(rpc.mock.calls.at(-1)?.[0].payload.args.revision).toBe('original');
    });
    it('preserves imported portable settings and HTTPS MCP through review and save', async () => {
        const portable = { ...preset, serviceTier: 'default', approvalsReviewer: 'user', jsRepl: false, mcp: [{ name: 'docs', url: 'https://developers.openai.com/mcp', enabled: true }] };
        rpc.mockResolvedValueOnce(ok({ settings: { ...settings, presets: { work: portable, research: preset } }, skills: [] }));
        const { HqAgentSettings } = await import('./HqAgentSettings');
        const screen = await renderScreen(<HqAgentSettings target={{ machineId: 'm', serverId: 's' }} active />);
        await act(async () => { screen.changeTextByTestId('hq-agent-model', 'gpt-6-astra'); });
        rpc.mockResolvedValueOnce(ok({ config: 'reviewed' }));
        await screen.pressByTestIdAsync('hq-agent-preview');
        const reviewed = rpc.mock.calls.at(-1)?.[0].payload.args.settings.presets.work;
        expect(reviewed).toMatchObject({ serviceTier: 'default', approvalsReviewer: 'user', jsRepl: false, mcp: [{ name: 'docs', url: 'https://developers.openai.com/mcp', enabled: true }] });
        rpc.mockResolvedValueOnce(ok({ configAccepted: true, source: 'hq-draft' }));
        await screen.pressByTestIdAsync('hq-agent-inspect');
        expect(rpc.mock.calls.at(-1)?.[0].payload.args.settings.presets.work).toEqual(reviewed);
        rpc.mockResolvedValueOnce(ok({ ...settings, revision: 'saved', presets: { work: reviewed, research: preset } }));
        await screen.pressByTestIdAsync('hq-agent-save');
        expect(rpc.mock.calls.at(-1)?.[0].payload.args.settings.presets.work).toEqual(reviewed);
    });
    it('does not read or write through a background screen', async () => {
        const { HqAgentSettings } = await import('./HqAgentSettings');
        await renderScreen(<HqAgentSettings target={{ machineId: 'm', serverId: 's' }} active={false} />);
        expect(rpc).not.toHaveBeenCalled();
    });
});


describe('settings draft navigation', () => {
    beforeEach(() => { navigation.listeners.clear(); navigation.dispatch.mockReset(); rpc.mockReset().mockResolvedValue(ok({ settings, skills: [], provider: 'codex', applyTo: 'new-sessions' })); });
    afterEach(() => vi.unstubAllGlobals());
    it.each(['model', 'import', 'mcp'] as const)('guards back and browser reload for an unapplied %s draft', async (kind) => {
        const { HqAgentSettings } = await import('./HqAgentSettings');
        const { Modal } = await import('@/modal');
        const screen = await renderScreen(<HqAgentSettings target={{ machineId: 'm', serverId: 's' }} active />);
        const events = new Map<string, (event: { preventDefault: () => void; returnValue?: string }) => void>();
        vi.stubGlobal('window', { addEventListener: (name: string, callback: (event: { preventDefault: () => void }) => void) => events.set(name, callback), removeEventListener: (name: string) => events.delete(name) });
        if (kind !== 'model') await screen.pressByTestIdAsync('hq-agent-advanced');
        const input = kind === 'model' ? 'hq-agent-model' : `hq-agent-${kind}-input`;
        await act(async () => { screen.changeTextByTestId(input, 'keep this draft'); });
        expect(navigation.listeners.has('beforeRemove')).toBe(true);
        const browserEvent = { preventDefault: vi.fn(), returnValue: undefined as string | undefined };
        events.get('beforeunload')?.(browserEvent);
        expect(browserEvent.preventDefault).toHaveBeenCalled();
        vi.mocked(Modal.confirm).mockResolvedValueOnce(false);
        const event = { preventDefault: vi.fn(), data: { action: { type: 'GO_BACK' } } };
        await act(async () => { navigation.listeners.get('beforeRemove')?.(event); });
        expect(event.preventDefault).toHaveBeenCalled();
        expect(navigation.dispatch).not.toHaveBeenCalled();
        expect(screen.findByTestId(input)?.props.value).toBe('keep this draft');
        vi.mocked(Modal.confirm).mockResolvedValueOnce(true);
        await act(async () => { navigation.listeners.get('beforeRemove')?.(event); });
        expect(navigation.dispatch).toHaveBeenCalledWith(event.data.action);
    });
    it('keeps unapplied MCP text when a preset switch is cancelled', async () => {
        const { HqAgentSettings } = await import('./HqAgentSettings');
        const { Modal } = await import('@/modal');
        const screen = await renderScreen(<HqAgentSettings target={{ machineId: 'm', serverId: 's' }} active />);
        await screen.pressByTestIdAsync('hq-agent-advanced');
        await act(async () => { screen.changeTextByTestId('hq-agent-mcp-input', 'unapplied MCP'); });
        vi.mocked(Modal.confirm).mockResolvedValueOnce(false);
        await screen.pressByTestIdAsync('hq-agent-preset:research');
        expect(screen.findByTestId('hq-agent-mcp-input')?.props.value).toBe('unapplied MCP');
    });
});
