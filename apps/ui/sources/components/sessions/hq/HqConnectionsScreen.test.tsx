import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';
import { newEnvironment, newGitConnection } from '@/sync/domains/hq/hqConnections';

installSessionShellCommonModuleMocks();
const boundary = vi.hoisted(() => ({ control: vi.fn() }));
// The machine RPC is the process boundary; parsing and form state remain real.
vi.mock('@/sync/ops/hqControl', () => ({ hqControl: boundary.control }));
const initial = { companyId: 'alpha', revision: 1, availableRepositories: ['alpha/product/repo'], git: [{ ...newGitConnection('main'), namespace: 'team' }], repositories: [], environments: [], history: [] };
const props = { companyId: 'alpha', machineId: 'machine', serverId: 'server', active: true, available: true };

describe('company connection settings', () => {
    beforeEach(() => boundary.control.mockReset().mockResolvedValue(initial));
    it('retains edits after a revision conflict and disables stale verification until saved', async () => {
        const { HqConnectionsScreen } = await import('./HqConnectionsScreen');
        const screen = await renderScreen(<HqConnectionsScreen {...props} />);
        await act(async () => { screen.changeTextByTestId('hq-git-namespace-main', 'updated-team'); });
        expect(screen.findByTestId('hq-connection-verify-main')?.props.disabled).toBe(true);
        boundary.control.mockRejectedValueOnce(new Error('connection revision conflict'));
        await screen.pressByTestIdAsync('hq-connections-save');
        expect(screen.findByTestId('hq-connections-error')).not.toBeNull();
        expect(screen.findByTestId('hq-git-namespace-main')?.props.value).toBe('updated-team');
        await screen.update(<HqConnectionsScreen {...props} available={false} />);
        expect(screen.findByTestId('hq-connections-save')?.props.disabled).toBe(true);
    });
    it('clears the secret after storage and sends it only through the owner control request', async () => {
        const { HqConnectionsScreen } = await import('./HqConnectionsScreen');
        const screen = await renderScreen(<HqConnectionsScreen {...props} />);
        await act(async () => { screen.changeTextByTestId('hq-credential-main', 'private-token'); });
        boundary.control.mockResolvedValueOnce({ ...initial, revision: 2, git: [{ ...initial.git[0], credentialRef: 'opaque-ref' }] });
        await screen.pressByTestIdAsync('hq-credential-save-main');
        expect(screen.findByTestId('hq-credential-main')?.props.value).toBe('');
        expect(boundary.control).toHaveBeenLastCalledWith('machine', 'connections.credential.put', { companyId: 'alpha', revision: 1, connectionId: 'main', token: 'private-token', expiresAt: '' }, 'server');
    });
});

it('replaces an explicitly discarded draft even when the server revision is unchanged', async () => {
    const { HqConnectionsScreen } = await import('./HqConnectionsScreen');
    boundary.control.mockReset().mockResolvedValue(initial);
    const screen = await renderScreen(<HqConnectionsScreen {...props} />);
    await act(async () => { screen.changeTextByTestId('hq-git-namespace-main', 'discard-me'); });
    const { Modal } = await import('@/modal');
    vi.mocked(Modal.confirm).mockResolvedValueOnce(true);
    await screen.pressByTestIdAsync('hq-connections-refresh');
    expect(screen.findByTestId('hq-git-namespace-main')?.props.value).toBe('team');
});

it('preserves unapplied advanced JSON and guards refresh', async () => {
    const { HqConnectionsScreen } = await import('./HqConnectionsScreen');
    const { Modal } = await import('@/modal');
    boundary.control.mockReset().mockResolvedValue(initial);
    const screen = await renderScreen(<HqConnectionsScreen {...props} />);
    await screen.pressByTestIdAsync('hq-connections-advanced');
    await act(async () => { screen.changeTextByTestId('hq-connections-json', '{unapplied'); });
    vi.mocked(Modal.confirm).mockClear().mockResolvedValueOnce(false);
    await screen.pressByTestIdAsync('hq-connections-refresh');
    expect(Modal.confirm).toHaveBeenCalled();
    expect(screen.findByTestId('hq-connections-json')?.props.value).toBe('{unapplied');
    await screen.pressByTestIdAsync('hq-connections-advanced');
    await screen.pressByTestIdAsync('hq-connections-advanced');
    expect(screen.findByTestId('hq-connections-json')?.props.value).toBe('{unapplied');
    expect(screen.findByTestId('hq-connections-save')?.props.disabled).toBe(true);
});

it('keeps Prod unavailable even when an older read check succeeded', async () => {
    const { HqConnectionsScreen } = await import('./HqConnectionsScreen');
    const prod = { ...newEnvironment('production'), tier: 'prod', credentialRef: 'existing-reference', verification: { ...newEnvironment('production').verification, state: 'read_verified', read: 'verified' } };
    boundary.control.mockReset().mockResolvedValue({ ...initial, environments: [prod] });
    const screen = await renderScreen(<HqConnectionsScreen {...props} />);
    await screen.pressByTestIdAsync('hq-connections-tab:environments');
    expect(screen.findByTestId('hq-connection-verify-production')?.props.disabled).toBe(true);
    expect(screen.findByTestId('hq-credential-production')?.props.editable).toBe(false);
    expect(screen.findByTestId('hq-credential-save-production')?.props.disabled).toBe(true);
});
