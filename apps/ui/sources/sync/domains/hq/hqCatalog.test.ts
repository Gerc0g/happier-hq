import { describe, expect, it } from 'vitest';
import { createSessionFixture } from '@/dev/testkit';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { buildHqTreeRows, HqCatalogSchema, type HqCatalog } from './hqCatalog';

const catalog: HqCatalog = {
    version: 1, root: '/projects', companies: [{ slug: 'chimera', path: '/projects/chimera', products: [{
        slug: 'aetheria', path: '/projects/chimera/aetheria', repos: [{
            name: 'Aetheria-AI', path: '/projects/chimera/aetheria/Aetheria-AI', worktrees: [{
                id: 'task-1', task: 'Fix chat', branch: 'agent/task-1', state: 'active', path: '/projects/.worktrees/task-1',
            }],
        }, { name: 'Aetheria-App', path: '/projects/chimera/aetheria/Aetheria-App', worktrees: [] }],
    }] }],
};
function session(id: string, path: string, machineId = 'machine-1', serverId = 'server-1'): Extract<SessionListViewItem, { type: 'session' }> {
    const fixture = createSessionFixture({ id });
    return {
        type: 'session', serverId,
        session: buildSessionListRenderableFromSession({
            ...fixture, metadata: { ...fixture.metadata!, path, host: 'vps', machineId, homeDir: '/projects' },
        }),
    };
}
const allKeys = new Set([
    ...['work', 'research', 'other'].map(kind => JSON.stringify(['hq', 'server-1', kind])),
    JSON.stringify(['hq', 'server-1', 'machine-1', 'company', 'chimera']),
    JSON.stringify(['hq', 'server-1', 'machine-1', 'product', 'chimera', 'aetheria']),
    ...['Aetheria-AI', 'Aetheria-App', 'nested', 'repo'].map(repo => JSON.stringify(['hq', 'server-1', 'machine-1', 'repo', 'chimera', 'aetheria', repo])),
    JSON.stringify(['hq', 'server-1', 'machine-1', 'worktree', 'chimera', 'aetheria', 'Aetheria-AI', 'task-1']),
]);
const input = { catalogs: [{ machineId: 'machine-1', catalog }], serverId: 'server-1', expanded: allKeys };

