import { mkdtemp, mkdir, writeFile, appendFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readImportedCodexHistory } from './readImportedCodexHistory';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'hq-archive-')); roots.push(root);
    await mkdir(join(root, 'codex/sessions'), { recursive: true });
    const relativeFile = 'codex/sessions/rollout-2026-01-01T00-00-00-parent.jsonl';
    const line = (payload: unknown) => JSON.stringify({ type: 'response_item', timestamp: '2026-01-01T00:00:00Z', payload });
    await writeFile(join(root, relativeFile), [
        JSON.stringify({ type: 'session_meta', payload: { id: 'parent' } }),
        line({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Continue this project' }] }),
        line({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The next step is a test' }] }),
    ].join('\n') + '\n');
    return { thread: { id: 'parent', scope: { kind: 'research' }, title: 'Imported', children: [] }, archive: { root, relativeFile }, direction: 'older' };
}
describe('imported Codex history', () => {
    it('projects archive messages using direct transcript semantics and strips private paths', async () => {
        const descriptor = await fixture();
        const page = await readImportedCodexHistory('history.get', descriptor);
        expect('items' in page && page.items).toHaveLength(2);
        expect(JSON.stringify(page)).toContain('The next step is a test');
        expect(JSON.stringify(page)).not.toContain(descriptor.archive.root);
        const context = await readImportedCodexHistory('history.continuation', descriptor);
        expect(context).toMatchObject({ sourceThreadId: 'parent', scope: { kind: 'research' } });
        expect('text' in context && context.text).toContain('Continue this project');
        expect('text' in context && context.text).toContain('current');
    });
    it('does not discover a child outside the individually authorized catalog thread', async () => {
        const descriptor = await fixture();
        const child = '44444444-4444-4444-4444-444444444444';
        const event = JSON.stringify({ type: 'event_msg', timestamp: '2026-01-01T00:00:01Z', payload: { type: 'collab_agent_spawn_end', sender_thread_id: 'parent', new_thread_id: child, prompt: 'Inspect' } });
        await appendFile(join(descriptor.archive.root, descriptor.archive.relativeFile), event + '\n');
        await writeFile(join(descriptor.archive.root, `codex/sessions/rollout-2026-01-01T00-00-00-${child}.jsonl`), JSON.stringify({ type: 'response_item', timestamp: '2026-01-01T00:00:02Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Other company secret' }] } }) + '\n');
        const result = await readImportedCodexHistory('history.get', descriptor);
        expect(JSON.stringify(result)).not.toContain('Other company secret');
    });
    it('rejects a forged or escaping archive path before reading', async () => {
        const descriptor = await fixture();
        const other = await fixture();
        await symlink(join(other.archive.root, other.archive.relativeFile), join(descriptor.archive.root, 'codex/sessions/escape.jsonl'));
        await expect(readImportedCodexHistory('history.get', { ...descriptor, archive: { ...descriptor.archive, relativeFile: 'codex/sessions/escape.jsonl' } })).rejects.toThrow();
        await expect(readImportedCodexHistory('history.get', { ...descriptor, archive: { ...descriptor.archive, relativeFile: '../escape.jsonl' } })).rejects.toThrow();
    });
});
