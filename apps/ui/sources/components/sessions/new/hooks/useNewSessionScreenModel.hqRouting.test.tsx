import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { createDeferred, renderHook, renderScreen, standardCleanup } from '@/dev/testkit';
import { activeServerAccountScopeState, featureFlags, persistDraftNowRef, persistedDraft, settingsState, TEST_DRAFT_ID, platformOsState, renderNewSessionScreenModel, resetDraftPersistenceState, useCreateNewSessionArgsRef } from './__tests__/draftPersistenceTestEnvironment';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));
const preset = { model: 'hq-research-model', effort: 'high', webSearch: 'live', network: true, instructions: '', skills: [], hooks: { sessionContext: false, inboxCapture: false }, mcp: [] };
beforeEach(async () => {
    await resetDraftPersistenceState();
    vi.stubEnv('EXPO_PUBLIC_HAPPIER_HQ_ENABLED', '1');
    platformOsState.value = 'web';
    rpc.mockImplementation(async request => request.method === 'hq.control.v1'
        ? { v: 1, ok: true, result: { settings: { version: 1, revision: 'r1', presets: { work: { ...preset, model: 'hq-work-model' }, research: preset } }, skills: [] } }
        : { success: true, exitCode: 0, stdout: JSON.stringify({ version: 1, root: '/projects', companies: [], research: { path: '/wiki/research' }, ordinary: { path: '/ordinary' } }), stderr: '' });
});
afterEach(() => { standardCleanup(); vi.unstubAllEnvs(); });

it('restores research routing into the composer and launches with its model and managed provider settings', async () => {
    persistedDraft.selectedPath = '/wiki/research';
    let model: any;
    await renderNewSessionScreenModel(value => { model = value; });
    expect(model.variant).toBe('simple');
    expect(model.simpleProps.agentInputExtraActionChips.some((chip: { key: string }) => chip.key === 'hq-chat-routing')).toBe(true);
    expect(model.simpleProps.modelMode).toBe('hq-research-model');
    expect(model.simpleProps.handleAgentClick).toBeTypeOf('function');
    expect(model.simpleProps.handlePermissionModeChange).toBeTypeOf('function');
    expect(model.simpleProps.setModelMode).toBeTypeOf('function');
    expect(model.simpleProps.pathPopover).toBeDefined();
    expect(model.simpleProps.agentInputExtraActionChips.some((chip: { key: string }) => chip.key === 'new-session-mcp')).toBe(true);
    expect(model.simpleProps.showResumePicker).toBe(true);
    expect(useCreateNewSessionArgsRef.current).toMatchObject({ agentType: 'codex', modelMode: 'hq-research-model', transcriptStorage: 'persisted', mcpSelection: { v: 1, managedServersEnabled: true, forceIncludeServerIds: [], forceExcludeServerIds: [] }, settings: { codexBackendMode: 'appServer' } });
});

it('blocks creating an unbound HQ chat until a route and target are selected', async () => {
    persistedDraft.selectedPath = '/unregistered';
    let model: any;
    await renderNewSessionScreenModel(value => { model = value; });
    expect(model.simpleProps.canCreate).toBe(false);
});

it('changes the real composer route without losing the prompt or resuming a different scope', async () => {
    persistedDraft.selectedPath = '/wiki/research';
    persistedDraft.resumeSessionId = 'old-research-session';
    let model: any;
    await renderNewSessionScreenModel(value => { model = value; });
    const chip = model.simpleProps.agentInputExtraActionChips.find((chip: { key: string }) => chip.key === 'hq-chat-routing');
    const screen = await renderScreen(chip.collapsedContentPopover.renderContent({ requestClose: () => {}, maxHeight: 600 }));
    await act(async () => { await screen.pressByTestIdAsync('hq-chat-type-work'); });
    expect(model.simpleProps.selectedPath).toBe('');
    expect(model.simpleProps.canCreate).toBe(false);
    expect(model.simpleProps.modelMode).toBe('hq-work-model');
    expect(useCreateNewSessionArgsRef.current).toMatchObject({ selectedPath: '', resumeSessionId: '', modelMode: 'hq-work-model' });
    expect(model.simpleProps.promptStore.getPrompt()).toBe('hello');
});

it('keeps edited model and permissions for this chat after preset defaults load', async () => {
    persistedDraft.selectedPath = '/wiki/research';
    let model: any;
    await renderNewSessionScreenModel(value => { model = value; });
    await act(async () => { model.simpleProps.setModelMode('custom-model'); model.simpleProps.handlePermissionModeChange('yolo'); });
    expect(model.simpleProps.modelMode).toBe('custom-model');
    expect(useCreateNewSessionArgsRef.current).toMatchObject({ modelMode: 'custom-model', permissionMode: 'yolo', hqSessionOptions: { preset: 'research' } });
});

it('keeps Direct sessions outside HQ route validation', async () => {
    persistedDraft.selectedPath = '/unregistered';
    featureFlags.directSessionsEnabled = true;
    persistedDraft.transcriptStorage = 'direct';
    let model: any;
    await renderNewSessionScreenModel(value => { model = value; });
    expect(model.simpleProps.agentInputExtraActionChips.some((chip: { key: string }) => chip.key === 'hq-chat-routing')).toBe(false);
    expect(useCreateNewSessionArgsRef.current?.hqSessionOptions).toBeNull();
    expect(useCreateNewSessionArgsRef.current?.prepareRequestedPath).toBeUndefined();
});

