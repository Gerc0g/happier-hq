import * as React from 'react';
import type { HqEntityTaskRequest } from '@/sync/domains/hq/hqEntity';
import { readHqEntityTask } from '@/sync/ops/hq';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { areServerAccountScopesEqual, serverAccountScopeKeySuffix, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { projectSyncedSessionAuthoringFields } from '@/sync/domains/input/drafts/sessionAuthoringDraftProjection';
import { flushSessionDraft, writeNewSessionDraft } from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import { prepareSessionDraftPersistenceStorage } from '@/sync/ops/sessionDrafts/sessionDraftPersistenceStorage';
import { resolveNewSessionDraftRouteIdentity } from '@/components/sessions/new/navigation/newSessionDraftRouteIdentity';
import { buildNewSessionLaunchRouteParams } from '@/components/sessions/new/navigation/newSessionRouteParams';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';

type LaunchRoute = Readonly<{ pathname: '/new'; params: ReturnType<typeof buildNewSessionLaunchRouteParams> }>;
type Input = Readonly<{
    machineId: string; serverId: string; scope: string; accountScope: ServerAccountScope | null;
    available: boolean; active: boolean; isMachineAvailable: () => boolean; onNavigate: (route: LaunchRoute) => void;
}>;

export function useHqAgentTaskLauncher(input: Input) {
    const [busy, setBusy] = React.useState(false);
    const [failed, setFailed] = React.useState(false);
    const current = React.useRef(input);
    current.current = input;
    const alive = React.useRef(false);
    const generation = React.useRef(0);
    const pending = React.useRef<number | null>(null);
    const identity = JSON.stringify([input.accountScope ? serverAccountScopeKeySuffix(input.accountScope) : null, input.serverId, input.machineId, input.scope]);
    React.useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
    React.useEffect(() => {
        generation.current++;
        pending.current = null;
        setBusy(false);
        setFailed(false);
    }, [identity, input.available, input.active]);

    const launch = React.useCallback(async (request: HqEntityTaskRequest) => {
        const origin = current.current;
        const accountScope = origin.accountScope;
        if (!alive.current || pending.current !== null || !origin.available || !origin.active || !accountScope || accountScope.serverId !== origin.serverId || request.scope !== origin.scope) return;
        const requestGeneration = ++generation.current;
        pending.current = requestGeneration;
        setBusy(true);
        setFailed(false);
        const isCurrent = () => {
            const latest = current.current;
            return alive.current && generation.current === requestGeneration && latest.active && latest.available
                && latest.machineId === origin.machineId && latest.serverId === origin.serverId && latest.scope === origin.scope
                && areServerAccountScopesEqual(latest.accountScope, accountScope)
                && areServerAccountScopesEqual(getActiveServerAccountScope(), accountScope) && latest.isMachineAvailable();
        };
        try {
            if (!isCurrent()) return;
            const task = await readHqEntityTask(origin.machineId, origin.serverId, request);
            if (!isCurrent()) return;
            await prepareSessionDraftPersistenceStorage();
            if (!isCurrent()) return;
            // Prepare before asking to leave: a failed read must not discard card edits.
            await runGuardedNavigation(() => {
                if (!isCurrent()) return;
                try {
                    const { draftId } = resolveNewSessionDraftRouteIdentity({ routeDraftId: undefined });
                    writeNewSessionDraft({
                        scope: accountScope, draftId, materializationIntent: 'seeded',
                        patch: { text: task.prompt, authoring: projectSyncedSessionAuthoringFields({
                            targetType: 'new_session', machineId: origin.machineId, serverId: origin.serverId, directory: task.directory,
                        }) },
                    });
                    fireAndForget(flushSessionDraft({ scope: accountScope, address: { kind: 'newSession', draftId } }), { tag: 'hq.agentTask.draft' });
                    current.current.onNavigate({ pathname: '/new', params: buildNewSessionLaunchRouteParams({
                        draftId, machineId: origin.machineId, directory: task.directory, targetServerId: origin.serverId,
                    }) });
                } catch {
                    if (isCurrent()) setFailed(true);
                }
            });
        } catch {
            if (isCurrent()) setFailed(true);
        } finally {
            if (pending.current === requestGeneration) {
                pending.current = null;
                if (alive.current) setBusy(false);
            }
        }
    }, []);
    return { launch, busy, failed };
}
