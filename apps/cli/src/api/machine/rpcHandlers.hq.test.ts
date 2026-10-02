import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));
import { executeHqControl } from './rpcHandlers.hq';

describe('HQ owner control adapter', () => {
    beforeEach(() => { spawn.mockReset(); });
    it('rejects command and unknown fields before launching a process', async () => {
        const result = await executeHqControl({ v: 1, operation: 'bash', args: {}, command: 'anything' });
        expect(result).toMatchObject({ ok: false });
        expect(spawn).not.toHaveBeenCalled();
    });
    it('sends secret parameters only on stdin and propagates the HQ envelope', async () => {
        const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
        let input = '';
        child.stdin.on('data', data => { input += data; });
        spawn.mockImplementation(() => {
            queueMicrotask(() => { child.stdout.write(JSON.stringify({ v: 1, ok: true, result: { saved: true } })); child.emit('close', 0); });
            return child;
        });
        const result = await executeHqControl({ v: 1, operation: 'connections.credential.put', args: { token: 'private-token' } });
        expect(result).toEqual({ v: 1, ok: true, result: { saved: true } });
        expect(JSON.parse(input).args.token).toBe('private-token');
        expect(spawn.mock.calls[0][1]).toEqual(['control', '--json']);
        expect(JSON.stringify(spawn.mock.calls[0])).not.toContain('private-token');
    });
    it('does not expose stderr or malformed process output', async () => {
        const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
        spawn.mockImplementation(() => { queueMicrotask(() => { child.stderr.write('SECRET'); child.emit('close', 1); }); return child; });
        const result = await executeHqControl({ v: 1, operation: 'agent.get', args: {} });
        expect(result).toMatchObject({ ok: false });
        expect(JSON.stringify(result)).not.toContain('SECRET');
    });
    it('preserves Markdown when a UTF-8 character spans process chunks', async () => {
        const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
        const raw = Buffer.from(JSON.stringify({ v: 1, ok: true, result: { content: 'Привет' } }));
        const split = raw.indexOf(Buffer.from('П')) + 1;
        spawn.mockImplementation(() => { queueMicrotask(() => { child.stdout.write(raw.subarray(0, split)); child.stdout.write(raw.subarray(split)); child.emit('close', 0); }); return child; });
        expect(await executeHqControl({ v: 1, operation: 'knowledge.get', args: {} })).toMatchObject({ result: { content: 'Привет' } });
    });
});