it('keeps the remembered Work type when generic entry saves a recent Research path before catalog loading', async () => {
    const { saveHqChatType } = await import('@/sync/domains/state/persistence');
    saveHqChatType('work');
    settingsState.recentMachinePaths = [{ machineId: 'machine-1', path: '/wiki/research' }];
    const catalogReply = createDeferred<unknown>();
    rpc.mockImplementation(async request => request.method === 'hq.control.v1'
        ? { v: 1, ok: true, result: { settings: { version: 1, revision: 'r1', presets: { work: { ...preset, model: 'hq-work-model' }, research: preset } }, skills: [] } }
        : catalogReply.promise);
    const { useNewSessionScreenModel } = await import('./useNewSessionScreenModel');
    const hook = await renderHook((): any => useNewSessionScreenModel({ draftId: 'fresh-generic-hq-draft' }));
    expect(useCreateNewSessionArgsRef.current?.recentMachinePaths).toEqual([{ machineId: 'machine-1', path: '/wiki/research' }]);
    expect(hook.getCurrent().simpleProps.selectedPath).toBe('/wiki/research');
    await act(async () => { persistDraftNowRef.current?.(); });
    await act(async () => { catalogReply.resolve({ success: true, exitCode: 0, stdout: JSON.stringify({ version: 1, root: '/projects', companies: [], research: { path: '/wiki/research' } }), stderr: '' }); });
    expect(useCreateNewSessionArgsRef.current).toMatchObject({ hqSessionOptions: { preset: 'work' } });
    expect(hook.getCurrent().simpleProps.modelMode).toBe('hq-work-model');
});

it('keeps HQ route, task and creation fence through normal prompt autosave and remount', async () => {
    const creation = { machineId: 'machine-2', serverId: 'server-a', repoPath: '/projects/acme/app/web', taskName: 'Fix bug', requestId: 'creation-durable' };
    Object.assign(persistedDraft, { hqChatType: 'work', hqWorktreeTask: 'Fix bug', hqWorktreeCreation: creation, selectedPath: creation.repoPath });
    rpc.mockImplementation(async request => request.method === 'hq.control.v1'
        ? { v: 1, ok: true, result: { settings: { version: 1, revision: 'r1', presets: { work: { ...preset, model: 'hq-work-model' }, research: preset } }, skills: [] } }
        : { success: true, exitCode: 0, stdout: JSON.stringify({ version: 1, root: '/projects', companies: [{ slug: 'acme', path: '/projects/acme', products: [{ slug: 'app', path: '/projects/acme/app', repos: [{ name: 'web', path: creation.repoPath, worktrees: [] }] }] }], research: { path: '/wiki/research' } }), stderr: '' });
    let model: any;
    const hook = await renderNewSessionScreenModel(value => { model = value; });
    await act(async () => { model.simpleProps.promptStore.setPrompt('Updated task prompt'); persistDraftNowRef.current?.(); });
    const { getSessionDraftSnapshot } = await import('@/sync/ops/sessionDrafts/sessionDraftRepository');
    const snapshot = () => getSessionDraftSnapshot(activeServerAccountScopeState.value!, { kind: 'newSession', draftId: TEST_DRAFT_ID });
    expect(snapshot()?.localSupplement.newSessionLocalState).toMatchObject({ hqChatType: 'work', hqWorktreeTask: 'Fix bug', hqWorktreeCreation: creation });
    await hook.unmount();
    await renderNewSessionScreenModel(value => { model = value; });
    expect(model.simpleProps.promptStore.getPrompt()).toBe('Updated task prompt');
    expect(useCreateNewSessionArgsRef.current).toMatchObject({ hqSessionOptions: { preset: 'work' } });
    const branch = model.simpleProps.agentInputExtraActionChips.find((chip: { key: string }) => chip.key === 'hq-chat-branch');
    const screen = await renderScreen(branch.collapsedContentPopover.renderContent({ requestClose: () => {}, maxHeight: 600 }));
    expect(screen.findByTestId('hq-chat-worktree-task')?.props.value).toBe('Fix bug');
    expect(snapshot()?.localSupplement.newSessionLocalState?.hqWorktreeCreation).toEqual(creation);
});

it('does not overwrite a directory edit made while HQ launch preparation is completing', async () => {
    persistedDraft.selectedPath = '/wiki/research';
    let model: any;
    await renderNewSessionScreenModel(value => { model = value; });
    const args = useCreateNewSessionArgsRef.current as any;
    const preparation = args.prepareRequestedPath();
    const picker = model.simpleProps.pathPopover.renderContent({ requestClose: () => {}, maxHeight: 600 });
    picker.props.onChangeDraftSelectedPath('/changed-while-preparing');
    await act(async () => { await expect(preparation).rejects.toThrow('hq.routing.contextChanged'); });
    expect(args.getRequestedPath()).toBe('/changed-while-preparing');
});
