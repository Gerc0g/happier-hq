import { describe, expect, it } from 'vitest';
import { HqAgentPresetSchema, HqAgentSnapshotSchema } from './hqAgentSettings';

const preset = {
    model: 'model', effort: 'high', webSearch: 'live', network: true, instructions: '', skills: [],
    hooks: { sessionContext: true, inboxCapture: false }, mcp: [],
};

describe('HQ agent settings response', () => {
    it('reads legacy snapshots and preserves an optional ordinary preset and import report', () => {
        const settings = { version: 1, revision: 'r1', presets: { work: preset, research: preset } };
        expect(HqAgentSnapshotSchema.parse({ settings, skills: [] }).settings.presets.ordinary).toBeUndefined();
        const ordinary = { ...preset, model: 'ordinary-model', serviceTier: 'default', approvalsReviewer: 'user', jsRepl: false };
        const importReport = { preset: ordinary, imported: [{ key: 'model', reason: 'portable' }], replaced: [], skipped: [] };
        const parsed = HqAgentSnapshotSchema.parse({ settings: { ...settings, presets: { ...settings.presets, ordinary }, importReport }, skills: [] });
        expect(parsed.settings.presets.ordinary).toEqual(ordinary);
        expect(parsed.settings.importReport).toEqual(importReport);
    });

    it('keeps command and HTTPS MCP validation at the shared boundary', () => {
        expect(HqAgentPresetSchema.parse({ ...preset, mcp: [{ name: 'docs', url: 'https://example.com/mcp', enabled: true }] }).mcp[0]).toMatchObject({ command: '', args: [] });
        expect(HqAgentPresetSchema.safeParse({ ...preset, mcp: [{ name: 'docs', url: 'http://example.com/mcp', enabled: true }] }).success).toBe(false);
        expect(HqAgentPresetSchema.safeParse({ ...preset, mcp: [{ name: 'docs', url: 'https://example.com/mcp', command: 'server', enabled: true }] }).success).toBe(false);
        expect(HqAgentPresetSchema.safeParse({ ...preset, mcp: [{ name: 'docs', command: 'server', headers: {}, enabled: true }] }).success).toBe(false);
    });
});
