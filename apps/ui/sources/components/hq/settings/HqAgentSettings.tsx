import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useNavigation } from 'expo-router';
import { z } from 'zod';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Switch } from '@/components/ui/forms/Switch';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { ConstrainedScreenContent } from '@/components/ui/layout/ConstrainedScreenContent';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { hqControl, HqControlError } from '@/sync/ops/hqControl';
import type { HqMachineTarget } from '@/components/hq/HqScreenShell';
import { HqRuntimePanel } from './HqRuntimePanel';
import { useActiveUnsavedChangesGuard } from '@/utils/navigation/useActiveUnsavedChangesGuard';
import { useUnsavedChangesBeforeRemoveGuard } from '@/utils/navigation/useUnsavedChangesBeforeRemoveGuard';
import { Modal } from '@/modal';
import { t } from '@/text';
import { HqAgentPresetSchema, HqAgentImportReportSchema, HqAgentSettingsSchema, HqAgentSnapshotSchema, type HqAgentPreset, type HqAgentSettings as Settings, type HqAgentSnapshot } from '@/sync/domains/hq/hqAgentSettings';

const styles = StyleSheet.create((theme) => ({
    content: { padding: 20, gap: 20, paddingBottom: 56 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
    heading: { color: theme.colors.text.primary, fontWeight: '600' },
    secondary: { color: theme.colors.text.secondary },
    field: { gap: 8 },
    input: { padding: 12, borderWidth: 1, borderColor: theme.colors.border.default, borderRadius: 10, color: theme.colors.text.primary, backgroundColor: theme.colors.input.background, minHeight: 44 },
    editor: { minHeight: 180, textAlignVertical: 'top' },
    code: { padding: 16, backgroundColor: theme.colors.surface.base, borderRadius: 12, color: theme.colors.text.primary },
}));

export function HqAgentSettings({ target, active }: { target: HqMachineTarget; active: boolean }) {
    const navigation = useNavigation();
    const [snapshot, setSnapshot] = React.useState<HqAgentSnapshot | null>(null);
    const [draft, setDraft] = React.useState<Settings | null>(null);
    const [selectedPreset, setPreset] = React.useState<'work' | 'research' | 'ordinary'>('work');
    const preset = draft?.presets[selectedPreset] ? selectedPreset : 'work';
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const [preview, setPreview] = React.useState<{ fingerprint: string; config: string } | null>(null);
    const [advanced, setAdvanced] = React.useState(false);
    const [importText, setImportText] = React.useState('');
    const [mcpText, setMcpText] = React.useState<string | null>(null);
    const [inspection, setInspection] = React.useState<string>('');
    const alive = React.useRef(true);
    React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const current = React.useRef({ active, target }); current.current = { active, target };
    const dirty = Boolean(draft && snapshot && JSON.stringify(draft) !== JSON.stringify(snapshot.settings));
    const hasUnsavedChanges = dirty || importText.length > 0 || mcpText !== null;
    const dirtyRef = React.useRef(hasUnsavedChanges); dirtyRef.current = hasUnsavedChanges;
    const requestDecision = React.useCallback(async () => (await Modal.confirm(t('common.discardChanges'), t('common.unsavedChangesWarning'), { confirmText: t('common.discard'), cancelText: t('common.keepEditing'), destructive: true })) ? 'discard' as const : 'keepEditing' as const, []);
    const discard = React.useCallback(() => { setDraft(snapshot?.settings ?? null); setImportText(''); setMcpText(null); setPreview(null); dirtyRef.current = false; }, [snapshot]);
    const guard = React.useMemo(() => ({ isDirtyRef: dirtyRef, requestDecision, onDiscard: discard, tag: 'HqAgentSettings' }), [requestDecision, discard]);
    useActiveUnsavedChangesGuard({ navigation, guard });
    useUnsavedChangesBeforeRemoveGuard({ navigation, ...guard, onContinue: (action) => { (navigation as { dispatch?: (action: unknown) => void }).dispatch?.(action); } });
    React.useEffect(() => {
        if (!hasUnsavedChanges || Platform.OS !== 'web' || typeof window === 'undefined') return;
        const targetWindow = window;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        targetWindow.addEventListener('beforeunload', warn);
        return () => targetWindow.removeEventListener('beforeunload', warn);
    }, [hasUnsavedChanges]);
    const run = async (operation: string, args: unknown) => {
        if (!current.current.active) throw new Error('inactive');
        return hqControl<unknown>(target.machineId, operation, args, target.serverId);
    };
    const reload = React.useCallback(async () => {
        if (!current.current.active) return;
        setBusy(true); setError('');
        try {
            const value = HqAgentSnapshotSchema.parse(await hqControl(target.machineId, 'agent.get', {}, target.serverId));
            if (alive.current && current.current.active) { setSnapshot(value); setDraft(value.settings); setPreview(null); }
        } catch { if (alive.current) setError(t('hq.agent.loadFailed')); }
        finally { if (alive.current) setBusy(false); }
    }, [target.machineId, target.serverId]);
    React.useEffect(() => { if (active && !snapshot) void reload(); }, [active, snapshot, reload]);
    const change = (patch: Partial<HqAgentPreset>) => {
        setDraft(value => {
            const selected = value?.presets[preset];
            if (!value || !selected) return value;
            return { ...value, presets: { ...value.presets, [preset]: { ...selected, ...patch } } };
        });
        setPreview(null);
    };
    const perform = async (action: () => Promise<void>) => {
        if (busy || !active) return;
        setBusy(true); setError('');
        try { await action(); }
        catch (reason) { if (alive.current) setError(reason instanceof HqControlError && reason.code.includes('CONFLICT') ? t('hq.entity.conflict') : t('hq.agent.actionFailed')); }
        finally { if (alive.current) setBusy(false); }
    };
    if (!draft || !snapshot) return <ConstrainedScreenContent><View style={styles.content}>{busy ? <ActivitySpinner /> : null}<Text>{error}</Text><RoundButton title={t('common.retry')} disabled={busy || !active} action={async () => { await reload(); }} /></View></ConstrainedScreenContent>;
    const p = draft.presets[preset] ?? draft.presets.work;
    const editable = active && !busy;
    const reviewed = preview?.fingerprint === JSON.stringify(draft) && mcpText === null;
    return <ScrollView keyboardShouldPersistTaps="handled"><ConstrainedScreenContent style={styles.content}>
        <View style={styles.field}><Text accessibilityRole="header" style={styles.heading}>Codex</Text><Text style={styles.secondary}>{t('hq.agent.intro')}</Text></View>
        <HqRuntimePanel target={target} active={active} />
        <SegmentedTabBar testIDPrefix="hq-agent-preset" tabs={[{ id: 'work', label: t('hq.agent.work') }, { id: 'research', label: t('hq.agent.research') }, ...(draft.presets.ordinary ? [{ id: 'ordinary' as const, label: t('hq.routing.ordinary') }] : [])]} activeTabId={preset} onSelectTab={(next) => { void (async () => { if (next === preset) return; if (mcpText !== null && await requestDecision() !== 'discard') return; setPreset(next); setMcpText(null); setPreview(null); })(); }} />
        {error ? <Text testID="hq-agent-error" accessibilityRole="alert">{error}</Text> : null}
        <View style={styles.field}><Text style={styles.heading}>{t('hq.agent.model')}</Text><TextInput testID="hq-agent-model" accessibilityLabel={t('hq.agent.model')} style={styles.input} value={p.model} editable={editable} onChangeText={model => change({ model })} autoCapitalize="none" autoCorrect={false} placeholder={t('hq.agent.defaultModel')} /></View>
        <View style={styles.field}><Text style={styles.heading}>{t('hq.agent.effort')}</Text><TextInput accessibilityLabel={t('hq.agent.effort')} style={styles.input} value={p.effort} editable={editable} onChangeText={effort => change({ effort })} autoCapitalize="none" autoCorrect={false} /></View>
        <ItemGroup><Item title={t('hq.agent.network')} subtitle={t('hq.agent.networkHelp')} subtitleLines={0} rightElement={<Switch value={p.network} onValueChange={network => change({ network })} disabled={!editable} />} /></ItemGroup>
        <View style={styles.field}><Text style={styles.heading}>{t('hq.agent.search')}</Text><SegmentedTabBar tabs={[{ id: 'disabled', label: t('hq.agent.searchOff') }, { id: 'cached', label: t('hq.agent.searchCached') }, { id: 'live', label: t('hq.agent.searchLive') }]} activeTabId={p.webSearch} onSelectTab={(webSearch) => { if (editable) change({ webSearch }); }} /></View>
        <ItemGroup title={t('hq.agent.skills')} footer={t('hq.agent.skillsHelp')}>
            {snapshot.skills.filter(skill => preset !== 'research' || skill.research).map(skill => <Item key={skill.name} title={skill.name} subtitle={skill.description} subtitleLines={2} rightElement={<Switch value={p.skills.includes(skill.name)} disabled={!editable} onValueChange={enabled => change({ skills: enabled ? [...p.skills, skill.name] : p.skills.filter(name => name !== skill.name) })} />} />)}
        </ItemGroup>
        <Item testID="hq-agent-advanced" title={t('hq.agent.advanced')} onPress={() => setAdvanced(value => !value)} accessibilityState={{ expanded: advanced }} />
        {advanced ? <>
            <View style={styles.field}><Text style={styles.heading}>{t('hq.agent.serviceTier')}</Text><Text style={styles.secondary}>{t('hq.agent.serviceTierHelp')}</Text><TextInput testID="hq-agent-service-tier" accessibilityLabel={t('hq.agent.serviceTier')} style={styles.input} value={p.serviceTier ?? ''} editable={editable} onChangeText={serviceTier => change({ serviceTier })} autoCapitalize="none" autoCorrect={false} /></View>
            <View style={styles.field}><Text style={styles.heading}>{t('hq.agent.approvalsReviewer')}</Text><SegmentedTabBar tabs={[{ id: 'user', label: t('hq.agent.userReviewer') }, { id: 'auto_review', label: t('hq.agent.autoReviewer') }]} activeTabId={p.approvalsReviewer ?? 'user'} onSelectTab={approvalsReviewer => { if (editable) change({ approvalsReviewer }); }} /></View>
            <View style={styles.field}><Text style={styles.heading}>{t('hq.agent.jsRepl')}</Text><SegmentedTabBar tabs={[{ id: 'inherit', label: t('hq.agent.inherit') }, { id: 'enabled', label: t('common.enabled') }, { id: 'disabled', label: t('common.disabled') }]} activeTabId={p.jsRepl === undefined ? 'inherit' : p.jsRepl ? 'enabled' : 'disabled'} onSelectTab={value => { if (editable) change({ jsRepl: value === 'inherit' ? undefined : value === 'enabled' }); }} /></View>
            <View style={styles.field}><Text style={styles.heading}>{t('hq.agent.instructions')}</Text><TextInput accessibilityLabel={t('hq.agent.instructions')} multiline style={[styles.input, styles.editor]} value={p.instructions} editable={editable} onChangeText={instructions => change({ instructions })} /></View>
            <ItemGroup title={t('hq.agent.hooks')}><Item title={t('hq.agent.contextHook')} rightElement={<Switch disabled={!editable} value={p.hooks.sessionContext} onValueChange={sessionContext => change({ hooks: { ...p.hooks, sessionContext } })} />} /><Item title={t('hq.agent.captureHook')} subtitle={t('hq.agent.captureHelp')} subtitleLines={0} rightElement={<Switch disabled={!editable} value={p.hooks.inboxCapture} onValueChange={inboxCapture => change({ hooks: { ...p.hooks, inboxCapture } })} />} /></ItemGroup>
            <View style={styles.field}><Text style={styles.heading}>MCP</Text><Text style={styles.secondary}>{t('hq.agent.mcpHelp')}</Text><TextInput testID="hq-agent-mcp-input" accessibilityLabel={t('hq.agent.mcpConfig')} multiline style={[styles.input, styles.editor]} value={mcpText ?? JSON.stringify(p.mcp, null, 2)} editable={editable} onChangeText={setMcpText} autoCapitalize="none" autoCorrect={false} /><RoundButton title={t('hq.agent.useMcp')} disabled={!editable || mcpText === null} action={async () => { try { change({ mcp: HqAgentPresetSchema.shape.mcp.parse(JSON.parse(mcpText ?? '[]')) }); setMcpText(null); setError(''); } catch { setError(t('hq.agent.invalidJson')); } }} /></View>
            <View style={styles.field}><Text style={styles.heading}>{t('hq.agent.import')}</Text><Text style={styles.secondary}>{t('hq.agent.importHelp')}</Text><TextInput testID="hq-agent-import-input" accessibilityLabel={t('hq.agent.import')} multiline style={[styles.input, styles.editor]} value={importText} onChangeText={setImportText} editable={editable} autoCapitalize="none" autoCorrect={false} /><RoundButton title={t('hq.agent.inspectImport')} disabled={!editable || !importText.trim()} action={async () => { await perform(async () => { const report = HqAgentImportReportSchema.parse(await run('agent.previewImport', { preset, toml: importText })); if (!alive.current) return; setDraft({ ...draft, presets: { ...draft.presets, [preset]: report.preset }, importReport: report }); setImportText(''); setPreview(null); }); }} /></View>
            {draft.importReport ? <View style={styles.field}>{(['imported', 'replaced', 'skipped'] as const).map(kind => <View key={kind}><Text style={styles.heading}>{t(`hq.agent.${kind}`)}</Text>{draft.importReport![kind].map(item => <Text key={item.key}>{item.key} · {item.reason}</Text>)}</View>)}</View> : null}
        </> : null}
        <Text style={styles.secondary}>{t('hq.agent.scopeHelp')}</Text>
        <View style={styles.row}>
            <RoundButton testID="hq-agent-preview" title={t('hq.entity.reviewChanges')} disabled={!editable || !dirty || mcpText !== null} action={async () => { await perform(async () => { const result = z.object({ config: z.string() }).parse(await run('agent.preview', { settings: draft, preset })); if (alive.current) setPreview({ fingerprint: JSON.stringify(draft), config: result.config }); }); }} />
            <RoundButton testID="hq-agent-save" title={t('common.save')} disabled={!editable || !dirty || !reviewed} action={async () => { await perform(async () => { const saved = HqAgentSettingsSchema.parse(await run('agent.save', { settings: draft, revision: snapshot.settings.revision })); if (!alive.current) return; setSnapshot({ ...snapshot, settings: saved }); setDraft(saved); setPreview(null); }); }} />
            <RoundButton title={t('common.refresh')} disabled={!editable || hasUnsavedChanges} action={async () => { await reload(); }} />
            <RoundButton testID="hq-agent-inspect" title={t('hq.agent.check')} disabled={!editable || mcpText !== null || importText.length > 0} action={async () => { await perform(async () => { const value = await run('agent.inspect', { preset, settings: draft }); if (alive.current) setInspection(JSON.stringify(value, null, 2)); }); }} />
        </View>
        {preview ? <Text testID="hq-agent-preview-content" selectable style={styles.code}>{preview.config}</Text> : null}
        {inspection ? <Text selectable style={styles.code}>{inspection}</Text> : null}
        {busy ? <ActivitySpinner /> : null}
    </ConstrainedScreenContent></ScrollView>;
}
