import { z } from 'zod';

const strings = z.array(z.string()).nullish().transform((value) => value ?? []);
const verification = z.object({
    state: z.string(), read: z.string(), branchPush: z.string(), pullRequests: z.string(),
    credentialPermissions: z.string(), checkedAt: z.string().optional(), detail: z.string().optional(),
});
const policy = z.object({
    read: z.boolean(), branchPush: z.boolean(), pullRequests: z.boolean(), branchPrefixes: strings,
    protectedBranches: strings, targetBranch: z.string(), draft: z.boolean(), descriptionLanguage: z.string(),
    descriptionTemplate: z.string(), requiredChecks: strings,
});
const gitConnection = z.object({
    id: z.string(), provider: z.enum(['github', 'gitlab']), host: z.string(), namespace: z.string(),
    authorName: z.string(), authorEmail: z.string(), credentialRef: z.string(), expiresAt: z.string().optional(),
    policy, verification,
});
const environment = z.object({
    id: z.string(), tier: z.enum(['dev', 'stage', 'prod']), kind: z.literal('http'), baseUrl: z.string(),
    credentialRef: z.string(), expiresAt: z.string().optional(), verification,
    requests: z.array(z.object({ id: z.string(), method: z.enum(['GET', 'HEAD']), path: z.string(),
        query: z.record(z.string(), z.string()).nullish().transform((value) => value ?? {}), verify: z.boolean() })),
});
export const HqConnectionsSchema = z.object({
    companyId: z.string(), revision: z.number().int().nonnegative(), availableRepositories: strings,
    git: z.array(gitConnection), environments: z.array(environment),
    repositories: z.array(z.object({ repoId: z.string(), connectionId: z.string(), remotePath: z.string() })),
    history: z.array(z.object({ at: z.string(), action: z.string(), connectionId: z.string().optional() })).nullish().transform((value) => value ?? []),
});
export type HqConnections = z.infer<typeof HqConnectionsSchema>;
export type HqGitConnection = HqConnections['git'][number];
export type HqEnvironment = HqConnections['environments'][number];
export const disconnectedVerification = () => ({ state: 'disconnected', read: 'unverified', branchPush: 'unverified', pullRequests: 'unverified', credentialPermissions: 'unverified' });
export function newGitConnection(id: string): HqGitConnection {
    return { id, provider: 'github', host: 'https://github.com', namespace: '', authorName: '', authorEmail: '', credentialRef: '',
        verification: disconnectedVerification(), policy: { read: true, branchPush: false, pullRequests: false,
            branchPrefixes: ['work/'], protectedBranches: ['main', 'master'], targetBranch: 'main', draft: true,
            descriptionLanguage: '', descriptionTemplate: '', requiredChecks: [] } };
}
export function newEnvironment(id: string): HqEnvironment {
    return { id, tier: 'dev', kind: 'http', baseUrl: '', credentialRef: '', verification: disconnectedVerification(),
        requests: [{ id: 'health', method: 'GET', path: '/health', query: {}, verify: true }] };
}
