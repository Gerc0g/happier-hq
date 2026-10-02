import * as React from 'react';
import { useStableValueBySignature } from '@/hooks/ui/useStableValueBySignature';
import type { HqCatalog, HqMachineCatalog } from '@/sync/domains/hq/hqCatalog';
import { serverAccountScopeKeySuffix, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { Machine } from '@/sync/domains/state/storageTypes';
import { readHqCatalog } from '@/sync/ops/hq';
import { stableJsonStringify } from '@/utils/json/stableJsonStringify';
import { isMachineOnline } from '@/utils/sessions/machineUtils';

const inFlight = new Map<string, Promise<HqCatalog>>();
const emptyCatalogs: readonly HqMachineCatalog[] = [];
const emptyIds: readonly string[] = [];

function readSharedCatalog(scope: ServerAccountScope, machineId: string): Promise<HqCatalog> {
    const key = JSON.stringify([serverAccountScopeKeySuffix(scope), machineId]);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const request = readHqCatalog(machineId, scope.serverId);
    inFlight.set(key, request);
    const clear = () => { inFlight.delete(key); };
    void request.then(clear, clear);
    return request;
}

type Snapshot = Readonly<{
    scopeKey: string | null;
    catalogs: readonly HqMachineCatalog[];
    failedMachineIds: readonly string[];
    pendingMachineIds: readonly string[];
}>;

function emptySnapshot(scopeKey: string | null): Snapshot {
    return { scopeKey, catalogs: emptyCatalogs, failedMachineIds: emptyIds, pendingMachineIds: emptyIds };
}

export function useHqCatalogs(input: Readonly<{
    scope: ServerAccountScope | null;
    machines: readonly Machine[];
    active: boolean;
}>): Readonly<{
    catalogs: readonly HqMachineCatalog[];
    loading: boolean;
    failedMachineIds: readonly string[];
    refresh: () => Promise<void>;
}> {
    const scopeKey = input.scope ? serverAccountScopeKeySuffix(input.scope) : null;
    const scope = useStableValueBySignature(input.scope, scopeKey ?? '');
    const machineIdsValue = [...new Set(input.machines.map(machine => machine.id))].sort();
    const machineIds = useStableValueBySignature(machineIdsValue, JSON.stringify(machineIdsValue));
    const onlineIdsValue = [...new Set(input.machines.filter(machine => isMachineOnline(machine)).map(machine => machine.id))].sort();
    const onlineIds = useStableValueBySignature(onlineIdsValue, JSON.stringify(onlineIdsValue));
    const knownIds = React.useMemo(() => new Set(machineIds), [machineIds]);
    const currentKnownIds = React.useRef(knownIds);
    const lifetime = React.useMemo(() => ({ mounted: true }), [scopeKey]);
    const [snapshot, setSnapshot] = React.useState<Snapshot>(() => emptySnapshot(scopeKey));

    React.useEffect(() => {
        lifetime.mounted = true;
        return () => { lifetime.mounted = false; };
    }, [lifetime]);

    React.useEffect(() => {
        currentKnownIds.current = knownIds;
        setSnapshot(previous => {
            if (previous.scopeKey !== scopeKey) return emptySnapshot(scopeKey);
            if (previous.catalogs.every(item => knownIds.has(item.machineId))
                && previous.failedMachineIds.every(id => knownIds.has(id))
                && previous.pendingMachineIds.every(id => knownIds.has(id))) return previous;
            return {
                scopeKey,
                catalogs: previous.catalogs.filter(item => knownIds.has(item.machineId)),
                failedMachineIds: previous.failedMachineIds.filter(id => knownIds.has(id)),
                pendingMachineIds: previous.pendingMachineIds.filter(id => knownIds.has(id)),
            };
        });
    }, [knownIds, scopeKey]);

    const load = React.useCallback(async (ids: readonly string[]) => {
        if (!input.active || !scope || !lifetime.mounted || ids.length === 0) return;
        setSnapshot(previous => {
            const current = previous.scopeKey === scopeKey ? previous : emptySnapshot(scopeKey);
            if (ids.every(id => current.pendingMachineIds.includes(id))) return current;
            return { ...current, pendingMachineIds: [...new Set([...current.pendingMachineIds, ...ids])] };
        });
        await Promise.all(ids.map(async machineId => {
            let catalog: HqCatalog | undefined;
            try {
                catalog = await readSharedCatalog(scope, machineId);
            } catch {
                // The caller renders failedMachineIds while retaining useful data.
            }
            if (!lifetime.mounted || !currentKnownIds.current.has(machineId)) return;
            setSnapshot(previous => {
                if (previous.scopeKey !== scopeKey) return previous;
                let catalogs = previous.catalogs;
                if (catalog) {
                    const previousCatalog = catalogs.find(item => item.machineId === machineId)?.catalog;
                    if (stableJsonStringify(previousCatalog) !== stableJsonStringify(catalog)) {
                        catalogs = [...catalogs.filter(item => item.machineId !== machineId), { machineId, catalog }]
                            .sort((a, b) => a.machineId.localeCompare(b.machineId));
                    }
                }
                return {
                    scopeKey, catalogs,
                    pendingMachineIds: previous.pendingMachineIds.filter(id => id !== machineId),
                    failedMachineIds: catalog
                        ? previous.failedMachineIds.filter(id => id !== machineId)
                        : [...new Set([...previous.failedMachineIds, machineId])].sort(),
                };
            });
        }));
    }, [input.active, lifetime, scope, scopeKey]);

    const refresh = React.useCallback(() => load(onlineIds), [load, onlineIds]);
    const previousAutomatic = React.useRef<{ scopeKey: string | null; active: boolean; onlineIds: readonly string[] } | null>(null);
    React.useEffect(() => {
        const previous = previousAutomatic.current;
        previousAutomatic.current = { scopeKey, active: input.active, onlineIds };
        const reactivated = !previous?.active || previous.scopeKey !== scopeKey;
        const needed = reactivated ? onlineIds : onlineIds.filter(id => !previous.onlineIds.includes(id));
        void load(needed);
    }, [input.active, load, onlineIds, scopeKey]);

    // Scope and removal checks also run during render, before effects can prune
    // the retained snapshot, so another account never sees the old catalog.
    const catalogs = React.useMemo(() => {
        if (snapshot.scopeKey !== scopeKey) return emptyCatalogs;
        return snapshot.catalogs.every(item => knownIds.has(item.machineId))
            ? snapshot.catalogs : snapshot.catalogs.filter(item => knownIds.has(item.machineId));
    }, [snapshot.scopeKey, snapshot.catalogs, scopeKey, knownIds]);
    const failedMachineIds = React.useMemo(() => snapshot.scopeKey === scopeKey
        ? snapshot.failedMachineIds.filter(id => knownIds.has(id)) : emptyIds,
    [snapshot.scopeKey, snapshot.failedMachineIds, scopeKey, knownIds]);
    const loading = input.active && snapshot.scopeKey === scopeKey && snapshot.pendingMachineIds.some(id => knownIds.has(id));
    return { catalogs, loading, failedMachineIds, refresh };
}
