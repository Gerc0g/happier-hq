import React from 'react';
import { View } from 'react-native';
import { Item } from '@/components/ui/lists/Item';
import type { HqAgentPreset } from '@/sync/domains/hq/hqAgentSettings';

import type { AgentId } from '@/agents/catalog/catalog';
import type { AgentInputExtraActionChip } from '@/components/sessions/agentInput/agentInputContracts';
import { createMcpActionChip } from '@/components/sessions/agentInput/definitions/createMcpActionChip';
import { NewSessionMcpSelectionContent } from '@/components/sessions/new/components/NewSessionMcpSelectionContent';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { machineMcpServersPreview } from '@/sync/ops/machineMcpServers';
import { isRpcMethodNotAvailableError, isRpcMethodNotFoundError } from '@/sync/runtime/rpcErrors';
import { t } from '@/text';
import type { DaemonMcpServersPreviewResponse, SessionMcpSelectionV1 } from '@happier-dev/protocol';

type PreviewSuccess = Extract<DaemonMcpServersPreviewResponse, { ok: true }>;

export type UseNewSessionMcpSelectionResult = Readonly<{
    mcpChip: AgentInputExtraActionChip | null;
    mcpPreview: PreviewSuccess | null;
    mcpPreviewLoading: boolean;
}>;

