import type { HqEntityCard } from '@/sync/domains/hq/hqEntity';

export function createHqEntityFixture(overrides: Partial<HqEntityCard> = {}): HqEntityCard {
    return {
        version: 1, scope: 'chimera/product/repo', kind: 'repo', title: 'repo', path: '/projects/repo',
        document: { path: '/projects/repo/AGENTS.md', content: '# Context\nOriginal instructions', revision: 'revision-1' },
        settings: { namespace: 'Chimera' },
        parents: [{ scope: 'chimera', kind: 'company', title: 'chimera', path: '/projects/chimera', documentPath: '/projects/chimera/AGENTS.md' }],
        onboarding: { status: 'in_progress', completed: 0, total: 1, items: [{ id: 'purpose', title: 'Purpose', description: 'Describe the purpose', status: 'missing', automatic: false }] },
        health: { checkedAt: '2026-09-27T10:00:00Z', status: 'ok', checks: [{ id: 'path', title: 'Directory', status: 'ok', detail: 'Exists', blocking: false }] },
        children: [], history: [], ...overrides,
    };
}
