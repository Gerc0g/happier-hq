import { saveHqChatType } from '@/sync/domains/state/persistence';
import type { HqChatType } from '@/sync/domains/hq/hqChatRouting';
import { hqControl } from '@/sync/ops/hqControl';
import { projectSyncedSessionAuthoringFields } from '@/sync/domains/input/drafts/sessionAuthoringDraftProjection';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { areServerAccountScopesEqual } from '@/sync/domains/scope/serverAccountScope';
import { prepareSessionDraftPersistenceStorage } from '@/sync/ops/sessionDrafts/sessionDraftPersistenceStorage';
import { flushSessionDraft, writeNewSessionDraft } from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import { resolveNewSessionDraftRouteIdentity } from '@/components/sessions/new/navigation/newSessionDraftRouteIdentity';
import { buildNewSessionLaunchRouteParams } from '@/components/sessions/new/navigation/newSessionRouteParams';
import { storage } from '@/sync/domains/state/storage';
import { resolveMachineForActiveServerFromState } from '@/sync/store/domains/machines/resolveMachinesForActiveServerFromState';
import { isMachineOnline } from '@/utils/sessions/machineUtils';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';

export async function launchHqSession(input: Readonly<{ machineId: string; serverId: string; directory: string; text: string; chatType?: HqChatType; isCurrent: () => boolean; navigate: (route: { pathname: '/new'; params: ReturnType<typeof buildNewSessionLaunchRouteParams> }) => void }>) {
    const scope = getActiveServerAccountScope();
    if (!scope || scope.serverId !== input.serverId) throw new Error('HQ session target is unavailable');
    const current = () => {
        const machine = resolveMachineForActiveServerFromState(storage.getState(), input.machineId);
        return input.isCurrent() && areServerAccountScopesEqual(getActiveServerAccountScope(), scope) && Boolean(machine && isMachineOnline(machine));
    };
    await prepareSessionDraftPersistenceStorage();
    if (!current()) return;
    await runGuardedNavigation(() => {
        if (!current()) return;
        const { draftId } = resolveNewSessionDraftRouteIdentity({ routeDraftId: undefined });
        writeNewSessionDraft({ scope, draftId, materializationIntent: 'seeded', patch: { text: input.text, authoring: projectSyncedSessionAuthoringFields({ targetType: 'new_session', agentId: 'codex', backendTarget: { kind: 'builtInAgent', agentId: 'codex' }, codexBackendMode: 'appServer', machineId: input.machineId, serverId: input.serverId, directory: input.directory }) } });
        fireAndForget(flushSessionDraft({ scope, address: { kind: 'newSession', draftId } }), { tag: 'hq.session.draft' });
        if (input.chatType) saveHqChatType(input.chatType);
        input.navigate({ pathname: '/new', params: buildNewSessionLaunchRouteParams({ draftId, machineId: input.machineId, directory: input.directory, targetServerId: input.serverId }) });
    });
}


export async function prepareResearchSession(
    input: Pick<Parameters<typeof launchHqSession>[0], 'machineId' | 'serverId' | 'isCurrent' | 'navigate'>,
) {
    const account = getActiveServerAccountScope();
    if (!account || account.serverId !== input.serverId) throw new Error('HQ research target is unavailable');
    const isCurrent = () => input.isCurrent() && areServerAccountScopesEqual(getActiveServerAccountScope(), account);
    if (!isCurrent()) return;
    const context = await hqControl<{ directory: string; prompt: string }>(
        input.machineId, 'knowledge.context', { scope: { kind: 'research' } }, input.serverId,
    );
    if (!isCurrent()) return;
    await launchHqSession({ ...input, isCurrent, directory: context.directory, text: context.prompt, chatType: 'research' });
}