describe('HQ project tree', () => {
    it('includes empty repositories and groups chats under the owning HQ worktree', () => {
        const rows = buildHqTreeRows({ ...input, sessions: [session('one', '/projects/.worktrees/task-1/src')] });
        expect(rows.flatMap(row => row.kind === 'repo' ? [row.title] : [])).toEqual(['Aetheria-AI', 'Aetheria-App']);
        const index = rows.findIndex(row => row.kind === 'worktree');
        expect(rows[index + 1]).toMatchObject({ kind: 'session', item: { session: { id: 'one' } } });
        expect(rows[index + 1].depth).toBe(rows[index].depth + 1);
    });

    it('does not attach sibling-prefix paths or another machine/server to the HQ repository', () => {
        const unscoped = { ...session('unscoped', '/projects/.worktrees/task-1'), serverId: undefined };
        const rows = buildHqTreeRows({ ...input, sessions: [
            unscoped,
            session('sibling', '/projects/.worktrees/task-10'),
            session('foreign-machine', '/projects/.worktrees/task-1', 'machine-2'),
            session('foreign-server', '/projects/.worktrees/task-1', 'machine-1', 'server-2'),
        ] });
        const other = rows.findIndex(row => row.kind === 'other');
        expect(other).toBeGreaterThan(0);
        expect(rows.slice(other + 1).filter(row => row.kind === 'session')).toHaveLength(3);
        expect(rows.slice(0, other).filter(row => row.kind === 'session').map(row => row.item.session.id)).toEqual(['unscoped']);
    });

    it('honors collapsed HQ nodes without losing ownership of their chats', () => {
        const sessions = [session('one', '/projects/.worktrees/task-1')];
        const rows = buildHqTreeRows({ ...input, sessions });
        for (const kind of ['company', 'product', 'repo', 'worktree']) {
            const node = rows.find(row => row.kind === kind)!;
            expect(node).toBeDefined();
            const collapsed = buildHqTreeRows({ ...input, sessions, expanded: new Set([...allKeys].filter(key => key !== node.key)) });
            expect(collapsed).toContainEqual(node);
            expect(collapsed.some(row => row.kind === 'session')).toBe(false);
            const nextVisible = collapsed[collapsed.findIndex(row => row.key === node.key) + 1];
            expect(nextVisible?.depth ?? 0).toBeLessThanOrEqual(node.depth);
        }
    });

    it('normalizes home-relative paths and does not duplicate sessions appearing in multiple history groups', () => {
        const item = { ...session('one', '~\\.worktrees\\task-1\\'), pinned: true, groupKind: 'pinned' as const };
        const rows = buildHqTreeRows({ ...input, sessions: [item, { ...item, pinned: false, groupKind: 'project' }] });
        expect(rows.filter(row => row.kind === 'session')).toHaveLength(1);
        expect(rows.some(row => row.kind === 'other' && row.sessionCount! > 0)).toBe(false);
        const chat = rows.find(row => row.kind === 'session');
        expect(chat?.kind === 'session' && chat.item).toBe(item);
    });

    it('uses the longest owning path and keeps base-checkout chats directly under their repository', () => {
        const nested = structuredClone(catalog);
        const repo = nested.companies[0].products[0].repos[0];
        repo.worktrees[0].path = `${repo.path}/nested/.worktrees/task-1`;
        nested.companies[0].products[0].repos.push({ name: 'nested', path: `${repo.path}/nested`, worktrees: [] });
        const base = session('base', repo.path);
        const nestedChat = session('nested', `${repo.path}/nested/src`);
        const worktreeChat = session('worktree', `${repo.worktrees[0].path}/src`);
        const rows = buildHqTreeRows({ ...input, catalogs: [{ machineId: 'machine-1', catalog: nested }], sessions: [base, nestedChat, worktreeChat] });
        for (const [id, kind, path] of [['base', 'repo', repo.path], ['nested', 'repo', `${repo.path}/nested`], ['worktree', 'worktree', repo.worktrees[0].path]]) {
            const index = rows.findIndex(row => row.kind === 'session' && row.item.session.id === id);
            expect(index).toBeGreaterThan(0);
            expect(rows[index - 1]).toMatchObject({ kind, path });
            expect(rows[index].depth).toBe(rows[index - 1].depth + 1);
        }
    });

    it('keeps empty companies and products and ignores presentation headers', () => {
        const empty = structuredClone(catalog);
        empty.companies.push({ slug: 'empty-company', path: '/projects/empty-company', products: [] });
        empty.companies[0].products.push({ slug: 'empty-product', path: '/projects/chimera/empty-product', repos: [] });
        const rows = buildHqTreeRows({ ...input, catalogs: [{ machineId: 'machine-1', catalog: empty }], sessions: [{ type: 'header', title: 'Pinned', headerKind: 'pinned' }] });
        expect(rows.flatMap(row => row.kind === 'company' ? [row.title] : [])).toEqual(['chimera', 'empty-company']);
        expect(rows.flatMap(row => row.kind === 'product' ? [row.title] : [])).toEqual(['aetheria', 'empty-product']);
        expect(rows.some(row => row.kind === 'session')).toBe(false);
    });

    it('keeps server-scoped session identities distinct and collapses unmatched sessions', () => {
        const sessions = [session('same-id', '/outside'), session('same-id', '/outside', 'machine-1', 'server-2')];
        const rows = buildHqTreeRows({ ...input, catalogs: [], sessions });
        expect(rows.map(row => row.kind)).toEqual(['work', 'research', 'other', 'session', 'session']);
        expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
        expect(buildHqTreeRows({ ...input, catalogs: [], sessions, expanded: new Set() })).toEqual(rows.slice(0, 3));
    });

    it('normalizes native catalog paths with the canonical session grouping normalizer', () => {
        for (const [repoPath, sessionPath] of [
            ['C:\\projects\\repo\\', 'C:/projects/repo/src'],
            ['\\\\server\\share\\repo\\', '//server/share/repo/src'],
        ]) {
            const native = structuredClone(catalog);
            native.companies[0].products[0].repos = [{ name: 'repo', path: repoPath, worktrees: [] }];
            const rows = buildHqTreeRows({ ...input, catalogs: [{ machineId: 'machine-1', catalog: native }], sessions: [session('one', sessionPath)] });
            expect(rows.filter(row => row.kind === 'session')).toHaveLength(1);
            expect(rows.some(row => row.kind === 'other' && row.sessionCount! > 0)).toBe(false);
        }
    });

    it('keeps node keys stable across catalog refresh and session reordering, and scopes them by machine and server', () => {
        const sessions = [session('first', '/projects/.worktrees/task-1'), session('second', '/projects/.worktrees/task-1')];
        const rows = buildHqTreeRows({ ...input, sessions });
        expect(rows.length).toBeGreaterThan(0);
        const refreshed = structuredClone(catalog);
        refreshed.companies[0].products[0].repos[0].worktrees[0].task = 'Renamed task';
        const next = buildHqTreeRows({ ...input, catalogs: [{ machineId: 'machine-1', catalog: refreshed }], sessions: [...sessions].reverse() });
        expect(next.map(row => row.key).sort()).toEqual(rows.map(row => row.key).sort());
        for (const scoped of [
            buildHqTreeRows({ ...input, sessions: [], serverId: 'server-2' }),
            buildHqTreeRows({ ...input, sessions: [], catalogs: [{ machineId: 'machine-2', catalog }] }),
        ]) {
            expect(scoped.filter(row => row.kind === 'company').every(row => !rows.some(previous => previous.key === row.key))).toBe(true);
        }
    });

    it('rejects an unsupported HQ output version and malformed repository data', () => {
        expect(HqCatalogSchema.safeParse({ ...catalog, version: 2 }).success).toBe(false);
        expect(HqCatalogSchema.safeParse({ version: 1, root: '/', companies: [{ slug: 'x' }] }).success).toBe(false);
    });
});


