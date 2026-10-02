import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readHqEntity, readHqEntityTask, updateHqEntity } from './hq';
import { createHqEntityFixture } from '@/dev/testkit/fixtures/hqEntityFixtures';
import { decodeBase64 } from '@/encryption/base64';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));
const reply = (value: unknown) => ({ success: true, exitCode: 0, stdout: JSON.stringify(value), stderr: '' });

describe('HQ entity commands', () => {
    beforeEach(() => rpc.mockReset());
    it('reads one selected entity in the selected machine/server scope and validates the card', async () => {
        const card = createHqEntityFixture();
        rpc.mockResolvedValue(reply(card));
        expect(await readHqEntity('machine-1', 'server-1', card.scope)).toEqual(card);
        expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'machine-1', serverId: 'server-1', payload: { argv: ['hq', 'entity', 'show', card.scope, '--json'], cwd: '/' } }));
        rpc.mockResolvedValue(reply({ ...card, scope: 'another/repo' }));
        await expect(readHqEntity('machine-1', 'server-1', card.scope)).rejects.toMatchObject({ kind: 'invalidEntity' });
    });
    it('encodes Unicode Markdown as a single argument and fences issued writes from retry', async () => {
        const card = createHqEntityFixture();
        const update = { revision: card.document.revision, content: '# Контекст\n$(touch /tmp/nope) 😃' };
        rpc.mockResolvedValue(reply(card));
        await updateHqEntity('machine-1', 'server-1', card.scope, update);
        const request = rpc.mock.calls[0][0];
        expect(request.payload.argv.slice(0, 5)).toEqual(['hq', 'entity', 'update', card.scope, '--json-base64']);
        expect(JSON.parse(new TextDecoder().decode(decodeBase64(request.payload.argv[5])))).toEqual(update);
        expect(request.onIssued).toEqual(expect.any(Function));
    });
    it('reads a scoped onboarding task as argv and rejects a mismatched or malformed task', async () => {
        const card = createHqEntityFixture();
        const request = { scope: card.scope, kind: card.kind, directory: card.path, itemId: 'purpose' };
        const task = { version: 1, ...request, action: 'onboard', skill: 'onboard-agents-md', prompt: 'Use the skill. Не запускай $(shell).' };
        rpc.mockResolvedValue(reply(task));
        expect(await readHqEntityTask('machine-1', 'server-1', request)).toEqual(task);
        expect(rpc).toHaveBeenLastCalledWith(expect.objectContaining({ machineId: 'machine-1', serverId: 'server-1', payload: {
            argv: ['hq', 'entity', 'task', card.scope, '--action', 'onboard', '--item', 'purpose', '--json'], cwd: '/',
        } }));
        for (const invalid of [
            { scope: 'another/product' }, { kind: 'company' }, { directory: '/another' },
            { action: 'execute' }, { skill: 'another-skill' }, { itemId: 'environment' }, { prompt: '  ' }, { version: 2 },
        ]) {
            rpc.mockResolvedValue(reply({ ...task, ...invalid }));
            await expect(readHqEntityTask('machine-1', 'server-1', request)).rejects.toMatchObject({ kind: 'invalidEntity' });
        }
        rpc.mockResolvedValue(reply(task));
        await expect(readHqEntityTask('machine-1', 'server-1', { scope: card.scope, kind: card.kind, directory: card.path })).rejects.toMatchObject({ kind: 'invalidEntity' });
        rpc.mockResolvedValue({ success: false, exitCode: 1, stdout: '', stderr: 'Skill unavailable' });
        await expect(readHqEntityTask('machine-1', 'server-1', request)).rejects.toMatchObject({ kind: 'unavailable' });
    });
    it('surfaces conflicts and ambiguous failures without automatic mutation retry', async () => {
        rpc.mockResolvedValueOnce({ success: false, exitCode: 1, stdout: '', stderr: 'HQ_ENTITY_REVISION_CONFLICT: reload first' });
        await expect(updateHqEntity('machine-1', 'server-1', 'chimera/product/repo', { revision: 'old', content: 'draft' })).rejects.toMatchObject({ kind: 'conflict' });
        expect(rpc).toHaveBeenCalledTimes(1);
        rpc.mockRejectedValueOnce(new Error('disconnected'));
        await expect(updateHqEntity('machine-1', 'server-1', 'chimera/product/repo', { revision: 'old', content: 'draft' })).rejects.toThrow('disconnected');
        expect(rpc).toHaveBeenCalledTimes(2);
    });
});
