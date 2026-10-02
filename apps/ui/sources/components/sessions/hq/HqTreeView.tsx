import * as React from 'react';
import { FlatList, Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/ui/text/Text';
import { Item } from '@/components/ui/lists/Item';
import { IconAction } from '@/components/ui/buttons/IconAction';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { Typography } from '@/constants/Typography';
import { SessionListIdentity } from '@/components/sessions/shell/SessionListIdentity';
import { getSessionName } from '@/utils/sessions/sessionUtils';
import { t } from '@/text';
import type { HqEntityTarget } from '@/sync/domains/hq/hqEntity';
import type { HqRepoTarget, HqTreeRow } from '@/sync/domains/hq/hqCatalog';

export type HqTreeViewProps = Readonly<{
    rows: readonly HqTreeRow[];
    expanded: ReadonlySet<string>;
    onNewResearch?: () => void;
    interactive: boolean;
    busy: boolean;
    availableMachineIds: ReadonlySet<string>;
    activeSessionId?: string | null;
    onToggle: (key: string) => void;
    onOpenEntity: (entity: HqEntityTarget) => void;
    onCreateWorktree: (target: HqRepoTarget) => void;
    onNewChat: (target: HqRepoTarget, path: string) => void;
    onSession: (row: Extract<HqTreeRow, { kind: 'session' }>) => void;
}>;

const stylesheet = StyleSheet.create((theme) => ({
    list: { flex: 1 },
    row: {
        backgroundColor: 'transparent',
        minHeight: 48,
        marginRight: theme.margins.sm,
        marginBottom: theme.margins.xs,
        paddingLeft: theme.margins.sm,
        paddingRight: theme.margins.xs,
        borderRadius: theme.borderRadius.md,
        borderLeftWidth: 2,
        borderLeftColor: 'transparent',
    },
    section: { marginTop: theme.margins.sm, backgroundColor: theme.colors.surface.elevated },
    count: { ...Typography.rowMeta(), color: theme.colors.text.secondary, paddingHorizontal: theme.margins.sm },
    company: {
        marginTop: theme.margins.md,
        backgroundColor: theme.colors.surface.elevated,
        borderLeftColor: theme.colors.accent.purple,
    },
    product: {
        marginTop: theme.margins.sm,
        backgroundColor: theme.colors.surface.base,
        borderLeftColor: theme.colors.accent.blue,
    },
    repo: { borderLeftColor: theme.colors.border.default },
    worktree: { borderLeftColor: theme.colors.accent.green },
    companyTitle: { ...Typography.default('semiBold'), textTransform: 'uppercase', letterSpacing: 1 },
    groupTitle: { ...Typography.default('semiBold') },
    textWrap: { minWidth: 0, flexShrink: 1, ...Platform.select({ web: { overflowWrap: 'anywhere' as const } }) },
    branch: { ...Typography.mono(), color: theme.colors.text.secondary },
    disclosure: { flexDirection: 'row', alignItems: 'center', gap: theme.margins.xs },
    selected: { backgroundColor: theme.colors.surface.selected },
    actions: { flexDirection: 'row', alignItems: 'center' },
    action: { width: 44, height: 44 },
    stackedActionsRow: { flexDirection: 'column', alignItems: 'flex-end' },
}));

export function HqTreeView(props: HqTreeViewProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    // Three 44px actions plus the repo indentation leave too little text space below this width.
    const [stackRepoActions, setStackRepoActions] = React.useState(true);
    const renderItem = ({ item: row }: { item: HqTreeRow }) => {
        const indent = { marginLeft: theme.margins.sm + row.depth * theme.margins.sm };
        if (row.kind === 'session') {
            return (
                <Item
                    testID={`hq-row-${row.key}`}
                    title={getSessionName(row.item.session)}
                    icon={<SessionListIdentity session={row.item.session} display="agentLogo" avatarSize={24} agentLogoSize={ICON_SIZE.md} />}
                    onPress={() => props.onSession(row)}
                    disabled={!props.interactive}
                    showChevron={false}
                    style={[styles.row, indent, row.item.session.id === props.activeSessionId ? styles.selected : null]}
                />
            );
        }
        const expanded = props.expanded.has(row.key);
        const section = row.kind === 'work' || row.kind === 'research' || row.kind === 'other';
        const target = row.target;
        const path = row.path;
        const levelIcon = row.kind === 'work' ? 'folder' : row.kind === 'research' ? 'books' : row.kind === 'company' ? 'stack'
            : row.kind === 'product' ? 'cube'
                : row.kind === 'repo' ? 'code'
                    : row.kind === 'worktree' ? 'git-branch' : 'chats-circle';
        const levelColor = row.kind === 'company' ? theme.colors.accent.purple
            : row.kind === 'product' ? theme.colors.accent.blue
                : row.kind === 'repo' ? theme.colors.accent.orange
                    : row.kind === 'worktree' ? theme.colors.accent.green : theme.colors.text.secondary;
        return (
            <Item
                testID={`hq-row-${row.key}`}
                title={row.kind === 'other' ? t('hq.otherSessions') : row.kind === 'work' ? t('hq.navigation.work') : row.kind === 'research' ? t('hq.researchSessions') : row.title}
                titleLines={0}
                titleStyle={[styles.textWrap, row.kind === 'company' ? styles.companyTitle : row.kind !== 'worktree' ? styles.groupTitle : undefined]}
                subtitle={row.kind === 'worktree' ? row.branch : expanded && row.kind === 'other' ? t('hq.otherSessionsHelp') : expanded && row.kind === 'research' ? t('hq.researchSessionsHelp') : undefined}
                subtitleLines={0}
                subtitleStyle={row.kind === 'worktree' ? [styles.branch, styles.textWrap] : undefined}
                leftElement={(
                    <View style={styles.disclosure}>
                        <Icon name={expanded ? 'caret-down' : 'caret-right'} size={ICON_SIZE.xs} color={theme.colors.text.secondary} />
                        <Icon name={levelIcon} size={ICON_SIZE.sm} color={levelColor} />
                    </View>
                )}
                iconBoxSize={ICON_SIZE.xs + ICON_SIZE.sm + theme.margins.xs}
                accessibilityState={{ expanded }}
                onPress={() => props.onToggle(row.key)}
                disabled={!props.interactive}
                showChevron={false}
                style={[styles.row, indent, section ? styles.section : styles[row.kind], row.kind === 'repo' && stackRepoActions && target ? styles.stackedActionsRow : null]}
                rightElementOutsidePressable
                rightElement={section || target || row.entity ? (
                    <View style={styles.actions}>
                        {section ? <Text style={styles.count}>{row.sessionCount ?? 0}</Text> : null}
                        {row.kind === 'research' ? (
                            <IconAction testID="hq-new-research" accessibilityLabel={t('hq.newResearchChat')}
                                disabled={!props.interactive || props.busy || !props.onNewResearch}
                                onPress={props.onNewResearch} style={styles.action}>
                                <Icon name="plus" size={ICON_SIZE.md} color={theme.colors.text.secondary} />
                            </IconAction>
                        ) : null}
                        {row.entity ? (
                            <IconAction
                                testID={`hq-card-${row.key}`}
                                accessibilityLabel={`${t('hq.entity.openCard')} — ${row.title}`}
                                disabled={!props.interactive}
                                onPress={() => { if (row.entity) props.onOpenEntity(row.entity); }}
                                style={styles.action}
                            >
                                <Icon name="info" size={ICON_SIZE.md} color={theme.colors.text.secondary} />
                            </IconAction>
                        ) : null}
                        {target && row.kind === 'repo' ? (
                            <IconAction
                                testID={`hq-create-${row.key}`}
                                accessibilityLabel={`${t('hq.newWorktree')} — ${row.title}`}
                                disabled={!props.interactive || props.busy || !props.availableMachineIds.has(target.machineId)}
                                onPress={() => props.onCreateWorktree(target)}
                                style={styles.action}
                            >
                                <Icon name="git-branch" size={ICON_SIZE.md} color={theme.colors.text.secondary} />
                            </IconAction>
                        ) : null}
                        {target && path ? (
                            <IconAction
                                testID={`hq-chat-${row.key}`}
                                accessibilityLabel={`${t('hq.newChat')} — ${row.title}`}
                                disabled={!props.interactive || props.busy || !props.availableMachineIds.has(target.machineId)}
                                onPress={() => props.onNewChat(target, path)}
                                style={styles.action}
                            >
                                <Icon name="plus" size={ICON_SIZE.md} color={theme.colors.text.secondary} />
                            </IconAction>
                        ) : null}
                    </View>
                ) : undefined}
            />
        );
    };
    return (
        <FlatList
            testID="hq-project-tree"
            style={styles.list}
            onLayout={(event) => setStackRepoActions(event.nativeEvent.layout.width < 420)}
            data={props.rows}
            keyExtractor={(row) => row.key}
            renderItem={renderItem}
            extraData={{ ...props, stackRepoActions }}
        />
    );
}
