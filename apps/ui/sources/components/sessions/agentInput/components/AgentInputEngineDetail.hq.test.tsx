import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';

installSessionShellCommonModuleMocks();
const mode = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/sync/domains/hq/hqRuntime', () => ({ isHqWorkspaceEnabled: () => mode.enabled }));
vi.mock('@/components/sessions/pickers/OptionPickerOverlay', () => ({
    OptionPickerOverlay: () => React.createElement('Text', { testID: 'model-choices' }, 'Selectable model'),
}));
describe('HQ model ownership', () => {
    it('allows per-session model overrides in HQ', async () => {
        mode.enabled = true;
        const { AgentInputEngineDetail } = await import('./AgentInputEngineDetail');
        const screen = await renderScreen(<AgentInputEngineDetail modelOptions={[{ value: 'custom', label: 'Custom', description: '' }]} onSelectModel={vi.fn()} />);
        expect(screen.getTextContent()).toContain('Selectable model');
    });
    it('retains the ordinary model picker outside HQ', async () => {
        mode.enabled = false;
        const { AgentInputEngineDetail } = await import('./AgentInputEngineDetail');
        const screen = await renderScreen(<AgentInputEngineDetail modelOptions={[{ value: 'custom', label: 'Custom', description: '' }]} onSelectModel={vi.fn()} />);
        expect(screen.getTextContent()).toContain('Selectable model');
    });
});
