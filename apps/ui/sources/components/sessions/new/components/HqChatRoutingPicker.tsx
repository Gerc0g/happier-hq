import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Item } from '@/components/ui/lists/Item';
import { ToolbarButton } from '@/components/ui/buttons/ToolbarButton';
import { Icon } from '@/components/ui/icons/Icon';
import { normalizeNodeForView } from '@/components/ui/rendering/normalizeNodeForView';
import type { AgentInputExtraActionChip } from '@/components/sessions/agentInput/agentInputContracts';
import { AGENT_INPUT_CHIP_ICON_SIZE_PX, AGENT_INPUT_CHIP_ICON_STYLE, AGENT_INPUT_MENU_ICON_SIZE_PX } from '@/components/sessions/agentInput/definitions/agentInputChipIconMetrics';
import type { HqCatalog } from '@/sync/domains/hq/hqCatalog';
import type { HqAgentSnapshot } from '@/sync/domains/hq/hqAgentSettings';
import { resolveHqChatTarget, type HqChatType } from '@/sync/domains/hq/hqChatRouting';
import { t } from '@/text';

type Level = 'type' | 'company' | 'product' | 'repo' | 'branch';
export type HqChatRoutingPickerProps = Readonly<{
    catalog: HqCatalog | null;
    snapshot: HqAgentSnapshot | null;
    path: string;
    type?: HqChatType;
    taskName?: string;
    loading: boolean;
    error: boolean;
    onSelectType?: (type: HqChatType) => void;
    onSelectPath: (path: string) => void;
    onChangeTaskName?: (task: string) => void;
    onReload: () => void;
}>;

const styles = StyleSheet.create(theme => ({
    container: { padding: theme.margins.md, gap: theme.margins.sm, minWidth: 0 },
    secondary: { color: theme.colors.text.secondary, flexShrink: 1 },
    input: { color: theme.colors.text.primary, padding: theme.margins.md, borderRadius: theme.borderRadius.md, backgroundColor: theme.colors.surface.elevated },
}));

function routeView(props: HqChatRoutingPickerProps) {
    const target = props.catalog ? resolveHqChatTarget(props.catalog, props.path) : null;
    const type = props.type ?? target?.type ?? 'work';
    const work = target?.type === 'work' ? target : null;
    return { type, work, disabled: props.loading || props.error || !props.catalog || !props.snapshot };
}

function levelTitle(level: Level): string {
    return level === 'repo' ? t('hq.entity.repo') : t(`hq.routing.${level === 'type' ? 'title' : level}`);
}

function levelLabel(props: HqChatRoutingPickerProps, level: Level): string {
    const { type, work } = routeView(props);
    if (level === 'type') return t(`hq.routing.${type}`);
    if (level === 'company') return work?.company?.slug ?? levelTitle(level);
    if (level === 'product') return work?.product?.slug ?? levelTitle(level);
    if (level === 'repo') return work?.repo?.name ?? levelTitle(level);
    return work?.worktree?.branch || work?.worktree?.id || t('hq.newWorktree');
}

