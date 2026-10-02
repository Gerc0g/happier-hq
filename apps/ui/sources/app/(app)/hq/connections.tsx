import * as React from 'react';
import { Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { HqConnectionsScreen } from '@/components/sessions/hq/HqConnectionsScreen';
import { useActiveServerAccountScope, useLaunchSelectionMachines } from '@/sync/domains/state/storage';
import { useSessionScreenIsFocused } from '@/components/sessions/shell/useSessionScreenIsFocused';
import { isMachineOnline } from '@/utils/sessions/machineUtils';
import { isHqWorkspaceEnabled } from '@/sync/domains/hq/hqRuntime';
import { ConstrainedScreenContent } from '@/components/ui/layout/ConstrainedScreenContent';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

export default function CompanyConnectionsRoute() {
    const params = useLocalSearchParams<{ machineId?: string; serverId?: string; companyId?: string }>();
    const account = useActiveServerAccountScope();
    const machines = useLaunchSelectionMachines();
    const navigation = useNavigation();
    const active = useSessionScreenIsFocused();
    const machineId = typeof params.machineId === 'string' ? params.machineId : '';
    const serverId = typeof params.serverId === 'string' ? params.serverId : '';
    const companyId = typeof params.companyId === 'string' ? params.companyId : '';
    const machine = account?.serverId === serverId ? machines.find((entry) => entry.id === machineId) : undefined;
    if (!isHqWorkspaceEnabled()) return <ConstrainedScreenContent><Text>{t('common.unavailable')}</Text></ConstrainedScreenContent>;
    return <><Stack.Screen options={{ title: t('hq.connections.title') }} /><HqConnectionsScreen key={`${account?.accountId}:${serverId}:${machineId}:${companyId}`} companyId={companyId} machineId={machineId} serverId={serverId} navigation={navigation} active={active} available={Boolean(machine && isMachineOnline(machine))} /></>;
}
