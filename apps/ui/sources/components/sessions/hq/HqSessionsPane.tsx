import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { IconAction } from '@/components/ui/buttons/IconAction';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { useActiveServerAccountScope, useLaunchSelectionMachines } from '@/sync/domains/state/storage';
import { serverAccountScopeKeySuffix, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { buildHqTreeRows, type HqRepoTarget, type HqTreeRow } from '@/sync/domains/hq/hqCatalog';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { saveHqChatType } from '@/sync/domains/state/persistence';
import { createHqWorktree } from '@/sync/ops/hq';
import { getMachineDisplayName, isMachineOnline } from '@/utils/sessions/machineUtils';
import { useNavigateToSession } from '@/hooks/session/useNavigateToSession';
import { resolveNewSessionDraftRouteIdentity } from '@/components/sessions/new/navigation/newSessionDraftRouteIdentity';
import { readSessionIdFromPathname } from '@/components/sessions/shell/readSessionIdFromPathname';
import { Modal } from '@/modal';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { t } from '@/text';
import { HqTreeView } from './HqTreeView';
import { useHqCatalogs } from './useHqCatalogs';
import { prepareResearchSession } from './launchHqSession';
import type { HqSessionListView } from '../shell/SessionsListStorageChrome';

type Props = Readonly<{
    data: readonly SessionListViewItem[] | null;
    pathname: string;
    active: boolean;
    interactive: boolean;
    history: React.ReactNode;
    view: HqSessionListView;
}>;

const stylesheet = StyleSheet.create((theme) => ({
    container: { flex: 1, minHeight: 0 },
    toolbar: { paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: { color: theme.colors.text.secondary, fontSize: 12, flex: 1 },
    message: { paddingHorizontal: 16, paddingVertical: 12, color: theme.colors.text.secondary, fontSize: 13 },
    refresh: { width: 44, height: 44 },
}));

export function HqSessionsPane(props: Props) {
    const scope = useActiveServerAccountScope();
    return <ScopedHqSessionsPane key={scope ? serverAccountScopeKeySuffix(scope) : 'unbound'} {...props} scope={scope} />;
}

function ScopedHqSessionsPane(props: Props & Readonly<{ scope: ServerAccountScope | null }>) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const navigateToSession = useNavigateToSession();
    const machines = useLaunchSelectionMachines();
    const view = props.view;
    const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set());
    const [busy, setBusy] = React.useState(false);
    const busyRef = React.useRef(false);
    const activeRef = React.useRef(false);
    activeRef.current = props.active && props.interactive && view === 'projects';
    const mounted = React.useRef(true);
    React.useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const { catalogs, loading, failedMachineIds, refresh } = useHqCatalogs({
        scope: props.scope, machines, active: props.active && view === 'projects',
    });
    const rows = React.useMemo(() => buildHqTreeRows({
        catalogs, sessions: props.data ?? [], serverId: props.scope?.serverId ?? '', expanded,
    }), [catalogs, props.data, props.scope?.serverId, expanded]);
    const openChat = (target: HqRepoTarget, path: string) => {
        if (!props.scope || !mounted.current || !props.interactive) return;
        if (!machines.some((machine) => machine.id === target.machineId && isMachineOnline(machine))) return;
        const { draftId } = resolveNewSessionDraftRouteIdentity({ routeDraftId: undefined });
        saveHqChatType('work');
        router.push({ pathname: '/new', params: { draftId, machineId: target.machineId, directory: path, spawnServerId: props.scope.serverId } });
    };
    const handleCreateWorktree = async (target: HqRepoTarget) => {
        if (busyRef.current || !props.scope || !props.interactive) return;
        if (!machines.some((machine) => machine.id === target.machineId && isMachineOnline(machine))) return;
        busyRef.current = true;
        setBusy(true);
        try {
            const task = await Modal.prompt(t('hq.newWorktree'), t('hq.taskPrompt'));
            if (!task?.trim() || !mounted.current) return;
            const path = await createHqWorktree(target, task.trim(), props.scope.serverId);
            if (!mounted.current) return;
            await refresh();
            openChat(target, path);
        } catch {
            if (mounted.current) {
                // A lost response may follow a completed mutation. Reconcile, never retry it.
                await refresh();
                if (mounted.current) Modal.alert(t('hq.newWorktree'), t('hq.createFailed'));
            }
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };
    const handleSession = (row: Extract<HqTreeRow, { kind: 'session' }>) => {
        void navigateToSession(row.item.session.id, { serverId: row.item.serverId ?? props.scope?.serverId });
    };
    const researchMachines = catalogs.filter(({ machineId, catalog }) => catalog.research && machines.some(machine => machine.id === machineId && isMachineOnline(machine)));
    const startResearch = async (machineId: string) => {
        if (!props.scope || !props.active || !props.interactive || busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        try {
            await prepareResearchSession({ machineId, serverId: props.scope.serverId, isCurrent: () => mounted.current && activeRef.current, navigate: route => router.push(route) });
        } catch {
            if (mounted.current) Modal.alert(t('hq.newResearchChat'), t('hq.researchFailed'));
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };
    const selectResearchMachine = () => {
        if (researchMachines.length === 1) { void startResearch(researchMachines[0].machineId); return; }
        Modal.alert(t('hq.newResearchChat'), t('newSession.selectMachineTitle'), [
            ...researchMachines.map(({ machineId }) => ({ text: getMachineDisplayName(machines.find(machine => machine.id === machineId)!) || machineId, onPress: () => { void startResearch(machineId); } })),
            { text: t('common.cancel'), style: 'cancel' },
        ]);
    };
    const offlineMachines = machines.filter((machine) => !isMachineOnline(machine));
    return (
        <View style={styles.container} testID="hq-sessions-pane">
            {view === 'history' ? props.history : (
                <>
                    <View style={styles.toolbar}>
                        <Text style={styles.heading}>{machines.map(getMachineDisplayName).filter(Boolean).join(' · ')}</Text>
                        {loading ? <ActivitySpinner size="small" color={theme.colors.text.secondary} /> : null}
                        <IconAction testID="hq-refresh" accessibilityLabel={t('common.refresh')} disabled={loading || busy || !props.active || !props.interactive} onPress={() => { void refresh(); }} style={styles.refresh}>
                            <Icon name="arrow-clockwise" size={ICON_SIZE.md} color={theme.colors.text.secondary} />
                        </IconAction>
                    </View>
                    {failedMachineIds.length > 0 ? <Text testID="hq-load-error" style={styles.message}>{t('hq.loadFailed')}</Text> : null}
                    {offlineMachines.length > 0 ? <Text style={styles.message}>{offlineMachines.map(getMachineDisplayName).join(', ')} — {t('status.offline')}</Text> : null}
                    {machines.length === 0 ? <Text style={styles.message}>{t('newSession.noMachinesFound')}</Text> : null}
                    {!loading && catalogs.length > 0 && rows.length === 0 ? <Text style={styles.message}>{t('hq.empty')}</Text> : null}
                    <HqTreeView
                        rows={rows}
                        expanded={expanded}
                        onNewResearch={researchMachines.length > 0 ? selectResearchMachine : undefined}
                        interactive={props.interactive}
                        busy={busy || loading}
                        availableMachineIds={new Set(machines.filter((machine) => isMachineOnline(machine)).map((machine) => machine.id))}
                        activeSessionId={readSessionIdFromPathname(props.pathname)}
                        onToggle={(key) => setExpanded((previous) => {
                            const next = new Set(previous);
                            if (next.has(key)) next.delete(key); else next.add(key);
                            return next;
                        })}
                        onOpenEntity={(entity) => {
                            if (!props.scope || !props.interactive) return;
                            const serverId = props.scope.serverId;
                            void runGuardedNavigation(() => router.push({ pathname: '/hq/entity', params: { scope: entity.scope, machineId: entity.machineId, serverId } }));
                        }}
                        onCreateWorktree={(target) => { void handleCreateWorktree(target); }}
                        onNewChat={openChat}
                        onSession={handleSession}
                    />
                </>
            )}
        </View>
    );
}