// Each composer chip opens only its own choice, rather than a menu containing nested menus.
export function HqChatRoutingPicker(props: HqChatRoutingPickerProps & Readonly<{ level?: Level; onClose?: () => void }>) {
    const { type, work, disabled } = routeView(props);
    const selectPath = (path: string) => {
        if (disabled) return;
        props.onSelectPath(path);
        if (props.level !== 'branch' || path !== work?.repo?.path) props.onClose?.();
    };
    const renderLevel = (level: Level) => {
        if (level === 'type') return <View key={level}>
            {(['work', 'research'] as const).map(choice => <Item key={choice}
                testID={`hq-chat-type-${choice}`} title={t(`hq.routing.${choice}`)} subtitle={t(`hq.routing.${choice}Description`)}
                selected={type === choice} showChevron={false} disabled={disabled || (choice === 'research' && !props.catalog?.research?.path)}
                onPress={() => {
                    if (disabled) return;
                    props.onSelectType?.(choice);
                    selectPath(choice === 'research' ? props.catalog!.research!.path : work?.path ?? '');
                }} />)}
        </View>;
        const choices = level === 'company' ? props.catalog?.companies.map(company => ({ path: company.path, title: company.slug }))
            : level === 'product' ? work?.company?.products.map(product => ({ path: product.path, title: product.slug }))
            : level === 'repo' ? work?.product?.repos.map(repo => ({ path: repo.path, title: repo.name }))
            : work?.repo ? [{ path: work.repo.path, title: t('hq.newWorktree') }, ...work.repo.worktrees.map(worktree => ({ path: worktree.path, title: worktree.branch || worktree.id }))] : [];
        return <View key={level}>
            {choices?.map(choice => <Item key={choice.path} testID={`hq-chat-target:${choice.path}`} title={choice.title}
                selected={props.path === choice.path} showChevron={false} disabled={disabled} onPress={() => selectPath(choice.path)} />)}
            {level === 'branch' && work?.repo && !work.worktree ? <View>
                <Text style={styles.secondary}>{t('hq.taskPrompt')}</Text>
                <TextInput testID="hq-chat-worktree-task" accessibilityLabel={t('hq.taskPrompt')} value={props.taskName ?? ''}
                    onChangeText={props.onChangeTaskName} editable={!disabled} style={styles.input} autoCapitalize="sentences" />
            </View> : null}
            {!choices?.length ? <Text style={styles.secondary}>{t('hq.routing.chooseTarget')}</Text> : null}
        </View>;
    };
    return <View style={styles.container} testID="hq-chat-routing-picker">
        {props.loading ? <Text style={styles.secondary}>{t('hq.routing.loading')}</Text> : null}
        {props.error ? <View><Text accessibilityRole="alert" style={styles.secondary}>{t('hq.routing.unavailable')}</Text>
            <ToolbarButton testID="hq-chat-routing-retry" label={t('common.retry')} onPress={props.onReload} disabled={props.loading} />
        </View> : null}
        {props.level ? renderLevel(props.level) : <>{renderLevel('type')}{type === 'work' ? (['company', 'product', 'repo', 'branch'] as const).map(renderLevel) : null}</>}
    </View>;
}

export function createHqChatRoutingChips(props: HqChatRoutingPickerProps): AgentInputExtraActionChip[] {
    const { type, work, disabled } = routeView(props);
    const levels: Level[] = type === 'work' ? ['type', 'company', 'product', 'repo', 'branch'] : ['type'];
    return levels.map(level => {
        const key = level === 'type' ? 'hq-chat-routing' : `hq-chat-${level}`;
        const label = levelLabel(props, level);
        const unavailable = disabled || (level === 'product' && !work?.company) || (level === 'repo' && !work?.product) || (level === 'branch' && !work?.repo);
        return {
            key,
            controlId: ({ type: 'hqAgent', company: 'hqCompany', product: 'hqProduct', repo: 'hqRepo', branch: 'hqWorktree' } as const)[level],
            stabilityKey: JSON.stringify([props.path, props.type, props.taskName, props.snapshot?.settings.revision, props.loading, props.error, props.catalog]),
            collapsedContentPopover: {
                title: levelTitle(level), label,
                icon: tint => normalizeNodeForView(<Icon name="folder-open" size={AGENT_INPUT_MENU_ICON_SIZE_PX} color={tint} />),
                renderContent: ({ requestClose }) => <HqChatRoutingPicker {...props} level={level} onClose={requestClose} />,
                maxWidthCap: 520, maxHeightCap: 640, scrollEnabled: true, keyboardShouldPersistTaps: 'handled',
            },
            render: ({ chipStyle, iconColor, showLabel, textStyle, chipAnchorRef, toggleCollapsedPopover }) => <Pressable
                ref={chipAnchorRef} testID={key} accessibilityRole="button" accessibilityLabel={`${levelTitle(level)}: ${label}`}
                accessibilityState={{ disabled: unavailable }} disabled={unavailable && !props.error}
                onPress={() => toggleCollapsedPopover?.(key)} style={({ pressed }) => chipStyle(pressed)}>
                {normalizeNodeForView(<Icon name="folder-open" size={AGENT_INPUT_CHIP_ICON_SIZE_PX} color={iconColor} style={AGENT_INPUT_CHIP_ICON_STYLE} />)}
                {showLabel ? <Text numberOfLines={1} style={textStyle}>{label}</Text> : null}
            </Pressable>,
        };
    });
}
