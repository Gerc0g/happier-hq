import { HqCatalogSchema, type HqCatalog, type HqRepoTarget } from '@/sync/domains/hq/hqCatalog';
import { machineBash } from './machines';
import { HqEntityCardSchema, HqEntityTaskSchema, type HqEntityCard, type HqEntityTask, type HqEntityTaskRequest, type HqEntityUpdate } from '@/sync/domains/hq/hqEntity';
import { encodeBase64 } from '@/encryption/base64';

export class HqCommandError extends Error {
    constructor(public readonly kind: 'unavailable' | 'invalidCatalog' | 'commandFailed' | 'invalidEntity' | 'conflict' | 'unconfirmed', message: string, public readonly creationNotStarted = false, public readonly exitCode?: number) {
        super(message);
        this.name = 'HqCommandError';
    }
}

export async function readHqCatalog(machineId: string, serverId: string): Promise<HqCatalog> {
    const result = await machineBash(machineId, { argv: ['hq', 'ls', '--json'] }, '/', { serverId });
    if (!result.success || result.exitCode !== 0) throw new HqCommandError('unavailable', result.stderr);
    try {
        return HqCatalogSchema.parse(JSON.parse(result.stdout));
    } catch {
        throw new HqCommandError('invalidCatalog', 'HQ did not return a supported catalog');
    }
}

export async function createHqWorktree(target: HqRepoTarget, task: string, serverId: string, requestId?: string): Promise<string> {
    if (!task.trim()) throw new HqCommandError('commandFailed', 'A task name is required', true);
    const result = await machineBash(target.machineId, {
        argv: ['hq', 'workspace', 'start', target.company, target.product, target.repo, task, ...(requestId ? ['--request-id', requestId] : [])],
    }, '/', {
        serverId,
        // Opt into the transport's issuance fence: never replay a command after emission.
        onIssued: () => {},
    });
    if (!result || !Number.isInteger(result.exitCode)) throw new HqCommandError('unconfirmed', 'HQ did not return a command result');
    if (!result.success || result.exitCode !== 0) {
        const refusal = result.exitCode > 0;
        const notStarted = refusal && (!requestId || /^(?:Error:[ \t]*)?HQ_WORKTREE_NOT_CREATED:/.test(result.stderr));
        throw new HqCommandError(refusal ? 'commandFailed' : 'unconfirmed', result.stderr, notStarted, result.exitCode);
    }
    const path = result.stdout.trim();
    if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path) || /[\r\n\0]/.test(path)) {
        throw new HqCommandError('unconfirmed', 'HQ did not return a worktree path');
    }
    return path;
}

function parseEntity(stdout: string, scope: string): HqEntityCard {
    try {
        const card = HqEntityCardSchema.parse(JSON.parse(stdout));
        if (card.scope !== scope) throw new Error('Unexpected entity');
        return card;
    } catch {
        throw new HqCommandError('invalidEntity', 'HQ did not return the requested entity');
    }
}

export async function readHqEntity(machineId: string, serverId: string, scope: string): Promise<HqEntityCard> {
    const result = await machineBash(machineId, { argv: ['hq', 'entity', 'show', scope, '--json'] }, '/', { serverId });
    if (!result.success || result.exitCode !== 0) throw new HqCommandError('unavailable', result.stderr);
    return parseEntity(result.stdout, scope);
}

export async function readHqEntityTask(machineId: string, serverId: string, request: HqEntityTaskRequest): Promise<HqEntityTask> {
    const result = await machineBash(machineId, {
        argv: ['hq', 'entity', 'task', request.scope, '--action', 'onboard', ...(request.itemId ? ['--item', request.itemId] : []), '--json'],
    }, '/', { serverId });
    if (!result.success || result.exitCode !== 0) throw new HqCommandError('unavailable', result.stderr);
    try {
        const task = HqEntityTaskSchema.parse(JSON.parse(result.stdout));
        if (task.scope !== request.scope || task.kind !== request.kind || task.directory !== request.directory || task.itemId !== request.itemId) {
            throw new Error('Unexpected HQ task target');
        }
        return task;
    } catch {
        throw new HqCommandError('invalidEntity', 'HQ did not return the requested task');
    }
}

export async function updateHqEntity(machineId: string, serverId: string, scope: string, update: HqEntityUpdate): Promise<HqEntityCard> {
    const encoded = encodeBase64(new TextEncoder().encode(JSON.stringify(update)), 'base64');
    const result = await machineBash(machineId, { argv: ['hq', 'entity', 'update', scope, '--json-base64', encoded] }, '/', {
        serverId,
        // A transport loss after emission may hide a successful write. Never replay it.
        onIssued: () => {},
    });
    if (!result.success || result.exitCode !== 0) {
        throw new HqCommandError(result.stderr.includes('HQ_ENTITY_REVISION_CONFLICT') ? 'conflict' : 'commandFailed', result.stderr);
    }
    return parseEntity(result.stdout, scope);
}
