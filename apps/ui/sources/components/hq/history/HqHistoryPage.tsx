import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { HqScreenShell, type HqMachineTarget } from '@/components/hq/HqScreenShell';
import { ToolbarButton } from '@/components/ui/buttons/ToolbarButton';
import { Text } from '@/components/ui/text/Text';
import { ConstrainedScreenContent } from '@/components/ui/layout/ConstrainedScreenContent';
import { hqControl } from '@/sync/ops/hqControl';
import { t } from '@/text';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { ImportedHistoryScreen } from './ImportedHistoryScreen';
import type { HistoryScope } from './types';
import { historyStyles as styles } from './styles';

export function HqHistoryPage() {
    return <HqScreenShell title={t('hq.history.title')}>
        {(target, active) => <ScopedHistory target={target} active={active} />}
    </HqScreenShell>;
}

function ScopedHistory({ target, active }: Readonly<{ target: HqMachineTarget; active: boolean }>) {
    const params = useLocalSearchParams<{ company?: string; kind?: string }>();
    const [scopes, setScopes] = React.useState<HistoryScope[]>([]);
    const [scope, setScope] = React.useState<HistoryScope>(() => {
        if (params.company) return { kind: 'company', company: params.company };
        return { kind: params.kind === 'personal' || params.kind === 'vault' || params.kind === 'work' ? 'personal' : 'research' };
    });
    const [failed, setFailed] = React.useState(false);
    React.useEffect(() => {
        if (!active) return;
        let disposed = false;
        setFailed(false);
        hqControl<HistoryScope[]>(target.machineId, 'knowledge.scopes', {}, target.serverId).then((result) => {
            if (disposed) return;
            setScopes([...result.filter((item) => item.kind === 'research' || item.kind === 'company'), { kind: 'personal' }]);
        }, () => { if (!disposed) setFailed(true); });
        return () => { disposed = true; };
    }, [active, target.machineId, target.serverId]);
    const boundTarget = React.useMemo(() => ({ ...target, scope }), [scope, target.machineId, target.serverId]);
    const selectScope = (item: HistoryScope) => {
        if (scope.kind === item.kind && scope.company === item.company) return;
        void runGuardedNavigation(() => setScope(item));
    };
    return <View style={styles.root}>
        <ConstrainedScreenContent style={styles.areaHeader}>
            <Text style={styles.secondary}>{t('hq.history.selectScope')}</Text>
            <View style={styles.row}>{scopes.map((item) => <ToolbarButton
                key={`${item.kind}:${item.company ?? ''}`}
                testID={`hq-history-scope:${item.kind}:${item.company ?? ''}`}
                label={item.kind === 'company' ? item.company! : item.kind === 'personal' ? t('hq.history.personal') : t('hq.history.research')}
                style={styles.button}
                active={scope.kind === item.kind && scope.company === item.company}
                onPress={() => selectScope(item)}
            />)}</View>
            {failed && <Text accessibilityRole="alert" style={styles.text}>{t('hq.history.failed')}</Text>}
        </ConstrainedScreenContent>
        <ImportedHistoryScreen key={`${scope.kind}:${scope.company ?? ''}`} target={boundTarget} active={active} />
    </View>;
}
