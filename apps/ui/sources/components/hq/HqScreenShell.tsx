import * as React from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/ui/text/Text';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ConstrainedScreenContent } from '@/components/ui/layout/ConstrainedScreenContent';
import { useActiveServerAccountScope, useLaunchSelectionMachines } from '@/sync/domains/state/storage';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import { getMachineDisplayName, isMachineOnline } from '@/utils/sessions/machineUtils';
import { useSessionScreenIsFocused } from '@/components/sessions/shell/useSessionScreenIsFocused';
import { isHqWorkspaceEnabled } from '@/sync/domains/hq/hqRuntime';
import { t } from '@/text';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';

export type HqMachineTarget = Readonly<{ machineId: string; serverId: string }>;
type Props = Readonly<{ title: string; children: (target: HqMachineTarget, active: boolean) => React.ReactNode }>;

/** Every owner screen is keyed to the authenticated account and relay. A route
 * from another account never authorizes reads through a cached machine id. */
export function HqScreenShell(props: Props) {
    const account = useActiveServerAccountScope();
    const params = useLocalSearchParams<{ machineId?: string; serverId?: string }>();
    if (!isHqWorkspaceEnabled() || !account || (params.serverId && params.serverId !== account.serverId)) {
        return <ConstrainedScreenContent><Text>{t('common.unavailable')}</Text></ConstrainedScreenContent>;
    }
    return <ScopedShell key={serverAccountScopeKeySuffix(account)} {...props} serverId={account.serverId} requestedMachineId={typeof params.machineId === 'string' ? params.machineId : ''} />;
}

function ScopedShell(props: Props & { serverId: string; requestedMachineId: string }) {
    const machines = useLaunchSelectionMachines();
    const active = useSessionScreenIsFocused();
    const [selectedId, setSelectedId] = React.useState(props.requestedMachineId);
    const machine = selectedId ? machines.find(item => item.id === selectedId) : machines.find(isMachineOnline);
    const available = Boolean(machine && isMachineOnline(machine));
    React.useEffect(() => { if (!selectedId && machine) setSelectedId(machine.id); }, [selectedId, machine?.id]);
    return <View style={{ flex: 1, minHeight: 0 }}>
        <Stack.Screen options={{ title: props.title }} />
        {machines.length > 1 || !available ? <ConstrainedScreenContent><ItemGroup title={t('newSession.selectMachineTitle')}>
            {machines.map(item => <Item key={item.id} testID={`hq-machine-${item.id}`} title={getMachineDisplayName(item)} subtitle={isMachineOnline(item) ? t('status.online') : t('status.offline')} selected={machine?.id === item.id} onPress={() => { if (machine?.id !== item.id) void runGuardedNavigation(() => setSelectedId(item.id)); }} />)}
            {machines.length === 0 ? <Text>{t('newSession.noMachinesFound')}</Text> : null}
        </ItemGroup></ConstrainedScreenContent> : null}
        {!available ? <ConstrainedScreenContent><Text>{t('hq.entity.offline')}</Text></ConstrainedScreenContent> : null}
        {machine ? <React.Fragment key={`${props.serverId}:${machine.id}`}>{props.children({ machineId: machine.id, serverId: props.serverId }, active && available)}</React.Fragment> : null}
    </View>;
}