describe('HQ Work and Research sections', () => {
    const researchCatalog = { ...catalog, research: { path: '/wiki/research' } };
    const sections = { ...input, catalogs: [{ machineId: 'machine-1', catalog: researchCatalog }] };
    const key = (kind: string) => JSON.stringify(['hq', 'server-1', kind]);

    it('starts with collapsed Work, Research and Other sections', () => {
        const rows = buildHqTreeRows({ ...sections, sessions: [session('work', '/projects/.worktrees/task-1')], expanded: new Set() });
        expect(rows.map(row => row.kind)).toEqual(['work', 'research', 'other']);
    });

    it('reveals only the requested level and keeps work chats out of Other while collapsed', () => {
        const rows = buildHqTreeRows({ ...sections, sessions: [session('work', '/projects/.worktrees/task-1')], expanded: new Set([key('work'), key('other')]) });
        expect(rows.map(row => row.kind)).toEqual(['work', 'company', 'research', 'other']);
    });

    it('shows research chats as a flat list using machine and server bound research paths', () => {
        const research = session('research', '/wiki/research/topics/ml');
        const rows = buildHqTreeRows({ ...sections, sessions: [research, research, session('sibling', '/wiki/research-other'), session('foreign-machine', '/wiki/research', 'machine-2'), session('foreign-server', '/wiki/research', 'machine-1', 'server-2')], expanded: new Set([key('research'), key('other')]) });
        const start = rows.findIndex(row => row.kind === 'research');
        const end = rows.findIndex(row => row.kind === 'other');
        expect(rows.slice(start + 1, end)).toMatchObject([{ kind: 'session', depth: 1, item: { session: { id: 'research' } } }]);
        expect(rows.slice(end + 1).map(row => row.kind === 'session' && row.item.session.id)).toEqual(['sibling', 'foreign-machine', 'foreign-server']);
    });
});


it('keeps company and product onboarding chats inside Work at their own level', () => {
    const rows = buildHqTreeRows({ ...input, sessions: [session('company', '/projects/chimera'), session('product', '/projects/chimera/aetheria')] });
    for (const id of ['company', 'product']) {
        const index = rows.findIndex(row => row.kind === 'session' && row.item.session.id === id);
        expect(rows[index - 1]?.kind).toBe(id);
    }
    expect(rows.find(row => row.kind === 'work')).toMatchObject({ sessionCount: 2 });
    expect(rows.find(row => row.kind === 'other')).toMatchObject({ sessionCount: 0 });
});
