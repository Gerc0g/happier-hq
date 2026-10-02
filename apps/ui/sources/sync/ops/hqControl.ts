import { z } from 'zod';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';

const envelope = z.discriminatedUnion('ok', [
    z.object({ v: z.literal(1), ok: z.literal(true), result: z.unknown() }),
    z.object({ v: z.literal(1), ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);

export class HqControlError extends Error {
    constructor(public readonly code: string, message: string) { super(message); this.name = 'HqControlError'; }
}

// Owner-only machine RPC. Runner requests use a separate, prebound capability
// socket; a task cannot select a company or edit its own policy through this API.
export async function hqControl<T>(machineId: string, operation: string, args: unknown, serverId?: string): Promise<T> {
    const response = await machineRpcWithServerScope<unknown, unknown>({
        machineId, serverId, method: 'hq.control.v1', payload: { v: 1, operation, args },
        // Do not replay after issuance: a disconnected response may hide a save.
        onIssued: () => {},
    });
    const parsed = envelope.safeParse(response);
    if (!parsed.success) throw new HqControlError('HQ_UNSUPPORTED_RESPONSE', 'The server did not return a supported HQ response');
    if (!parsed.data.ok) throw new HqControlError(parsed.data.error.code, parsed.data.error.message);
    return parsed.data.result as T;
}
