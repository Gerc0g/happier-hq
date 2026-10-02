import * as React from 'react';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { HqEntityCard, type HqEntityCardProps } from '@/components/sessions/hq/HqEntityCard';
import { storage, useActiveServerAccountScope, useLaunchSelectionMachines } from '@/sync/domains/state/storage';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import { getMachineDisplayName, isMachineOnline } from '@/utils/sessions/machineUtils';
import { useSessionScreenIsFocused } from '@/components/sessions/shell/useSessionScreenIsFocused';
import { resolveNewSessionDraftRouteIdentity } from '@/components/sessions/new/navigation/newSessionDraftRouteIdentity';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { t } from '@/text';
import { Text } from '@/components/ui/text/Text';
import { ConstrainedScreenContent } from '@/components/ui/layout/ConstrainedScreenContent';
import { isHqWorkspaceEnabled } from '@/sync/domains/hq/hqRuntime';
import { useHqAgentTaskLauncher } from '@/components/sessions/hq/useHqAgentTaskLauncher';
import { resolveMachineForActiveServerFromState } from '@/sync/store/domains/machines/resolveMachinesForActiveServerFromState';

export default function HqEntityScreen() {
    const params = useLocalSearchParams<{ machineId?: string; serverId?: string; scope?: string; tab?: string }>();
    const accountScope = useActiveServerAccountScope();
    const machines = useLaunchSelectionMachines();
    const navigation = useNavigation();
    const router = useRouter();
    const active = useSessionScreenIsFocused();
    const machineId = typeof params.machineId === 'string' ? params.machineId : '';
    const serverId = typeof params.serverId === 'string' ? params.serverId : '';
    const scope = typeof params.scope === 'string' ? params.scope : '';
    const machine = accountScope?.serverId === serverId ? machines.find((candidate) => candidate.id === machineId) : undefined;
    const available = Boolean(machine && isMachineOnline(machine));
    const isMachineAvailable = React.useCallback(() => {
        const latest = resolveMachineForActiveServerFromState(storage.getState(), machineId);
        return Boolean(latest && isMachineOnline(latest));
    }, [machineId]);
    const agentTask = useHqAgentTaskLauncher({
        machineId, serverId, scope, accountScope, available, active, isMachineAvailable,
        onNavigate: (route) => router.push(route),
    });
    const initialTab = ['overview', 'context', 'onboarding', 'checks', 'history'].includes(params.tab ?? '') ? params.tab as HqEntityCardProps['initialTab'] : 'overview';
    if (!isHqWorkspaceEnabled()) return <ConstrainedScreenContent><Text>{t('common.unavailable')}</Text></ConstrainedScreenContent>;
    return <>
        <Stack.Screen options={{ title: t('hq.entity.openCard') }} />
        <HqEntityCard
            key={JSON.stringify([accountScope ? serverAccountScopeKeySuffix(accountScope) : null, serverId, machineId, scope])}
            machineId={machineId} serverId={serverId} scope={scope} available={available} active={active}
            machineLabel={(machine ? getMachineDisplayName(machine) : null) ?? machineId} initialTab={initialTab} navigation={navigation}
            onAgentTask={agentTask.launch} agentTaskBusy={agentTask.busy} agentTaskFailed={agentTask.failed}
            onCompanySettings={() => { void runGuardedNavigation(() => router.push({ pathname: '/hq/connections', params: { machineId, serverId, companyId: scope.split('/')[0] } })); }}
            onNavigate={(nextScope, tab) => router.push({ pathname: '/hq/entity', params: { machineId, serverId, scope: nextScope, tab: tab ?? 'overview' } })}
            onNewChat={(directory) => {
                if (!available || !active) return;
                void runGuardedNavigation(() => {
                    const { draftId } = resolveNewSessionDraftRouteIdentity({ routeDraftId: undefined });
                    router.push({ pathname: '/new', params: { draftId, machineId, directory, spawnServerId: serverId } });
                });
            }}
        />
    </>;
}
