import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Text, TextInput, type AppTextInputProps } from '@/components/ui/text/Text';
import { ToolbarButton } from '@/components/ui/buttons/ToolbarButton';
import { ConstrainedScreenContent } from '@/components/ui/layout/ConstrainedScreenContent';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { StatusPill } from '@/components/ui/status/StatusPill';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { FocusRing } from '@/components/ui/interaction/FocusRing';
import { useIsKeyboardModality } from '@/components/ui/interaction/inputModalityStore';
import { Switch } from '@/components/ui/forms/Switch';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { t } from '@/text';
import { companyConnections } from '@/sync/ops/hqConnections';
import { HqConnectionsSchema, newEnvironment, newGitConnection, type HqConnections, type HqGitConnection, type HqEnvironment } from '@/sync/domains/hq/hqConnections';
import { useActiveUnsavedChangesGuard } from '@/utils/navigation/useActiveUnsavedChangesGuard';
import { useUnsavedChangesBeforeRemoveGuard } from '@/utils/navigation/useUnsavedChangesBeforeRemoveGuard';

const styles = StyleSheet.create((theme) => ({
    root: { flex: 1, backgroundColor: theme.colors.background.canvas },
    content: { padding: theme.margins.lg, paddingBottom: theme.margins.xl, gap: theme.margins.lg },
    stack: { gap: theme.margins.md, minWidth: 0 },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.margins.md },
    panel: { padding: theme.margins.lg, borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.surface.base, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.default, gap: theme.margins.md },
    heading: { ...Typography.rowTitle(), color: theme.colors.text.primary },
    text: { ...Typography.body(), color: theme.colors.text.primary, flexShrink: 1 },
    secondary: { ...Typography.rowMeta(), color: theme.colors.text.secondary, flexShrink: 1 },
    input: { ...Typography.body(), color: theme.colors.text.primary, backgroundColor: theme.colors.input.background, borderWidth: 1, borderColor: theme.colors.border.default, borderRadius: theme.borderRadius.md, padding: theme.margins.md, minHeight: 44 },
    json: { ...Typography.mono(), minHeight: 280, textAlignVertical: 'top' },
    action: { minHeight: Platform.OS === 'android' ? 48 : 44, alignSelf: 'flex-start', justifyContent: 'center' },
}));
const EMPTY_NAVIGATION = {};
type Props = Readonly<{ companyId: string; machineId: string; serverId: string; available: boolean; active: boolean; navigation?: unknown }>;
type Mutation = (operation: string, args: Readonly<Record<string, unknown>>) => Promise<boolean>;
function Action(props: Readonly<{ label: string; onPress: () => void; disabled?: boolean; testID?: string; primary?: boolean }>) {
    return <ToolbarButton {...props} tone={props.primary ? 'primary' : 'default'} style={styles.action} />;
}
function Field({ label, ...props }: AppTextInputProps & Readonly<{ label: string }>) {
    const [focused, setFocused] = React.useState(false);
    const keyboard = useIsKeyboardModality();
    return <View style={styles.stack}><Text style={styles.secondary}>{label}</Text><View><TextInput {...props} accessibilityLabel={label} style={[styles.input, props.style]} autoCapitalize="none" autoCorrect={false} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} /><FocusRing visible={focused && keyboard} /></View></View>;
}
function Toggle({ label, value, onChange, disabled }: Readonly<{ label: string; value: boolean; onChange: (value: boolean) => void; disabled: boolean }>) {
    return <View style={styles.row}><Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled} /><Text style={styles.text}>{label}</Text></View>;
}
function Verification({ connection }: Readonly<{ connection: HqGitConnection | HqEnvironment }>) {
    const v = connection.verification;
    const prodUnavailable = 'tier' in connection && connection.tier === 'prod';
    const label = prodUnavailable ? t('hq.connections.prodUnavailable') : !connection.credentialRef ? t('hq.connections.disconnected') : v.state === 'read_verified' ? t('hq.connections.readVerified') : t('hq.connections.unverified');
    return <View style={styles.stack}>
        <StatusPill variant="neutral" label={label} labelVariant="phrase" />
        <Text style={styles.secondary}>{t('hq.connections.unknownPermissions')}</Text>
        {v.detail && !prodUnavailable ? <Text selectable style={styles.secondary}>{v.detail}</Text> : null}
        {v.checkedAt ? <Text style={styles.secondary}>{v.checkedAt}</Text> : null}
        <Text style={styles.secondary}>{`${t('hq.connections.branchPush')}: ${t('hq.connections.unverified')} · ${t('hq.connections.pullRequests')}: ${t('hq.connections.unverified')}`}</Text>
    </View>;
}
function Credential({ connection, environment, disabled, mutate }: Readonly<{ connection: HqGitConnection | HqEnvironment; environment: boolean; disabled: boolean; mutate: Mutation }>) {
    const [token, setToken] = React.useState('');
    const [expiry, setExpiry] = React.useState('');
    const prodUnavailable = 'tier' in connection && connection.tier === 'prod';
    return <View style={styles.stack}>
        <Text style={styles.heading}>{t('hq.connections.credential')}</Text>
        <Text style={styles.secondary}>{t(prodUnavailable ? 'hq.connections.prodUnavailable' : 'hq.connections.secretHint')}</Text>
        <Field label={t('hq.connections.token')} testID={`hq-credential-${connection.id}`} value={token} onChangeText={setToken} secureTextEntry textContentType="none" autoComplete="off" editable={!disabled && !prodUnavailable} />
        <Field label={t('hq.connections.expiry')} value={expiry} onChangeText={setExpiry} placeholder={connection.expiresAt} editable={!disabled && !prodUnavailable} />
        <View style={styles.row}>
            <Action label={t('hq.connections.replaceCredential')} testID={`hq-credential-save-${connection.id}`} disabled={disabled || prodUnavailable || !token} onPress={() => { void (async () => { if (await mutate('connections.credential.put', { connectionId: connection.id, token, expiresAt: expiry })) setToken(''); })(); }} />
            <Action label={t('hq.connections.revokeCredential')} disabled={disabled || !connection.credentialRef} onPress={() => { void (async () => { if (await Modal.confirm(t('hq.connections.revokeCredential'), t('hq.connections.revokeHint'))) await mutate('connections.credential.revoke', { connectionId: connection.id }); })(); }} />
            <Action label={t('hq.connections.verify')} testID={`hq-connection-verify-${connection.id}`} disabled={disabled || prodUnavailable || !connection.credentialRef} onPress={() => { void mutate(environment ? 'connections.environment.verify' : 'connections.verify', { connectionId: connection.id }); }} />
        </View>
    </View>;
}
function GitForm({ connection: g, update, disabled }: Readonly<{ connection: HqGitConnection; update: (connection: HqGitConnection) => void; disabled: boolean }>) {
    const updatePolicy = (patch: Partial<HqGitConnection['policy']>) => update({ ...g, policy: { ...g.policy, ...patch } });
    return <View style={styles.stack}>
        <SegmentedTabBar tabs={[{ id: 'github', label: 'GitHub' }, { id: 'gitlab', label: 'GitLab' }]} activeTabId={g.provider} onSelectTab={(provider) => { if (!disabled && (provider === 'github' || provider === 'gitlab')) update({ ...g, provider }); }} />
        <Field label={t('hq.connections.host')} value={g.host} onChangeText={(host) => update({ ...g, host })} editable={!disabled} />
        <Field label={t('hq.connections.namespace')} testID={`hq-git-namespace-${g.id}`} value={g.namespace} onChangeText={(namespace) => update({ ...g, namespace })} editable={!disabled} />
        <Field label={t('hq.connections.authorName')} value={g.authorName} onChangeText={(authorName) => update({ ...g, authorName })} editable={!disabled} />
        <Field label={t('hq.connections.authorEmail')} value={g.authorEmail} onChangeText={(authorEmail) => update({ ...g, authorEmail })} editable={!disabled} />
        <Toggle label={t('hq.connections.read')} value={g.policy.read} onChange={(read) => updatePolicy({ read })} disabled={disabled} />
        <Toggle label={t('hq.connections.branchPush')} value={g.policy.branchPush} onChange={(branchPush) => updatePolicy({ branchPush })} disabled={disabled} />
        <Toggle label={t('hq.connections.pullRequests')} value={g.policy.pullRequests} onChange={(pullRequests) => updatePolicy({ pullRequests })} disabled={disabled} />
        <Text style={styles.secondary}>{t('hq.connections.dependency')}</Text>
        <Field label={t('hq.connections.prefixes')} value={g.policy.branchPrefixes.join(', ')} onChangeText={(value) => updatePolicy({ branchPrefixes: value.split(',').map((v) => v.trim()) })} editable={!disabled} />
        <Field label={t('hq.connections.protectedBranches')} value={g.policy.protectedBranches.join(', ')} onChangeText={(value) => updatePolicy({ protectedBranches: value.split(',').map((v) => v.trim()).filter(Boolean) })} editable={!disabled} />
        <Field label={t('hq.connections.targetBranch')} value={g.policy.targetBranch} onChangeText={(targetBranch) => updatePolicy({ targetBranch })} editable={!disabled} />
        <Toggle label={t('hq.connections.draft')} value={g.policy.draft} onChange={(draft) => updatePolicy({ draft })} disabled={disabled} />
    </View>;
}
function EnvironmentForm({ connection: e, update, disabled }: Readonly<{ connection: HqEnvironment; update: (connection: HqEnvironment) => void; disabled: boolean }>) {
    return <View style={styles.stack}>
        <SegmentedTabBar tabs={['dev', 'stage', 'prod'].map((id) => ({ id, label: id === 'prod' ? 'Prod' : id === 'stage' ? 'Stage' : 'Dev' }))} activeTabId={e.tier} onSelectTab={(tier) => { if (!disabled && (tier === 'dev' || tier === 'stage' || tier === 'prod')) update({ ...e, tier }); }} />
        <Field label={t('hq.connections.baseUrl')} value={e.baseUrl} onChangeText={(baseUrl) => update({ ...e, baseUrl })} editable={!disabled} />
        {e.requests.map((request, index) => <Field key={request.id} label={`${t('hq.connections.readPath')} · ${request.id}`} value={request.path} onChangeText={(path) => update({ ...e, requests: e.requests.map((entry, i) => i === index ? { ...entry, path } : entry) })} editable={!disabled} />)}
    </View>;
}
function Advanced({ config, text, setText, apply, disabled }: Readonly<{ config: HqConnections; text: string; setText: (value: string) => void; apply: (config: HqConnections) => void; disabled: boolean }>) {
    const [error, setError] = React.useState(false);
    return <View style={styles.panel}><Text style={styles.secondary}>{t('hq.connections.advancedHint')}</Text>
        <Field testID="hq-connections-json" label={t('hq.connections.advanced')} multiline style={styles.json} value={text} onChangeText={setText} editable={!disabled} />
        {error ? <Text accessibilityRole="alert" style={styles.secondary}>{t('hq.connections.invalidJson')}</Text> : null}
        <Action label={t('hq.connections.applyJson')} disabled={disabled} onPress={() => {
            try { const parsed = HqConnectionsSchema.parse(JSON.parse(text)); if (parsed.companyId !== config.companyId) throw new Error(); apply({ ...parsed, revision: config.revision, availableRepositories: config.availableRepositories, history: config.history }); setError(false); } catch { setError(true); }
        }} />
    </View>;
}
function Editor({ saved, disabled, mutate, onDirty }: Readonly<{ saved: HqConnections; disabled: boolean; mutate: Mutation; onDirty: (dirty: boolean) => void }>) {
    const [config, setConfig] = React.useState(saved);
    const [advancedText, setAdvancedText] = React.useState<string | null>(null);
    React.useEffect(() => { setConfig(saved); setAdvancedText(null); }, [saved]);
    const [tab, setTab] = React.useState('git');
    const [advanced, setAdvanced] = React.useState(false);
    const dirty = advancedText !== null || JSON.stringify(config) !== JSON.stringify(saved);
    React.useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
    const change = (next: HqConnections) => setConfig(next);
    const usedIds = [...config.git, ...config.environments].map((c) => c.id);
    const nextId = (prefix: string) => { let n = 1; while (usedIds.includes(`${prefix}-${n}`)) n++; return `${prefix}-${n}`; };
    return <View style={styles.stack}>
        <SegmentedTabBar tabs={[{ id: 'git', label: t('hq.connections.git') }, { id: 'environments', label: t('hq.connections.environments') }]} activeTabId={tab} onSelectTab={setTab} testIDPrefix="hq-connections-tab" />
        {dirty ? <Text accessibilityLiveRegion="polite" style={styles.secondary}>{t('hq.connections.saveFirst')}</Text> : null}
        {tab === 'git' ? <>
            {!config.git.length ? <Text style={styles.secondary}>{t('hq.connections.empty')}</Text> : null}
            {config.git.map((g, index) => <View key={g.id} style={styles.panel}>
                <Text accessibilityRole="header" style={styles.heading}>{g.id}</Text><Verification connection={g} />
                <GitForm connection={g} disabled={disabled || advancedText !== null} update={(next) => change({ ...config, git: config.git.map((entry, i) => i === index ? next : entry) })} />
                <Text style={styles.heading}>{t('hq.connections.repositories')}</Text>
                {config.repositories.filter((r) => r.connectionId === g.id).map((r) => <View key={r.repoId} style={styles.stack}><Text selectable style={styles.secondary}>{r.repoId}</Text><Field label={t('hq.connections.remotePath')} value={r.remotePath} editable={!disabled} onChangeText={(remotePath) => change({ ...config, repositories: config.repositories.map((entry) => entry.repoId === r.repoId ? { ...entry, remotePath } : entry) })} /><Action label={t('common.delete')} disabled={disabled} onPress={() => change({ ...config, repositories: config.repositories.filter((entry) => entry.repoId !== r.repoId) })} /></View>)}
                {config.availableRepositories.filter((ref) => !config.repositories.some((r) => r.repoId === ref)).map((ref) => <Action key={ref} label={`${t('hq.connections.addMapping')}: ${ref}`} disabled={disabled} onPress={() => change({ ...config, repositories: [...config.repositories, { repoId: ref, connectionId: g.id, remotePath: `${g.namespace}/${ref.split('/').at(-1)}` }] })} />)}
                <Credential connection={g} environment={false} disabled={disabled || dirty || !saved.git.some((entry) => entry.id === g.id)} mutate={mutate} />
                <Action label={t('hq.connections.remove')} disabled={disabled} onPress={() => change({ ...config, git: config.git.filter((entry) => entry.id !== g.id), repositories: config.repositories.filter((r) => r.connectionId !== g.id) })} />
            </View>)}
            <Action label={t('hq.connections.addGit')} testID="hq-add-git" disabled={disabled} onPress={() => change({ ...config, git: [...config.git, newGitConnection(nextId('git'))] })} />
        </> : <>
            <Text style={styles.secondary}>{t('hq.connections.environmentHint')}</Text>
            {!config.environments.length ? <Text style={styles.secondary}>{t('hq.connections.empty')}</Text> : null}
            {config.environments.map((e, index) => <View key={e.id} style={styles.panel}>
                <Text accessibilityRole="header" style={styles.heading}>{e.id}</Text><Verification connection={e} />
                <EnvironmentForm connection={e} disabled={disabled || advancedText !== null} update={(next) => change({ ...config, environments: config.environments.map((entry, i) => i === index ? next : entry) })} />
                <Credential connection={e} environment disabled={disabled || dirty || !saved.environments.some((entry) => entry.id === e.id)} mutate={mutate} />
                <Action label={t('hq.connections.remove')} disabled={disabled} onPress={() => change({ ...config, environments: config.environments.filter((entry) => entry.id !== e.id) })} />
            </View>)}
            <Action label={t('hq.connections.addEnvironment')} disabled={disabled} onPress={() => change({ ...config, environments: [...config.environments, newEnvironment(nextId('environment'))] })} />
        </>}
        <View style={styles.row}><Action label={t('common.save')} testID="hq-connections-save" primary disabled={disabled || !dirty || advancedText !== null} onPress={() => { void mutate('connections.save', { config }); }} /><Action testID="hq-connections-advanced" label={t('hq.connections.advanced')} disabled={disabled} onPress={() => setAdvanced((value) => !value)} /></View>
        {advanced ? <Advanced config={config} text={advancedText ?? JSON.stringify(config, null, 2)} setText={setAdvancedText} apply={(next) => { change(next); setAdvancedText(null); setAdvanced(false); }} disabled={disabled} /> : null}
    </View>;
}
export function HqConnectionsScreen(props: Props) {
    const [config, setConfig] = React.useState<HqConnections | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<'load' | 'mutation' | null>(null);
    const [dirty, setDirty] = React.useState(false);
    const dirtyRef = React.useRef(dirty); dirtyRef.current = dirty;
    const mounted = React.useRef(true);
    const flight = React.useRef(false);
    const enabled = props.active && props.available && Boolean(props.machineId && props.serverId && props.companyId);
    const navigation = props.navigation ?? EMPTY_NAVIGATION;
    const requestDecision = React.useCallback(async () => await Modal.confirm(t('common.discardChanges'), t('hq.connections.reloadConfirm'), { confirmText: t('common.discard'), cancelText: t('common.keepEditing'), destructive: true }) ? 'discard' as const : 'keepEditing' as const, []);
    const discard = React.useCallback(() => { dirtyRef.current = false; setDirty(false); }, []);
    const guard = React.useMemo(() => ({ isDirtyRef: dirtyRef, requestDecision, onDiscard: discard, tag: 'HqConnectionsScreen' }), [requestDecision, discard]);
    useActiveUnsavedChangesGuard({ navigation, guard, enabled: props.active });
    useUnsavedChangesBeforeRemoveGuard({ navigation, ...guard, onContinue: (action) => { (navigation as { dispatch?: (action: unknown) => void }).dispatch?.(action); } });
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    React.useEffect(() => {
        if (!dirty || Platform.OS !== 'web' || typeof window === 'undefined') return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        const targetWindow = window;
        targetWindow.addEventListener('beforeunload', warn); return () => targetWindow.removeEventListener('beforeunload', warn);
    }, [dirty]);
    const load = React.useCallback(async () => {
        if (!enabled || flight.current) return;
        flight.current = true; setBusy(true); setError(null);
        try { const result = await companyConnections(props.machineId, props.serverId, props.companyId, 'connections.get'); if (mounted.current) { setConfig(result); setDirty(false); } }
        catch { if (mounted.current) setError('load'); }
        finally { flight.current = false; if (mounted.current) setBusy(false); }
    }, [enabled, props.machineId, props.serverId, props.companyId]);
    React.useEffect(() => { if (enabled && config === null) void load(); }, [enabled, config, load]);
    const mutate: Mutation = async (operation, args) => {
        if (!enabled || flight.current || !config) return false;
        flight.current = true; setBusy(true); setError(null);
        try { const result = await companyConnections(props.machineId, props.serverId, props.companyId, operation, { ...args, revision: config.revision }); if (mounted.current) { setConfig(result); setDirty(false); } return true; }
        catch { if (mounted.current) setError('mutation'); return false; }
        finally { flight.current = false; if (mounted.current) setBusy(false); }
    };
    return <View style={styles.root}><ScrollView keyboardShouldPersistTaps="handled"><ConstrainedScreenContent style={styles.content}>
        <Text accessibilityRole="header" style={styles.heading}>{props.companyId}</Text>
        <Text style={styles.secondary}>{t('hq.connections.intro')}</Text>
        {!props.available ? <Text style={styles.secondary}>{t('hq.entity.offline')}</Text> : null}
        {error ? <Text accessibilityRole="alert" testID="hq-connections-error" style={styles.secondary}>{error === 'load' ? t('hq.connections.loadFailed') : t('hq.connections.operationFailed')}</Text> : null}
        <View style={styles.row}>{busy ? <ActivitySpinner size="small" /> : null}<Action label={t('common.refresh')} testID="hq-connections-refresh" disabled={!enabled || busy} onPress={() => { void (async () => { if (dirty && await requestDecision() !== 'discard') return; await load(); })(); }} /></View>
        {config ? <Editor key={`${config.companyId}:${config.revision}`} saved={config} disabled={!enabled || busy} mutate={mutate} onDirty={setDirty} /> : null}
    </ConstrainedScreenContent></ScrollView></View>;
}
