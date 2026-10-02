import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import type { RpcHandlerManager } from '../rpc/RpcHandlerManager';
import { readImportedCodexHistory } from '@/backends/codex/directSessions/readImportedCodexHistory';

const requestSchema = z.object({
    v: z.literal(1),
    operation: z.string().regex(/^(?:agent|connections|knowledge|history|runtime|system)\.[a-zA-Z][a-zA-Z.]*$/),
    args: z.record(z.string(), z.unknown()),
}).strict();
const responseSchema = z.discriminatedUnion('ok', [
    z.object({ v: z.literal(1), ok: z.literal(true), result: z.unknown() }),
    z.object({ v: z.literal(1), ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
type Response = z.infer<typeof responseSchema>;

function failed(code: string): Response { return { v: 1, ok: false, error: { code, message: code } }; }

export async function executeHqControl(raw: unknown): Promise<Response> {
    const request = requestSchema.safeParse(raw);
    if (!request.success) return failed('HQ_REQUEST_INVALID');
    const executable = process.env.HQ_EXECUTABLE ?? join(homedir(), '.local/bin/hq');
    if (!isAbsolute(executable)) return failed('HQ_EXECUTABLE_INVALID');
    const response = await new Promise<Response>((resolve) => {
        const output: Buffer[] = [];
        let settled = false;
        const finish = (result: Response) => { if (!settled) { settled = true; resolve(result); } };
        const child = spawn(executable, ['control', '--json'], { cwd: '/', env: process.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
        // Owner responses are paged. This bounds one buffered machine RPC, not
        // the number of notes or chats; binary Git transfers use runner streams.
        const maxBytes = 16 * 1024 * 1024;
        let bytes = 0;
        child.stdout.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > maxBytes) { child.kill(); finish(failed('HQ_RESPONSE_TOO_LARGE')); return; }
            output.push(Buffer.from(chunk));
        });
        // Drain diagnostic output, but never forward it: a provider error can
        // include credentials or raw configuration supplied by the owner.
        child.stderr.resume();
        child.on('error', () => finish(failed('HQ_UNAVAILABLE')));
        child.on('close', (code) => {
            if (code !== 0) { finish(failed('HQ_COMMAND_FAILED')); return; }
            try {
                const parsed = responseSchema.safeParse(JSON.parse(Buffer.concat(output).toString('utf8')));
                finish(parsed.success ? parsed.data : failed('HQ_UNSUPPORTED_RESPONSE'));
            } catch { finish(failed('HQ_UNSUPPORTED_RESPONSE')); }
        });
        child.stdin.on('error', () => finish(failed('HQ_UNAVAILABLE')));
        child.stdin.end(JSON.stringify(request.data));
    });
    if (response.ok && (request.data.operation === 'history.get' || request.data.operation === 'history.continuation')) {
        try { return { ...response, result: await readImportedCodexHistory(request.data.operation, response.result) }; }
        catch { return failed('HQ_HISTORY_UNAVAILABLE'); }
    }
    return response;
}

export function registerMachineHqRpcHandlers(params: { rpcHandlerManager: RpcHandlerManager }): void {
    params.rpcHandlerManager.registerHandler('hq.control.v1', executeHqControl);
}
