import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { createHqEntityFixture } from '@/dev/testkit/fixtures/hqEntityFixtures';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';
import { decodeBase64 } from '@/encryption/base64';

installSessionShellCommonModuleMocks();
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));
const card = createHqEntityFixture();
const reply = (value = card) => ({ success: true, exitCode: 0, stdout: JSON.stringify(value), stderr: '' });
const props = { machineId: 'machine-1', serverId: 'server-1', scope: card.scope, available: true, active: true, machineLabel: 'VPS', onNavigate: vi.fn(), onNewChat: vi.fn() };

describe('HQ entity card', () => {
    beforeEach(() => { rpc.mockReset(); props.onNewChat.mockReset(); rpc.mockResolvedValue(reply()); });
    it('keeps all five tabs and allows starting a chat with unfinished onboarding', async () => {
        const { HqEntityCard } = await import('./HqEntityCard');
        const screen = await renderScreen(<HqEntityCard {...props} />);
        for (const tab of ['overview', 'context', 'onboarding', 'checks', 'history']) expect(screen.findByTestId(`hq-entity-tab:${tab}`)).not.toBeNull();
        await screen.pressByTestIdAsync('hq-entity-start');
        expect(props.onNewChat).toHaveBeenCalledWith(card.path);
        await screen.pressByTestIdAsync('hq-entity-tab:onboarding');
        expect(screen.findByTestId('hq-confirm-purpose')).not.toBeNull();
        expect(rpc).toHaveBeenCalledTimes(1);
    });
    it('offers HQ agent onboarding only when advertised, including focused manual items', async () => {
        const { HqEntityCard } = await import('./HqEntityCard');
        const onAgentTask = vi.fn();
        const supported = {
            ...card,
            agentActions: [{ id: 'onboard' as const, skill: 'onboard-agents-md' as const }],
            onboarding: { ...card.onboarding, items: [...card.onboarding.items, { ...card.onboarding.items[0], id: 'git', automatic: true }] },
        };
        rpc.mockResolvedValue(reply(supported));
        const screen = await renderScreen(<HqEntityCard {...props} onAgentTask={onAgentTask} />);
        await screen.pressByTestIdAsync('hq-entity-tab:onboarding');
        await screen.pressByTestIdAsync('hq-agent-onboard');
        expect(onAgentTask).toHaveBeenLastCalledWith({ scope: card.scope, kind: card.kind, directory: card.path });
        await screen.pressByTestIdAsync('hq-agent-onboard-purpose');
        expect(onAgentTask).toHaveBeenLastCalledWith({ scope: card.scope, kind: card.kind, directory: card.path, itemId: 'purpose' });
        expect(screen.findByTestId('hq-agent-onboard-git')).toBeNull();
        await screen.update(<HqEntityCard {...props} onAgentTask={onAgentTask} agentTaskBusy />);
        expect(screen.findByTestId('hq-agent-onboard')?.props.disabled).toBe(true);
        expect(screen.findByTestId('hq-agent-onboard-purpose')?.props.disabled).toBe(true);
        await screen.update(<HqEntityCard {...props} onAgentTask={onAgentTask} available={false} />);
        expect(screen.findByTestId('hq-agent-onboard')?.props.disabled).toBe(true);
    });
    it('keeps older HQ cards usable without offering an unavailable skill', async () => {
        const { HqEntityCard } = await import('./HqEntityCard');
        const screen = await renderScreen(<HqEntityCard {...props} onAgentTask={vi.fn()} />);
        await screen.pressByTestIdAsync('hq-entity-tab:onboarding');
        expect(screen.findByTestId('hq-agent-onboard')).toBeNull();
        expect(screen.findByTestId('hq-agent-onboard-purpose')).toBeNull();
        expect(screen.findByTestId('hq-confirm-purpose')).not.toBeNull();
    });
    it('requires an explicit diff review before saving Markdown and keeps draft on conflict', async () => {
        const { HqEntityCard } = await import('./HqEntityCard');
        const screen = await renderScreen(<HqEntityCard {...props} />);
        await screen.pressByTestIdAsync('hq-entity-tab:context');
        await act(async () => { screen.changeTextByTestId('hq-context-input', '# Updated context'); });
        expect(screen.findByTestId('hq-context-save')).toBeNull();
        await screen.pressByTestIdAsync('hq-context-review');
        expect(screen.findByTestId('hq-context-diff')).not.toBeNull();
        rpc.mockResolvedValueOnce({ success: false, exitCode: 1, stdout: '', stderr: 'HQ_ENTITY_REVISION_CONFLICT' });
        await screen.pressByTestIdAsync('hq-context-save');
        expect(screen.findByTestId('hq-entity-error')).not.toBeNull();
        await screen.pressByTestIdAsync('hq-context-edit');
        expect(screen.findByTestId('hq-context-input')?.props.value).toBe('# Updated context');
        expect(rpc).toHaveBeenCalledTimes(2);
        const payload = JSON.parse(new TextDecoder().decode(decodeBase64(rpc.mock.calls[1][0].payload.argv[5])));
        expect(payload).toEqual({ revision: card.document.revision, content: '# Updated context' });
    });
    it('opens a specific check from the health badge and uses semantic status pills', async () => {
        const { HqEntityCard } = await import('./HqEntityCard');
        const failed = { ...card, health: { ...card.health, status: 'error' as const, checks: [{ ...card.health.checks[0], status: 'error' as const, detail: 'Memory link is missing' }] } };
        rpc.mockResolvedValue(reply(failed));
        const screen = await renderScreen(<HqEntityCard {...props} />);
        expect(screen.findByTestId('hq-own-health-pill:variant:danger')).not.toBeNull();
        await screen.pressByTestIdAsync('hq-own-health');
        expect(screen.findByTestId('hq-check-detail-path')).not.toBeNull();
        expect(screen.findByTestId('hq-health-path-pill:variant:danger')).not.toBeNull();
        await screen.pressByTestIdAsync('hq-health-path');
        expect(screen.findByTestId('hq-check-detail-path')).toBeNull();
    });
    it('marks cached checks unknown on disconnect and retains draft across tabs', async () => {
        const { HqEntityCard } = await import('./HqEntityCard');
        const screen = await renderScreen(<HqEntityCard {...props} />);
        await screen.pressByTestIdAsync('hq-entity-tab:context');
        await act(async () => { screen.changeTextByTestId('hq-context-input', 'Retained draft'); });
        await screen.pressByTestIdAsync('hq-entity-tab:checks');
        await screen.update(<HqEntityCard {...props} available={false} />);
        expect(screen.findByTestId('hq-check-path')?.props.accessibilityLabel).toContain('hq.entity.unknown');
        await screen.pressByTestIdAsync('hq-entity-tab:context');
        expect(screen.findByTestId('hq-context-input')?.props.value).toBe('Retained draft');
        expect(screen.findByTestId('hq-context-review')?.props.disabled).toBe(true);
    });
    it('opens Context at the top from a scrolled checklist and tab bar without losing its draft', async () => {
        const { HqEntityCard } = await import('./HqEntityCard');
        const checklist = Array.from({ length: 6 }, (_, index) => ({
            ...card.onboarding.items[0], id: `section-${index}`, title: `Section ${index + 1}`,
        }));
        rpc.mockResolvedValue(reply(createHqEntityFixture({
            onboarding: { ...card.onboarding, total: checklist.length, items: checklist },
        })));
        // Model only the native scroll position; the card and both navigation paths stay real.
        let scrollY = 0;
        const screen = await renderScreen(<HqEntityCard {...props} />, {
            createNodeMock: (element) => {
                const props = element.props;
                return typeof props === 'object' && props !== null && 'testID' in props && props.testID === 'hq-entity-scroll'
                    ? { scrollTo: ({ y }: { y: number }) => { scrollY = y; } }
                    : null;
            },
        });
        await screen.pressByTestIdAsync('hq-entity-tab:context');
        await act(async () => { screen.changeTextByTestId('hq-context-input', 'Draft still being edited'); });
        await screen.pressByTestIdAsync('hq-entity-tab:onboarding');
        scrollY = 900;
        await screen.pressByTestIdAsync('hq-onboarding-open-section-5');
        expect(scrollY).toBe(0);
        expect(screen.findByTestId('hq-context-input')?.props.value).toBe('Draft still being edited');

        await screen.pressByTestIdAsync('hq-entity-tab:checks');
        scrollY = 1200;
        await screen.pressByTestIdAsync('hq-entity-tab:context');
        expect(scrollY).toBe(0);
        expect(screen.findByTestId('hq-context-input')?.props.value).toBe('Draft still being edited');
    });
});
