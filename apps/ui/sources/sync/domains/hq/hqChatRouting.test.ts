import { expect, it } from 'vitest';
import { HqCatalogSchema } from './hqCatalog';
import { resolveHqChatTarget } from './hqChatRouting';

const catalog = HqCatalogSchema.parse({ version: 1, root: '/projects', research: { path: '/wiki/research' }, ordinary: { path: '/hq/ordinary' }, companies: [
    { slug: 'acme', path: '/projects/acme', products: [{ slug: 'app', path: '/projects/acme/app', repos: [
        { name: 'web', path: '/projects/acme/app/web', worktrees: [{ id: 'fix', path: '/tasks/fix', branch: 'fix', state: 'active', task: 'Fix' }] },
    ] }] },
] });

it('resolves every supported work scope and isolated route from the authoritative catalog', () => {
    for (const path of ['/projects/acme', '/projects/acme/app', '/projects/acme/app/web', '/tasks/fix']) {
        expect(resolveHqChatTarget(catalog, path)?.type).toBe('work');
    }
    expect(resolveHqChatTarget(catalog, '/tasks/fix')?.worktree?.branch).toBe('fix');
    expect(resolveHqChatTarget(catalog, '/wiki/research')?.type).toBe('research');
    expect(resolveHqChatTarget(catalog, '/hq/ordinary')).toBeNull();
});

it('rejects unregistered folders and descendants that the runner cannot bind', () => {
    for (const path of ['', '~', '/projects/acme/app/web/src', '/wiki/research/topic', '/hq/ordinary-other']) {
        expect(resolveHqChatTarget(catalog, path)).toBeNull();
    }
});

it('does not invent ordinary support on an older server', () => {
    const { ordinary: _ordinary, ...legacy } = catalog;
    expect(resolveHqChatTarget(legacy, '/hq/ordinary')).toBeNull();
});