export function useNewSessionMcpSelection(params: Readonly<{
    hqPreset?: HqAgentPreset | null;
    selectedMachineId: string | null;
    selectedPath: string;
    selectedMachineName?: string | null;
    agentType: AgentId;
    targetServerId?: string | null;
    mcpSelection: SessionMcpSelectionV1;
    setMcpSelection: React.Dispatch<React.SetStateAction<SessionMcpSelectionV1>>;
    onOpenSettings: () => void;
}>): UseNewSessionMcpSelectionResult {
    const mcpServersEnabled = useFeatureEnabled('mcp.servers');
    const [mcpPreview, setMcpPreview] = React.useState<PreviewSuccess | null>(null);
    const [mcpPreviewLoading, setMcpPreviewLoading] = React.useState(false);
    const [mcpPreviewError, setMcpPreviewError] = React.useState<string | null>(null);
    const [mcpPreviewUnsupported, setMcpPreviewUnsupported] = React.useState(false);
    const [previewDemanded, setPreviewDemanded] = React.useState(false);
    const demandPreview = React.useCallback(() => setPreviewDemanded(true), []);

    React.useEffect(() => {
        setMcpPreviewUnsupported(false);
    }, [params.agentType, params.selectedMachineId, params.selectedPath, params.targetServerId]);

    const isUnsupportedPreviewErrorMessage = React.useCallback((message: string) => {
        return message === 'RPC method not available' || message === 'Method not found';
    }, []);

    const refreshPreview = React.useCallback(async () => {
        if (params.hqPreset !== undefined || !mcpServersEnabled || !params.selectedMachineId || params.selectedPath.trim().length === 0) {
            setMcpPreview(null);
            setMcpPreviewError(null);
            setMcpPreviewUnsupported(false);
            setMcpPreviewLoading(false);
            return;
        }

        setMcpPreviewLoading(true);
        setMcpPreviewUnsupported(false);
        try {
            const response = await machineMcpServersPreview(
                params.selectedMachineId,
                {
                    agentId: params.agentType,
                    directory: params.selectedPath.trim(),
                    selection: params.mcpSelection,
                },
                { serverId: params.targetServerId ?? undefined },
            );
            if (response.ok) {
                setMcpPreview(response);
                setMcpPreviewError(null);
            } else {
                if (isUnsupportedPreviewErrorMessage(response.error)) {
                    setMcpPreview(null);
                    setMcpPreviewError(null);
                    setMcpPreviewUnsupported(true);
                } else {
                    setMcpPreview(null);
                    setMcpPreviewError(response.error);
                }
            }
        } catch (error) {
            if (
                isRpcMethodNotAvailableError(error)
                || isRpcMethodNotFoundError(error)
                || (error instanceof Error && (error.message === 'RPC method not available' || error.message === 'Method not found'))
            ) {
                setMcpPreview(null);
                setMcpPreviewError(null);
                setMcpPreviewUnsupported(true);
                return;
            }
            setMcpPreview(null);
            setMcpPreviewError(error instanceof Error ? error.message : String(error ?? 'unknown error'));
        } finally {
            setMcpPreviewLoading(false);
        }
    }, [
        mcpServersEnabled,
        params.hqPreset,
        params.agentType,
        params.mcpSelection,
        params.selectedMachineId,
        params.selectedPath,
        params.targetServerId,
        isUnsupportedPreviewErrorMessage,
    ]);

    React.useEffect(() => {
        let cancelled = false;
        if (!previewDemanded) return;
        if (params.hqPreset !== undefined || !mcpServersEnabled || !params.selectedMachineId || params.selectedPath.trim().length === 0) {
            setMcpPreview(null);
            setMcpPreviewError(null);
            setMcpPreviewUnsupported(false);
            setMcpPreviewLoading(false);
            return;
        }

        if (mcpPreviewUnsupported) {
            return;
        }

        setMcpPreviewLoading(true);
        machineMcpServersPreview(
            params.selectedMachineId,
            {
                agentId: params.agentType,
                directory: params.selectedPath.trim(),
                selection: params.mcpSelection,
            },
            { serverId: params.targetServerId ?? undefined },
        )
            .then((response) => {
                if (cancelled) return;
                if (response.ok) {
                    setMcpPreview(response);
                    setMcpPreviewError(null);
                } else {
                    if (isUnsupportedPreviewErrorMessage(response.error)) {
                        setMcpPreview(null);
                        setMcpPreviewError(null);
                        setMcpPreviewUnsupported(true);
                    } else {
                        setMcpPreview(null);
                        setMcpPreviewError(response.error);
                    }
                }
            })
            .catch((error) => {
                if (cancelled) return;
                if (
                    isRpcMethodNotAvailableError(error)
                    || isRpcMethodNotFoundError(error)
                    || (error instanceof Error && (error.message === 'RPC method not available' || error.message === 'Method not found'))
                ) {
                    setMcpPreview(null);
                    setMcpPreviewError(null);
                    setMcpPreviewUnsupported(true);
                    return;
                }
                setMcpPreview(null);
                setMcpPreviewError(error instanceof Error ? error.message : String(error ?? 'unknown error'));
            })
            .finally(() => {
                if (cancelled) return;
                setMcpPreviewLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [
        mcpServersEnabled,
        previewDemanded,
        params.hqPreset,
        params.agentType,
        params.mcpSelection,
        params.selectedMachineId,
        params.selectedPath,
        params.targetServerId,
        mcpPreviewUnsupported,
        isUnsupportedPreviewErrorMessage,
    ]);

    const contentProps = React.useMemo(() => ({
        machineId: params.selectedMachineId,
        machineName: params.selectedMachineName,
        directory: params.selectedPath.trim(),
        agentType: params.agentType,
        hasContext: Boolean(params.selectedMachineId && params.selectedPath.trim().length > 0),
        preview: mcpPreview,
        selection: params.mcpSelection,
        loading: mcpPreviewLoading,
        error: mcpPreviewError,
        previewUnsupported: mcpPreviewUnsupported,
        onSelectionChange: (selection: SessionMcpSelectionV1) => {
            params.setMcpSelection(selection);
        },
        onRefresh: refreshPreview,
        onOpenSettings: params.onOpenSettings,
    }), [
        mcpPreview,
        mcpPreviewError,
        mcpPreviewLoading,
        mcpPreviewUnsupported,
        params,
        refreshPreview,
    ]);

    const selectedCount = React.useMemo(() => {
        if (!mcpServersEnabled) return 0;
        // Chip badge should reflect detected/provider servers only, not managed/Happier settings.
        return mcpPreview?.detected.filter((entry) => entry.selected).length ?? 0;
    }, [mcpPreview, mcpServersEnabled]);
    const chipLabel = t('newSession.mcpChipLabel');
    const chipStabilityKey = React.useMemo(() => JSON.stringify({
        machineId: params.selectedMachineId,
        directory: params.selectedPath.trim(),
        agentType: params.agentType,
        targetServerId: params.targetServerId ?? null,
        selection: params.mcpSelection,
        preview: mcpPreview,
        loading: mcpPreviewLoading,
        error: mcpPreviewError,
        previewUnsupported: mcpPreviewUnsupported,
    }), [
        mcpPreview,
        mcpPreviewError,
        mcpPreviewLoading,
        mcpPreviewUnsupported,
        params.hqPreset,
        params.agentType,
        params.mcpSelection,
        params.selectedMachineId,
        params.selectedPath,
        params.targetServerId,
    ]);

    const mcpChip = React.useMemo<AgentInputExtraActionChip | null>(() => {
        if (params.hqPreset !== undefined) {
            const servers = params.hqPreset?.mcp ?? [];
            const selection = params.mcpSelection;
            const enabled = (name: string, defaultEnabled: boolean) => !selection.forceExcludeServerIds.includes(name)
                && (selection.forceIncludeServerIds.includes(name) || (selection.managedServersEnabled && defaultEnabled));
            return createMcpActionChip({
                label: chipLabel,
                selectedCount: servers.filter(server => enabled(server.name, server.enabled)).length,
                stabilityKey: JSON.stringify([servers, selection]),
                popoverContent: () => <View testID="hq-session-mcp-list">
                    {servers.map(server => <Item key={server.name} testID={`hq-session-mcp:${server.name}`}
                        title={server.name} selected={enabled(server.name, server.enabled)} showChevron={false}
                        onPress={() => params.setMcpSelection(previous => {
                            const wasEnabled = !previous.forceExcludeServerIds.includes(server.name)
                                && (previous.forceIncludeServerIds.includes(server.name) || (previous.managedServersEnabled && server.enabled));
                            return { ...previous,
                                forceIncludeServerIds: [...previous.forceIncludeServerIds.filter(name => name !== server.name), ...(!wasEnabled ? [server.name] : [])],
                                forceExcludeServerIds: [...previous.forceExcludeServerIds.filter(name => name !== server.name), ...(wasEnabled ? [server.name] : [])],
                            };
                        })} />)}
                    {servers.length === 0 ? <Item title={t('common.none')} showChevron={false} /> : null}
                </View>,
            });
        }
        if (!mcpServersEnabled) return null;

        return createMcpActionChip({
            label: chipLabel,
            selectedCount,
            stabilityKey: chipStabilityKey,
            onIntent: demandPreview,
            popoverContent: ({ maxHeight }) => (
                <NewSessionMcpSelectionContent
                    {...contentProps}
                    maxHeight={Math.min(760, maxHeight)}
                />
            ),
            maxHeightCap: 760,
            maxWidthCap: 620,
        });
    }, [chipLabel, chipStabilityKey, contentProps, demandPreview, mcpServersEnabled, selectedCount, params.hqPreset, params.mcpSelection, params.setMcpSelection]);

    return { mcpChip, mcpPreview, mcpPreviewLoading };
}
