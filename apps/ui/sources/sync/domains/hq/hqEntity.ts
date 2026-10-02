import { z } from 'zod';

const kind = z.enum(['company', 'product', 'repo']);
const onboardingStatus = z.enum(['not_started', 'in_progress', 'complete']);
const healthStatus = z.enum(['ok', 'warning', 'error', 'unknown']);
export const HqEntityCardSchema = z.object({
    version: z.literal(1), scope: z.string(), kind, title: z.string(), path: z.string(),
    document: z.object({ path: z.string(), content: z.string(), revision: z.string().min(1) }),
    settings: z.object({ namespace: z.string(), vcs: z.string().optional(), host: z.string().optional(), gitEmail: z.string().optional() }),
    parents: z.array(z.object({ scope: z.string(), kind, title: z.string(), path: z.string(), documentPath: z.string() })),
    onboarding: z.object({
        status: onboardingStatus, completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(),
        items: z.array(z.object({ id: z.string(), title: z.string(), description: z.string(), status: z.enum(['missing', 'ready', 'review']), automatic: z.boolean() })),
    }),
    health: z.object({
        checkedAt: z.string(), status: healthStatus,
        checks: z.array(z.object({ id: z.string(), title: z.string(), status: healthStatus, detail: z.string(), path: z.string().optional(), blocking: z.boolean() })),
    }),
    children: z.array(z.object({ scope: z.string(), kind, title: z.string(), onboardingStatus, healthStatus, errorCount: z.number(), warningCount: z.number() })),
    history: z.array(z.object({ at: z.string(), actor: z.string(), action: z.string(), detail: z.string() })),
    agentActions: z.array(z.object({ id: z.literal('onboard'), skill: z.literal('onboard-agents-md') })).optional(),
});
export type HqEntityCard = z.infer<typeof HqEntityCardSchema>;
export const HqEntityTaskSchema = z.object({
    version: z.literal(1), scope: z.string().min(1), kind,
    directory: z.string().min(1).refine((value) => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value) && !/[\r\n\0]/.test(value)),
    action: z.literal('onboard'), skill: z.literal('onboard-agents-md'),
    itemId: z.string().min(1).optional(), prompt: z.string().refine((value) => value.trim().length > 0),
}).strict();
export type HqEntityTask = z.infer<typeof HqEntityTaskSchema>;
export type HqEntityTaskRequest = Readonly<Pick<HqEntityTask, 'scope' | 'kind' | 'directory' | 'itemId'>>;
export type HqEntityTarget = Readonly<{ machineId: string; scope: string }>;
export type HqEntityUpdate = Readonly<{ revision: string }> & (
    | Readonly<{ content: string; confirm?: never; settings?: never }>
    | Readonly<{ confirm: { id: string; confirmed: boolean }; content?: never; settings?: never }>
    | Readonly<{ settings: { namespace: string }; content?: never; confirm?: never }>
);
