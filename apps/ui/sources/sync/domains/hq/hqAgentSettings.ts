import { z } from 'zod';

const mcpSchema = z.object({
    name: z.string(), command: z.string().default(''), args: z.array(z.string()).default([]), enabled: z.boolean(), url: z.string().optional(),
}).strict().refine(value => value.url ? !value.command && value.args.length === 0 && value.url.startsWith('https://') : Boolean(value.command));
export const HqAgentPresetSchema = z.object({
    model: z.string(), effort: z.string(), serviceTier: z.string().optional(), approvalsReviewer: z.enum(['user', 'auto_review']).optional(), jsRepl: z.boolean().optional(),
    webSearch: z.string(), network: z.boolean(), instructions: z.string(), skills: z.array(z.string()),
    hooks: z.object({ sessionContext: z.boolean(), inboxCapture: z.boolean() }), mcp: z.array(mcpSchema),
});
export const HqAgentImportReportSchema = z.object({ preset: HqAgentPresetSchema, imported: z.array(z.object({ key: z.string(), reason: z.string() })), replaced: z.array(z.object({ key: z.string(), reason: z.string() })), skipped: z.array(z.object({ key: z.string(), reason: z.string() })) });
export const HqAgentSettingsSchema = z.object({ version: z.literal(1), revision: z.string(), presets: z.object({ work: HqAgentPresetSchema, research: HqAgentPresetSchema, ordinary: HqAgentPresetSchema.optional() }), importReport: HqAgentImportReportSchema.optional() });
export const HqAgentSnapshotSchema = z.object({ settings: HqAgentSettingsSchema, skills: z.array(z.object({ name: z.string(), description: z.string(), research: z.boolean() })) });
export type HqAgentPreset = z.infer<typeof HqAgentPresetSchema>;
export type HqAgentSettings = z.infer<typeof HqAgentSettingsSchema>;
export type HqAgentSnapshot = z.infer<typeof HqAgentSnapshotSchema>;
