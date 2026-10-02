import { z } from 'zod';
import { SessionPermissionModeInputSchema } from '@happier-dev/protocol';

import type { SpawnSessionOptions } from '@/rpc/handlers/registerSessionHandlers';

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
const mcpSelection = z.object({
    v: z.literal(1),
    managedServersEnabled: z.boolean(),
    forceIncludeServerIds: z.array(identifier),
    forceExcludeServerIds: z.array(identifier),
}).strict();

// This is a non-secret per-session overlay. MCP IDs refer to owner-managed HQ
// preset names; commands, credentials, hooks and host paths cannot be supplied.
export const HQSessionOptionsSchema = z.object({
    v: z.literal(1),
    model: identifier.or(z.literal('')).optional(),
    effort: identifier.optional(),
    serviceTier: identifier.or(z.literal('')).optional(),
    webSearch: z.enum(['live', 'cached', 'indexed', 'disabled']).optional(),
    network: z.boolean().optional(),
    permissionMode: SessionPermissionModeInputSchema.optional(),
    mcpSelection: mcpSelection.optional(),
}).strict();
export type HQSessionOptions = z.infer<typeof HQSessionOptionsSchema>;

export function parseHQSessionOptions(raw: string | undefined): HQSessionOptions {
    try {
        return HQSessionOptionsSchema.parse(raw === undefined ? { v: 1 } : JSON.parse(raw));
    } catch {
        throw new Error('HQ session options are invalid');
    }
}

export function resolveHQSessionOptions(options: SpawnSessionOptions): HQSessionOptions {
    const overlay = parseHQSessionOptions(options.environmentVariables?.HQ_SESSION_OPTIONS);
    return HQSessionOptionsSchema.parse({
        ...overlay,
        ...(options.modelId && options.modelId !== 'default' ? { model: options.modelId } : {}),
        ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
        ...(options.mcpSelection ? { mcpSelection: options.mcpSelection } : {}),
    });
}
