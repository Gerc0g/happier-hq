import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useStore } from 'zustand';
import { Text, TextInput, type AppTextInputProps } from '@/components/ui/text/Text';
import { FocusRing } from '@/components/ui/interaction/FocusRing';
import { useIsKeyboardModality } from '@/components/ui/interaction/inputModalityStore';
import { StatusPill, type StatusPillVariant } from '@/components/ui/status/StatusPill';
import { PressableSurface } from '@/components/ui/interaction/PressableSurface';
import { ToolbarButton } from '@/components/ui/buttons/ToolbarButton';
import { getCachedIntlDateTimeFormat } from '@/utils/datetime/cachedIntlFormatters';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { ConstrainedScreenContent } from '@/components/ui/layout/ConstrainedScreenContent';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Item } from '@/components/ui/lists/Item';
import { ExpandableItem } from '@/components/ui/lists/ExpandableItem';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { DiffViewer } from '@/components/ui/code/diff/DiffViewer';
import { FontWeights, Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { HqEntityCard as Card, HqEntityTaskRequest } from '@/sync/domains/hq/hqEntity';
import { Modal } from '@/modal';
import { useActiveUnsavedChangesGuard } from '@/utils/navigation/useActiveUnsavedChangesGuard';
import { useUnsavedChangesBeforeRemoveGuard } from '@/utils/navigation/useUnsavedChangesBeforeRemoveGuard';
import { isHqEntityDraftDirty, useHqEntity } from './useHqEntity';

type Tab = 'overview' | 'context' | 'onboarding' | 'checks' | 'history';
type Model = ReturnType<typeof useHqEntity>;
const EMPTY_NAVIGATION = {};
const styles = StyleSheet.create((theme) => ({
    root: { flex: 1, backgroundColor: theme.colors.background.canvas },
    content: { padding: theme.margins.lg, gap: theme.margins.lg, paddingBottom: theme.margins.xl },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.margins.sm },
    between: { justifyContent: 'space-between' },
    stack: { gap: theme.margins.md, minWidth: 0 },
    identity: { gap: theme.margins.xs, flexGrow: 1, flexShrink: 1, minWidth: 0 },
    header: { gap: theme.margins.sm },
    sectionTitle: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
    panel: { padding: theme.margins.lg, borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.surface.base, gap: theme.margins.md, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.default },
    title: { ...Typography.rowTitle(), color: theme.colors.text.primary, ...Platform.select({ web: { overflowWrap: 'anywhere' as const } }) },
    heading: { ...Typography.rowTitle(), color: theme.colors.text.primary, flexShrink: 1, ...Platform.select({ web: { overflowWrap: 'anywhere' as const } }) },
    text: { ...Typography.rowTitle(), ...Typography.body(), fontWeight: FontWeights.regular, color: theme.colors.text.primary, ...Platform.select({ web: { overflowWrap: 'anywhere' as const } }) },
    secondary: { ...Typography.rowMeta(), color: theme.colors.text.secondary, ...Platform.select({ web: { overflowWrap: 'anywhere' as const } }) },
    path: { ...Typography.rowMeta(), ...Typography.mono(), color: theme.colors.text.secondary, minWidth: 0, flexShrink: 1, ...Platform.select({ web: { overflowWrap: 'anywhere' as const } }) },
    section: { paddingVertical: theme.margins.md, gap: theme.margins.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border.default },
    input: { ...Typography.rowTitle(), ...Typography.body(), fontWeight: FontWeights.regular, color: theme.colors.text.primary, backgroundColor: theme.colors.input.background, borderWidth: 1, borderColor: theme.colors.border.default, borderRadius: theme.borderRadius.md, padding: theme.margins.md },
    markdownInput: { ...Typography.rowTitle(), ...Typography.mono(), fontWeight: FontWeights.regular, minHeight: 280, textAlignVertical: 'top' },
    progressTrack: { height: 6, borderRadius: theme.borderRadius.sm, backgroundColor: theme.colors.surface.elevated, overflow: 'hidden' },
    progressValue: { height: 6, backgroundColor: theme.colors.accent.blue },
    notice: { ...Typography.rowTitle(), ...Typography.body(), fontWeight: FontWeights.regular, color: theme.colors.text.primary, padding: theme.margins.md, borderRadius: theme.borderRadius.md, backgroundColor: theme.colors.surface.elevated, gap: theme.margins.sm },
    action: { minHeight: Platform.OS === 'android' ? 48 : 44, maxWidth: '100%', alignSelf: 'flex-start', justifyContent: 'center', paddingVertical: theme.margins.sm },
    badge: { minHeight: Platform.OS === 'android' ? 48 : 44, maxWidth: '100%', alignSelf: 'flex-start', alignItems: 'flex-start', justifyContent: 'center' },
}));

