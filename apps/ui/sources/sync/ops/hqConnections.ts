import { HqConnectionsSchema, type HqConnections } from '@/sync/domains/hq/hqConnections';
import { hqControl } from './hqControl';

export async function companyConnections(machineId: string, serverId: string, companyId: string, operation: string, args: Readonly<Record<string, unknown>> = {}): Promise<HqConnections> {
    const result = HqConnectionsSchema.parse(await hqControl<unknown>(machineId, operation, { ...args, companyId }, serverId));
    if (result.companyId !== companyId) throw new Error('HQ returned another company');
    return result;
}
