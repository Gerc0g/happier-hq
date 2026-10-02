import * as React from 'react';
import { createStore } from 'zustand/vanilla';
import type { HqEntityCard, HqEntityUpdate } from '@/sync/domains/hq/hqEntity';
import { HqCommandError, readHqEntity, updateHqEntity } from '@/sync/ops/hq';

type Edit = HqEntityUpdate extends infer Update ? Update extends HqEntityUpdate ? Omit<Update, 'revision'> : never : never;
export type HqEntityDraft = { content: string; namespace: string; originalContent: string; originalNamespace: string };
export const isHqEntityDraftDirty = (draft: HqEntityDraft) => draft.content !== draft.originalContent || draft.namespace !== draft.originalNamespace;

export function useHqEntity(input: Readonly<{ machineId: string; serverId: string; scope: string; available: boolean; active: boolean }>) {
    const [card, setCard] = React.useState<HqEntityCard | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<'load' | 'conflict' | 'save' | null>(null);
    const [requiresReload, setRequiresReload] = React.useState(false);
    const [draft] = React.useState(() => createStore<HqEntityDraft>(() => ({ content: '', namespace: '', originalContent: '', originalNamespace: '' })));
    const alive = React.useRef(false);
    const current = React.useRef({ ...input, card, saving, requiresReload });
    current.current = { ...input, card, saving, requiresReload };
    const inFlight = React.useRef<Promise<void> | null>(null);
    const writePending = React.useRef(false);
    const readGeneration = React.useRef(0);
    React.useEffect(() => { alive.current = true; return () => { alive.current = false; readGeneration.current++; }; }, []);

    const accept = React.useCallback((next: HqEntityCard) => {
        draft.setState((previous) => ({
            content: previous.content !== previous.originalContent ? previous.content : next.document.content,
            namespace: previous.namespace !== previous.originalNamespace ? previous.namespace : next.settings.namespace,
            originalContent: next.document.content,
            originalNamespace: next.settings.namespace,
        }));
        setCard(next);
    }, [draft]);

    const refresh = React.useCallback((): Promise<void> => {
        const state = current.current;
        if (!alive.current || !state.active || !state.available || writePending.current) return Promise.resolve();
        if (inFlight.current) return inFlight.current;
        const generation = ++readGeneration.current;
        setLoading(true);
        const pending = readHqEntity(state.machineId, state.serverId, state.scope).then((next) => {
            if (!alive.current || generation !== readGeneration.current) return;
            accept(next);
            setError(null);
            setRequiresReload(false);
        }).catch(() => {
            if (alive.current && generation === readGeneration.current) setError('load');
        }).finally(() => {
            if (inFlight.current === pending) inFlight.current = null;
            if (alive.current && generation === readGeneration.current) setLoading(false);
        });
        inFlight.current = pending;
        return pending;
    }, [accept]);

    React.useEffect(() => {
        if (input.active && input.available) { void refresh(); }
        else {
            readGeneration.current++;
            inFlight.current = null;
            setLoading(false);
        }
    }, [input.active, input.available, refresh]);

    const update = React.useCallback(async (edit: Edit): Promise<boolean> => {
        const state = current.current;
        if (!alive.current || !state.active || !state.available || !state.card || state.requiresReload || writePending.current || inFlight.current) return false;
        writePending.current = true;
        setSaving(true);
        setError(null);
        try {
            const next = await updateHqEntity(state.machineId, state.serverId, state.scope, { ...edit, revision: state.card.document.revision } as HqEntityUpdate);
            if (!alive.current) return false;
            // Only the submitted field is committed. Other unsaved fields retain their draft.
            draft.setState((previous) => ({
                content: 'content' in edit ? next.document.content : previous.content,
                namespace: 'settings' in edit ? next.settings.namespace : previous.namespace,
                originalContent: next.document.content,
                originalNamespace: next.settings.namespace,
            }));
            setCard(next);
            return true;
        } catch (failure) {
            if (alive.current) {
                setError(failure instanceof HqCommandError && failure.kind === 'conflict' ? 'conflict' : 'save');
                setRequiresReload(true);
            }
            return false;
        } finally {
            writePending.current = false;
            if (alive.current) setSaving(false);
        }
    }, [draft]);
    return { card, draft, loading, saving, error, refresh, update, canWrite: Boolean(input.active && input.available && card && !loading && !saving && !requiresReload) };
}
