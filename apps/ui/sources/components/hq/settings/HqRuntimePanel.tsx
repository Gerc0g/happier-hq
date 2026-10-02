import * as React from 'react';
import { View } from 'react-native';
import { z } from 'zod';
import { Text } from '@/components/ui/text/Text';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ToolbarButton } from '@/components/ui/buttons/ToolbarButton';
import type { HqMachineTarget } from '@/components/hq/HqScreenShell';
import { hqControl } from '@/sync/ops/hqControl';
import { t } from '@/text';

const schema = z.object({
    tasks: z.array(z.object({ id: z.string(), state: z.string(), error: z.string().optional(), startedAt: z.string(), finishedAt: z.string().optional(), binding: z.object({ companyId: z.string().optional(), repoId: z.string().optional(), directory: z.string(), preset: z.string() }) })),
    limits: z.object({ tasks: z.number(), perCompany: z.number(), memory: z.string(), cpus: z.string(), pids: z.string(), diskBytes: z.number(), diskEnforcement: z.string() }),
});

export function HqRuntimePanel({ target, active }: { target: HqMachineTarget; active: boolean }) {
    const [value, setValue] = React.useState<z.infer<typeof schema> | null>(null);
    const [failed, setFailed] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const generation = React.useRef(0);
    const current = React.useRef(active); current.current = active;
    React.useEffect(() => () => { generation.current += 1; }, []);
    const refresh = React.useCallback(async () => {
        if (!current.current) return;
        const request = ++generation.current;
        setBusy(true); setFailed(false);
        try {
            const result = schema.parse(await hqControl(target.machineId, 'runtime.status', {}, target.serverId));
            if (request === generation.current && current.current) setValue(result);
        } catch { if (request === generation.current && current.current) setFailed(true); }
        finally { if (request === generation.current) setBusy(false); }
    }, [target.machineId, target.serverId]);
    React.useEffect(() => { if (active) void refresh(); else generation.current += 1; }, [active, refresh]);
    const tasks = [...(value?.tasks ?? [])].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const running = tasks.filter(task => !task.finishedAt && (task.state === 'running' || task.state === 'starting'));
    const states: Record<string, string> = { starting: t('hq.agent.runtimeStarting'), running: t('hq.agent.runtimeRunning'), completed: t('hq.agent.runtimeCompleted'), failed: t('hq.agent.runtimeFailed'), interrupted: t('hq.agent.runtimeInterrupted'), 'git-conflict': t('hq.agent.runtimeGitConflict'), 'disk-limit': t('hq.agent.runtimeDiskLimit') };
    return <ItemGroup title={t('hq.agent.runtimeTitle')} footer={t('hq.agent.runtimeBoundary')}>
        <View style={{ padding: 16, gap: 12 }}>
            {failed ? <Text testID="hq-runtime-error" accessibilityRole="alert">{t('hq.agent.runtimeUnavailable')}</Text> : null}
            {value ? <Text testID="hq-runtime-capacity">{t('hq.agent.runtimeCapacity')} {running.length} / {value.limits.tasks} · {t('hq.agent.runtimePerCompany')} {value.limits.perCompany} · {value.limits.memory} RAM · {value.limits.cpus} CPU</Text> : null}
            {value && running.length === 0 ? <Text>{t('hq.agent.runtimeIdle')}</Text> : null}
            <ToolbarButton testID="hq-runtime-refresh" label={t('common.refresh')} disabled={!active || busy} onPress={() => { void refresh(); }} />
        </View>
        {tasks.slice(0, 5).map(task => <Item key={task.id} testID={`hq-runtime-task-${task.id}`} title={task.binding.repoId || task.binding.companyId || t(task.binding.preset === 'ordinary' ? 'hq.routing.ordinary' : 'hq.agent.research')} subtitle={`${states[task.state] ?? task.state} · ${new Date(task.startedAt).toLocaleString()}`} subtitleLines={0} showChevron={false} />)}
    </ItemGroup>;
}
