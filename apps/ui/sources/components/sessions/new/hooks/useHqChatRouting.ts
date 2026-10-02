import * as React from 'react';
import { t } from '@/text';
import { randomUUID } from '@/platform/randomUUID';
import { createHqWorktree, HqCommandError, readHqCatalog } from '@/sync/ops/hq';
import { hqControl } from '@/sync/ops/hqControl';
import type { HqCatalog } from '@/sync/domains/hq/hqCatalog';
import { HqAgentSnapshotSchema, type HqAgentSnapshot } from '@/sync/domains/hq/hqAgentSettings';
import { isHqChatRouteReady, resolveHqChatTarget, type HqChatType } from '@/sync/domains/hq/hqChatRouting';

export type HqWorktreeCreationAttempt = Readonly<{ machineId: string; serverId: string; repoPath: string; taskName: string; requestId?: string; beforeIds?: readonly string[] }>;

export function useHqChatRouting(input: Readonly<{
    draftId?: string;
    enabled: boolean;
    machineId: string | null;
    serverId: string | null;
    accountId: string | null;
    online: boolean;
    path: string;
    type?: HqChatType;
    taskName?: string;
    onSelectPath?: (path: string) => void;
    creationAttempt?: HqWorktreeCreationAttempt | null;
    onCreationAttemptChange?: (attempt: HqWorktreeCreationAttempt | null) => void | Promise<void>;
}>) {
    const latestInput = React.useRef(input);
    latestInput.current = input;
    const key = JSON.stringify([input.accountId, input.serverId, input.machineId]);
    const [attempt, setAttempt] = React.useState(0);
    const [state, setState] = React.useState<{
        key: string;
        catalog: HqCatalog | null;
        snapshot: HqAgentSnapshot | null;
        loading: boolean;
        error: boolean;
    } | null>(null);
    const active = input.enabled && input.online && Boolean(input.machineId && input.serverId && input.accountId);
    React.useEffect(() => {
        if (!active || !input.machineId || !input.serverId) return;
        let current = true;
        setState(previous => previous?.key === key ? { ...previous, loading: true, error: false } : { key, catalog: null, snapshot: null, loading: true, error: false });
        void Promise.all([
            readHqCatalog(input.machineId, input.serverId),
            hqControl(input.machineId, 'agent.get', {}, input.serverId).then(value => HqAgentSnapshotSchema.parse(value)),
        ]).then(([catalog, snapshot]) => {
            if (current) setState({ key, catalog, snapshot, loading: false, error: false });
        }, () => {
            if (current) setState(previous => previous?.key === key ? { ...previous, loading: false, error: true } : { key, catalog: null, snapshot: null, loading: false, error: true });
        });
        return () => { current = false; };
    }, [active, key, input.machineId, input.serverId, attempt]);
    const current = active && state?.key === key ? state : null;
    const catalog = current?.catalog ?? null;
    const snapshot = current?.snapshot ?? null;
    const target = catalog ? resolveHqChatTarget(catalog, input.path) : null;
    const type = input.type ?? target?.type ?? 'work';
    const taskName = input.taskName ?? '';
    const preset = snapshot?.settings.presets[type] ?? null;
    const ready = Boolean(active && !current?.loading && !current?.error && preset && isHqChatRouteReady(target, type, taskName));
    const reload = React.useCallback(() => setAttempt(value => value + 1), []);
    const issuedCreation = React.useRef<{ key: string; attempt: HqWorktreeCreationAttempt } | null>(null);
    const launch = React.useRef<{ key: string; promise: Promise<string> } | null>(null);
    const prepareLaunch = React.useCallback((): Promise<string> => {
        if (!ready || !target || !input.machineId || !input.serverId) return Promise.reject(new Error(t('hq.routing.invalidTarget')));
        if (type === 'research' || target.worktree) return Promise.resolve(target.path);
        if (!target.company || !target.product || !target.repo) return Promise.reject(new Error(t('hq.routing.invalidTarget')));
        const draftKey = JSON.stringify([key, input.draftId]);
        const launchKey = JSON.stringify([draftKey, target.repo.path, taskName.trim()]);
        const isCurrentContext = () => {
            const latest = latestInput.current;
            return latest.enabled && latest.online && latest.draftId === input.draftId && latest.accountId === input.accountId && latest.machineId === input.machineId && latest.serverId === input.serverId && latest.path === input.path && latest.type === input.type && latest.taskName === input.taskName;
        };
        if (launch.current?.key === launchKey) return launch.current.promise;
        const repo = target.repo;
        const priorAttempt = input.creationAttempt ?? (issuedCreation.current?.key === draftKey ? issuedCreation.current.attempt : null);
        if (priorAttempt && (priorAttempt.machineId !== input.machineId || priorAttempt.serverId !== input.serverId || priorAttempt.repoPath !== repo.path || priorAttempt.taskName !== taskName.trim())) {
            return Promise.reject(new Error(t('hq.routing.pendingWorktree')));
        }
        if (priorAttempt && !priorAttempt.requestId) return Promise.reject(new Error(t('hq.routing.legacyWorktreeAttempt')));
        const attempt: HqWorktreeCreationAttempt = priorAttempt ?? { machineId: input.machineId, serverId: input.serverId, repoPath: repo.path, taskName: taskName.trim(), requestId: randomUUID() };
        const machineId = input.machineId;
        const serverId = input.serverId;
        const reconcile = async (): Promise<string> => {
            const refreshed = await readHqCatalog(machineId, serverId);
            setState(previous => previous?.key === key ? { ...previous, catalog: refreshed } : previous);
            const refreshedTarget = resolveHqChatTarget(refreshed, repo.path);
            const candidates = refreshedTarget?.repo?.worktrees.filter(worktree => worktree.creationRequestId === attempt.requestId) ?? [];
            if (candidates.length !== 1) throw new Error(t('hq.routing.worktreeUnconfirmed'));
            return candidates[0].path;
        };
        const confirmCreatedPath = async (path: string) => {
            if (!isCurrentContext()) throw new Error(t('hq.routing.contextChanged'));
            input.onSelectPath?.(path);
            await input.onCreationAttemptChange?.(null);
            if (issuedCreation.current?.key === draftKey) issuedCreation.current = null;
        };
        const promise = (async () => {
            if (priorAttempt) return reconcile();
            issuedCreation.current = { key: draftKey, attempt };
            try {
                // Local storage must acknowledge the fence before HQ can observe the command.
                await input.onCreationAttemptChange?.(attempt);
                if (!isCurrentContext()) throw new Error(t('hq.routing.contextChanged'));
            } catch (error) {
                if (issuedCreation.current?.key === draftKey) issuedCreation.current = null;
                try { await input.onCreationAttemptChange?.(null); } catch { /* Preserve the original persistence error. No command was issued. */ }
                throw error;
            }
            try {
                return await createHqWorktree({ machineId, company: target.company!.slug, product: target.product!.slug, repo: repo.name, path: repo.path }, attempt.taskName, serverId, attempt.requestId);
            } catch (error) {
                if (error instanceof HqCommandError && error.kind === 'commandFailed' && error.creationNotStarted) {
                    if (issuedCreation.current?.key === draftKey) issuedCreation.current = null;
                    await input.onCreationAttemptChange?.(null);
                    throw error;
                }
                let path: string;
                try { path = await reconcile(); } catch (reconciliationError) {
                    if (error instanceof HqCommandError && error.kind === 'commandFailed') throw error;
                    throw reconciliationError;
                }
                if (error instanceof HqCommandError && error.kind === 'commandFailed') {
                    await confirmCreatedPath(path);
                    throw error;
                }
                return path;
            }
        })()
            .then(async path => {
                await confirmCreatedPath(path);
                // Refresh enables the selected worktree immediately; its confirmed path remains usable if refresh fails.
                try {
                    const refreshed = await readHqCatalog(machineId, serverId);
                    setState(previous => previous?.key === key ? { ...previous, catalog: refreshed } : previous);
                } catch { /* The worktree was already confirmed by HQ. */ }
                return path;
            }).catch(error => {
                if (launch.current?.key === launchKey) launch.current = null;
                throw error;
            });
        launch.current = { key: launchKey, promise };
        return promise;
    }, [ready, target, type, key, taskName, input.draftId, input.path, input.accountId, input.machineId, input.serverId, input.onSelectPath, input.creationAttempt, input.onCreationAttemptChange]);
    return { catalog, snapshot, target, type, preset, prepareLaunch, ready, loading: active && (!current || current.loading), error: current?.error ?? false, reload };
}