const healthLabel = (value: Card['health']['status']) => ({ ok: t('hq.entity.ok'), warning: t('hq.entity.warning'), error: t('common.error'), unknown: t('hq.entity.unknown') })[value];
function formatTimestamp(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? t('hq.entity.unknown') : getCachedIntlDateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const kindLabel = (value: Card['kind']) => ({ company: t('hq.entity.company'), product: t('hq.entity.product'), repo: t('hq.entity.repo') })[value];

function HealthBadge(props: Readonly<{ status: Card['health']['status']; detail: string; onPress: () => void; testID?: string; expanded?: boolean }>) {
    const variants: Record<Card['health']['status'], StatusPillVariant> = { ok: 'success', warning: 'warning', error: 'danger', unknown: 'neutral' };
    const label = healthLabel(props.status);
    return <PressableSurface testID={props.testID} accessibilityLabel={`${label}: ${props.detail}`} accessibilityState={props.expanded === undefined ? undefined : { expanded: props.expanded }} webTooltip={props.detail} onPress={props.onPress} style={styles.badge}>
        <StatusPill testID={props.testID ? `${props.testID}-pill` : undefined} variant={variants[props.status]} label={label} labelVariant="phrase" labelNumberOfLines={1} />
    </PressableSurface>;
}

function ChildHealth({ children, known, navigate }: Readonly<{ children: Card['children']; known: boolean; navigate: (scope: string, tab?: Tab) => void }>) {
    if (!children.length) return null;
    return <><Text style={styles.heading}>{t('hq.entity.children')}</Text>{children.map((child) => {
        const detail = known ? `${t('common.error')}: ${child.errorCount} · ${t('hq.entity.warning')}: ${child.warningCount}` : t('hq.entity.offline');
        return <Item key={child.scope} title={child.title} titleLines={0} subtitleLines={0} density="compact" titleStyle={styles.title} subtitle={detail} onPress={() => navigate(child.scope, 'checks')} rightElementOutsidePressable rightElement={<HealthBadge testID={`hq-child-health-${child.scope}`} status={known ? child.healthStatus : 'unknown'} detail={detail} onPress={() => navigate(child.scope, 'checks')} />} />;
    })}</>;
}

function Disclosure(props: Readonly<{ title: string; children: React.ReactNode; testID?: string }>) {
    const [expanded, setExpanded] = React.useState(false);
    return <ExpandableItem expanded={expanded} onExpandedChange={setExpanded} testID={props.testID} header={({ headerProps }) => <Item title={props.title} {...headerProps} showChevron />}><View style={styles.stack}>{props.children}</View></ExpandableItem>;
}

function Action(props: Readonly<{ title: string; onPress: () => void; disabled?: boolean; testID?: string; primary?: boolean; active?: boolean }>) {
    return <ToolbarButton label={props.title} onPress={props.onPress} disabled={props.disabled} active={props.active} testID={props.testID} tone={props.primary ? 'primary' : 'default'} style={styles.action} />;
}

function HqTextInput(props: AppTextInputProps) {
    const [focused, setFocused] = React.useState(false);
    const keyboard = useIsKeyboardModality();
    return <View><TextInput {...props} onFocus={(event) => { setFocused(true); props.onFocus?.(event); }} onBlur={(event) => { setFocused(false); props.onBlur?.(event); }} /><FocusRing visible={focused && keyboard} /></View>;
}

function ContextPanel({ model, navigate }: Readonly<{ model: Model; navigate: (scope: string, tab?: Tab) => void }>) {
    const card = model.card!;
    const draft = useStore(model.draft);
    const [mode, setMode] = React.useState<'markdown' | 'preview' | 'review'>('markdown');
    React.useEffect(() => { setMode('markdown'); }, [card.document.revision]);
    const contentDirty = draft.content !== card.document.content;
    const namespaceDirty = draft.namespace !== card.settings.namespace;
    return <View style={styles.stack}>
        <View style={[styles.row, styles.between]}>
            <Text style={styles.heading}>{t('hq.entity.ownContext')}</Text>
            <View style={styles.row}>
                <Action title={t('files.markdown')} active={mode === 'markdown'} testID="hq-context-edit" onPress={() => setMode('markdown')} />
                <Action title={t('hq.entity.preview')} active={mode === 'preview'} onPress={() => setMode('preview')} />
            </View>
        </View>
        <Text selectable style={styles.path}>{card.document.path}</Text>
        {mode === 'markdown' ? <HqTextInput
            testID="hq-context-input" accessibilityLabel={t('hq.entity.ownContext')} multiline autoCapitalize="none" autoCorrect={false}
            value={draft.content} onChangeText={(content) => model.draft.setState({ content })} editable={!model.saving} style={[styles.input, styles.markdownInput]}
        /> : mode === 'preview' ? <MarkdownView markdown={draft.content} /> : <DiffViewer testID="hq-context-diff" mode="text" oldText={card.document.content} newText={draft.content} filePath={card.document.path} wrapLines virtualized={false} />}
        <Text style={styles.secondary}>{contentDirty ? t('hq.entity.unsaved') : t('hq.entity.currentVersion')}</Text>
        <View style={styles.row}>
            <Action title={t('common.discardChanges')} disabled={!contentDirty || model.saving} onPress={() => { model.draft.setState({ content: card.document.content }); setMode('markdown'); }} />
            {mode === 'review' ? <Action title={t('common.save')} testID="hq-context-save" primary disabled={!contentDirty || !model.canWrite} onPress={() => { void model.update({ content: draft.content }); }} />
                : <Action title={t('hq.entity.reviewChanges')} testID="hq-context-review" primary disabled={!contentDirty || !model.canWrite} onPress={() => setMode('review')} />}
        </View>
        <Disclosure title={t('hq.entity.inherited')}>
            <Text style={styles.secondary}>{t('hq.entity.inheritedHelp')}</Text>
            {card.parents.map((parent) => <Item key={parent.scope} title={parent.title} subtitle={parent.documentPath} titleLines={0} subtitleLines={0} titleStyle={styles.title} subtitleStyle={styles.path} onPress={() => navigate(parent.scope, 'context')} />)}
        </Disclosure>
        <Disclosure title={t('hq.entity.technical')}>
            <Text style={styles.heading}>{t('hq.entity.namespace')}</Text><Text style={styles.secondary}>{t('hq.entity.namespaceHelp')}</Text>
            {card.kind === 'repo' ? <Text selectable style={styles.path}>{card.settings.namespace}</Text> : <>
                <HqTextInput testID="hq-namespace-input" accessibilityLabel={t('hq.entity.namespace')} value={draft.namespace} onChangeText={(namespace) => model.draft.setState({ namespace })} editable={!model.saving} autoCapitalize="none" autoCorrect={false} style={styles.input} />
                {namespaceDirty ? <Text selectable style={styles.path}>{card.settings.namespace} → {draft.namespace}</Text> : null}
                <Action title={t('hq.entity.saveSetting')} testID="hq-namespace-save" disabled={!namespaceDirty || !draft.namespace.trim() || !model.canWrite} onPress={() => { void model.update({ settings: { namespace: draft.namespace } }); }} />
            </>}
            <Text style={styles.heading}>{t('hq.entity.directory')}</Text><Text selectable style={styles.path}>{card.path}</Text>
            {card.settings.vcs ? <Text selectable style={styles.path}>{card.settings.vcs}</Text> : null}
            {card.settings.host ? <Text selectable style={styles.path}>{card.settings.host}</Text> : null}
            {card.settings.gitEmail ? <Text selectable style={styles.path}>{card.settings.gitEmail}</Text> : null}
        </Disclosure>
    </View>;
}

function Overview({ card, known, setTab, navigate, openCheck }: Readonly<{ card: Card; known: boolean; setTab: (tab: Tab) => void; navigate: (scope: string, tab?: Tab) => void; openCheck: (id?: string) => void }>) {
    const primaryCheck = card.health.checks.find((check) => check.status === card.health.status);
    return <View style={styles.stack}>
        <View style={styles.panel}>
            <View style={[styles.row, styles.between]}><Text style={styles.heading}>{t('hq.entity.contextProgress')}</Text><Text style={styles.text}>{card.onboarding.completed} / {card.onboarding.total}</Text></View>
            <View accessibilityRole="progressbar" accessibilityLabel={t('hq.entity.contextProgress')} accessibilityValue={{ min: 0, max: card.onboarding.total, now: card.onboarding.completed }} style={styles.progressTrack}><View style={[styles.progressValue, { width: `${card.onboarding.total ? Math.min(100, 100 * card.onboarding.completed / card.onboarding.total) : 0}%` }]} /></View>
            <Text style={styles.secondary}>{t('hq.entity.notBlocking')}</Text>
            <Action title={t('hq.entity.onboarding')} onPress={() => setTab('onboarding')} />
        </View>
        <View style={styles.panel}>
            <View style={[styles.row, styles.between]}><Text style={styles.heading}>{t('hq.entity.ownHealth')}</Text>
            <HealthBadge status={known ? card.health.status : 'unknown'} detail={known ? primaryCheck?.detail ?? healthLabel(card.health.status) : t('hq.entity.offline')} testID="hq-own-health" onPress={() => openCheck(primaryCheck?.id)} /></View>
            <Text style={styles.secondary}>{t('hq.entity.checkedAt')} · {formatTimestamp(card.health.checkedAt)}</Text>
            <ChildHealth children={card.children} known={known} navigate={navigate} />
        </View>
        <Text style={styles.heading}>{t('hq.entity.contextChain')}</Text>
        <Text style={styles.secondary}>{t('hq.entity.inheritedHelp')}</Text>
        <View>{card.parents.map((parent) => <Item key={parent.scope} title={parent.title} titleLines={0} titleStyle={styles.title} subtitle={kindLabel(parent.kind)} density="compact" onPress={() => navigate(parent.scope, 'context')} />)}<Item title={card.title} titleLines={0} titleStyle={styles.title} subtitle={kindLabel(card.kind)} density="compact" onPress={() => setTab('context')} /></View>
        <Disclosure title={t('hq.entity.storage')}><Text selectable style={styles.path}>{card.path}</Text><Text selectable style={styles.path}>{card.document.path}</Text><Action title={t('hq.entity.history')} onPress={() => setTab('history')} /></Disclosure>
    </View>;
}

function Onboarding({ model, setTab, onAgentTask, agentTaskBusy }: Readonly<{ model: Model; setTab: (tab: Tab) => void; onAgentTask?: HqEntityCardProps['onAgentTask']; agentTaskBusy?: boolean }>) {
    const dirty = useStore(model.draft, isHqEntityDraftDirty);
    const card = model.card!;
    const canPrepare = card.agentActions?.some((action) => action.id === 'onboard' && action.skill === 'onboard-agents-md') && onAgentTask;
    const prepare = (itemId?: string) => onAgentTask?.({ scope: card.scope, kind: card.kind, directory: card.path, ...(itemId ? { itemId } : {}) });
    return <View style={styles.stack}>
        {canPrepare ? <View style={styles.stack}>
            <Action testID="hq-agent-onboard" title={t('hq.entity.fillWithAgent')} primary disabled={!model.canWrite || agentTaskBusy} onPress={() => { prepare(); }} />
            <Text style={styles.secondary}>{t('hq.entity.agentTaskReview')}</Text>
        </View> : null}
        <Text style={styles.secondary}>{t('hq.entity.confirmHelp')}</Text>
        {model.card!.onboarding.items.map((item) => <View key={item.id} style={styles.section}>
            <View style={[styles.row, styles.between]}><Text style={[styles.heading, styles.sectionTitle]}>{item.title}</Text><Text style={styles.secondary}>{({ missing: t('hq.entity.missing'), ready: t('hq.entity.ready'), review: t('hq.entity.review') })[item.status]}</Text></View>
            <Text style={styles.text}>{item.description}</Text>
            <View style={styles.row}>
                <Action testID={`hq-onboarding-open-${item.id}`} title={item.automatic ? t('hq.entity.checks') : t('hq.entity.context')} onPress={() => setTab(item.automatic ? 'checks' : 'context')} />
                {!item.automatic ? <Action testID={`hq-confirm-${item.id}`} title={item.status === 'ready' ? t('hq.entity.unconfirm') : t('hq.entity.confirm')} disabled={!model.canWrite || dirty || item.status === 'missing'} onPress={() => { void model.update({ confirm: { id: item.id, confirmed: item.status !== 'ready' } }); }} /> : null}
                {canPrepare && !item.automatic ? <Action testID={`hq-agent-onboard-${item.id}`} title={t('hq.entity.fillItemWithAgent')} disabled={!model.canWrite || agentTaskBusy} onPress={() => { prepare(item.id); }} /> : null}
            </View>
        </View>)}
        <Text style={styles.secondary}>{dirty ? t('hq.entity.saveBeforeConfirm') : t('hq.entity.notBlocking')}</Text>
    </View>;
}

function CheckRow({ check, known, initiallyExpanded, setTab }: Readonly<{ check: Card['health']['checks'][number]; known: boolean; initiallyExpanded: boolean; setTab: (tab: Tab) => void }>) {
    const [expanded, setExpanded] = React.useState(initiallyExpanded);
    const status = known ? check.status : 'unknown';
    return <View testID={`hq-check-${check.id}`} accessibilityLabel={`${check.title}: ${healthLabel(status)}`} style={styles.section}>
        <View style={[styles.row, styles.between]}><Text style={[styles.heading, styles.sectionTitle]}>{check.title}</Text><HealthBadge testID={`hq-health-${check.id}`} status={status} detail={known ? check.detail : t('hq.entity.offline')} expanded={expanded} onPress={() => setExpanded((value) => !value)} /></View>
        {expanded ? <View testID={`hq-check-detail-${check.id}`} style={styles.stack}>
            <Text style={styles.secondary}>{check.detail}</Text>
            {check.path ? <Text selectable style={styles.path}>{check.path}</Text> : null}
            {check.blocking ? <Text style={styles.secondary}>{t('hq.entity.blocking')}</Text> : null}
            {check.status !== 'ok' ? <Action title={t('hq.entity.context')} onPress={() => setTab('context')} /> : null}
        </View> : null}
    </View>;
}

function Checks({ card, known, navigate, setTab, selectedCheck }: Readonly<{ card: Card; known: boolean; navigate: (scope: string, tab?: Tab) => void; setTab: (tab: Tab) => void; selectedCheck?: string }>) {
    return <View style={styles.stack}>
        <Text style={styles.secondary}>{t('hq.entity.localChecks')} · {formatTimestamp(card.health.checkedAt)}</Text>
        <Text style={styles.heading}>{t('hq.entity.ownHealth')}</Text>
        {card.health.checks.map((check) => <CheckRow key={check.id} check={check} known={known} initiallyExpanded={check.id === selectedCheck} setTab={setTab} />)}
        <ChildHealth children={card.children} known={known} navigate={navigate} />
    </View>;
}

export type HqEntityCardProps = Readonly<{
    machineId: string; serverId: string; scope: string; available: boolean; active: boolean; machineLabel: string;
    initialTab?: Tab; navigation?: unknown;
    onNavigate: (scope: string, tab?: Tab) => void; onNewChat: (path: string) => void;
    onAgentTask?: (request: HqEntityTaskRequest) => void;
    agentTaskBusy?: boolean; agentTaskFailed?: boolean;
    onCompanySettings?: () => void;
}>;

export function HqEntityCard(props: HqEntityCardProps) {
    const model = useHqEntity(props);
    const [tab, selectTab] = React.useState<Tab>(props.initialTab ?? 'overview');
    const scrollRef = React.useRef<ScrollView>(null);
    const setTab = React.useCallback((next: Tab) => {
        selectTab(next);
        scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, []);
    const [selectedCheck, setSelectedCheck] = React.useState<string>();
    const dirty = useStore(model.draft, isHqEntityDraftDirty);
    const isDirtyRef = React.useRef(dirty);
    isDirtyRef.current = dirty;
    React.useEffect(() => {
        if (!dirty || Platform.OS !== 'web' || typeof window === 'undefined') return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);
    const navigation = props.navigation ?? EMPTY_NAVIGATION;
    const requestDecision = React.useCallback(async () => (await Modal.confirm(t('common.discardChanges'), t('common.unsavedChangesWarning'), { confirmText: t('common.discard'), cancelText: t('common.keepEditing'), destructive: true }) ? 'discard' as const : 'keepEditing' as const), []);
    const discard = React.useCallback(() => model.draft.setState((draft) => ({ content: draft.originalContent, namespace: draft.originalNamespace })), [model.draft]);
    const guard = React.useMemo(() => ({ isDirtyRef, requestDecision, onDiscard: discard, tag: 'HqEntityCard' }), [requestDecision, discard]);
    useActiveUnsavedChangesGuard({ navigation, guard });
    useUnsavedChangesBeforeRemoveGuard({ navigation, ...guard, onContinue: (action) => { (navigation as { dispatch?: (action: unknown) => void }).dispatch?.(action); } });
    const navigate = async (scope: string, nextTab?: Tab) => {
        if (dirty && await requestDecision() !== 'discard') return;
        isDirtyRef.current = false;
        discard();
        props.onNavigate(scope, nextTab);
    };
    const card = model.card;
    const known = props.available && model.error === null;
    return <View style={styles.root} testID="hq-entity-card">
        <ScrollView ref={scrollRef} testID="hq-entity-scroll" keyboardShouldPersistTaps="handled"><ConstrainedScreenContent style={styles.content}>
            <View style={styles.header}>
                {props.scope.includes('/') ? <Text style={styles.secondary}>{props.scope.split('/').slice(0, -1).join(' / ')}</Text> : null}
                <View style={[styles.row, styles.between]}>
                    <View style={styles.identity}><Text accessibilityRole="header" style={styles.title}>{card?.title ?? props.scope.split('/').at(-1)}</Text><Text style={styles.secondary}>{card ? `${kindLabel(card.kind)} · ` : ''}{props.machineLabel}</Text></View>
                    <View style={styles.row}>
                        {(model.loading || model.saving) && props.available && props.active ? <ActivitySpinner size="small" /> : null}
                        <Action title={t('common.refresh')} testID="hq-entity-refresh" disabled={!props.available || !props.active || model.loading || model.saving} onPress={() => { void model.refresh(); }} />
                        {card ? <Action testID="hq-entity-start" title={t('hq.newChat')} primary disabled={!props.available || !props.active || model.saving} onPress={() => props.onNewChat(card.path)} /> : null}
                    </View>
                </View>
            </View>
            {!props.available ? <Text testID="hq-entity-offline" style={styles.notice}>{t('hq.entity.offline')}</Text> : null}
            {model.error ? <Text accessibilityRole="alert" testID="hq-entity-error" style={styles.notice}>{model.error === 'conflict' ? t('hq.entity.conflict') : model.error === 'save' ? t('hq.entity.saveFailed') : t('hq.entity.loadFailed')}</Text> : null}
            {props.agentTaskBusy ? <Text accessibilityLiveRegion="polite" style={styles.secondary}>{t('hq.entity.agentTaskPreparing')}</Text> : null}
            {props.agentTaskFailed ? <Text accessibilityRole="alert" testID="hq-agent-task-error" style={styles.notice}>{t('hq.entity.agentTaskFailed')}</Text> : null}
            <SegmentedTabBar scrollable tabs={(['overview', 'context', 'onboarding', 'checks', 'history'] as const).map((id) => ({ id, label: t(`hq.entity.${id}`) }))} activeTabId={tab} onSelectTab={setTab} testIDPrefix="hq-entity-tab" />
            {card ? <>
                {tab === 'overview' && card.kind === 'company' && props.onCompanySettings ? <Item testID="hq-company-settings" title={t('hq.navigation.companySettings')} subtitle={t('hq.connections.title')} onPress={props.onCompanySettings} /> : null}
                {tab === 'overview' ? <Overview card={card} known={known} setTab={setTab} openCheck={(id) => { setSelectedCheck(id); setTab('checks'); }} navigate={(scope, nextTab) => { void navigate(scope, nextTab); }} /> : null}
                {tab === 'context' ? <ContextPanel model={model} navigate={(scope, nextTab) => { void navigate(scope, nextTab); }} /> : null}
                {tab === 'onboarding' ? <Onboarding model={model} setTab={setTab} onAgentTask={props.onAgentTask} agentTaskBusy={props.agentTaskBusy} /> : null}
                {tab === 'checks' ? <Checks card={card} known={known} selectedCheck={selectedCheck} navigate={(scope, nextTab) => { void navigate(scope, nextTab); }} setTab={setTab} /> : null}
                {tab === 'history' ? <View style={styles.stack}>{card.history.length ? card.history.map((entry, index) => <View key={`${entry.at}-${index}`} style={styles.section}><Text style={styles.heading}>{entry.actor}</Text><Text style={styles.secondary}>{formatTimestamp(entry.at)}</Text><Text selectable style={styles.text}>{entry.detail}</Text></View>) : <Text style={styles.secondary}>{t('hq.entity.noHistory')}</Text>}</View> : null}
            </> : null}
        </ConstrainedScreenContent></ScrollView>
    </View>;
}
