import { z } from 'zod';
import type { HqEntityTarget } from './hqEntity';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { normalizeSessionPathForProjectGrouping } from '@/sync/domains/session/listing/sessionListProjectGroupingKeys';

const worktreeSchema = z.object({ id: z.string(), path: z.string(), branch: z.string(), state: z.string(), task: z.string(), creationRequestId: z.string().optional() });
const repoSchema = z.object({ name: z.string(), path: z.string(), worktrees: z.array(worktreeSchema) });
const productSchema = z.object({ slug: z.string(), path: z.string(), repos: z.array(repoSchema) });
const companySchema = z.object({ slug: z.string(), path: z.string(), products: z.array(productSchema) });
export const HqCatalogSchema = z.object({ version: z.literal(1), root: z.string(), companies: z.array(companySchema), research: z.object({ path: z.string() }).optional(), ordinary: z.object({ path: z.string() }).optional() });
export type HqCatalog = z.infer<typeof HqCatalogSchema>;
export type HqRepoTarget = Readonly<{ machineId: string; company: string; product: string; repo: string; path: string }>;
export type HqMachineCatalog = Readonly<{ machineId: string; catalog: HqCatalog }>;
export type HqTreeRow =
    | Readonly<{ kind: 'company' | 'product' | 'repo' | 'worktree' | 'work' | 'research' | 'other'; key: string; title: string; depth: number; target?: HqRepoTarget; entity?: HqEntityTarget; path?: string; branch?: string; sessionCount?: number }>
    | Readonly<{ kind: 'session'; key: string; depth: number; item: Extract<SessionListViewItem, { type: 'session' }> }>;

type HqGroupRow = Exclude<HqTreeRow, { kind: 'session' }>;
type HqSessionRow = Extract<HqTreeRow, { kind: 'session' }>;
type HqSessionLocation = Readonly<{ row: HqGroupRow; path: string }>;

export function buildHqTreeRows(input: Readonly<{
    catalogs: readonly HqMachineCatalog[];
    sessions: readonly SessionListViewItem[];
    serverId: string;
    expanded: ReadonlySet<string>;
}>): HqTreeRow[] {
    const sectionKey = (kind: 'work' | 'research' | 'other') => JSON.stringify(['hq', input.serverId, kind]);
    const work: HqGroupRow = { kind: 'work', key: sectionKey('work'), title: '', depth: 0, sessionCount: 0 };
    const research: HqGroupRow = { kind: 'research', key: sectionKey('research'), title: '', depth: 0, sessionCount: 0 };
    const other: HqGroupRow = { kind: 'other', key: sectionKey('other'), title: '', depth: 0, sessionCount: 0 };
    const groups: HqGroupRow[] = [work];
    const locationsByMachine = new Map<string, HqSessionLocation[]>();
    for (const { machineId, catalog } of input.catalogs) {
        const key = (kind: HqGroupRow['kind'], ...identity: string[]) => JSON.stringify(['hq', input.serverId, machineId, kind, ...identity]);
        const locations = locationsByMachine.get(machineId) ?? [];
        locationsByMachine.set(machineId, locations);
        for (const company of catalog.companies) {
            const companyRow: HqGroupRow = { kind: 'company', key: key('company', company.slug), title: company.slug, depth: 1, path: company.path, entity: { machineId, scope: company.slug } };
            groups.push(companyRow);
            locations.push({ row: companyRow, path: normalizeSessionPathForProjectGrouping(company.path, undefined) });
            for (const product of company.products) {
                const productRow: HqGroupRow = { kind: 'product', key: key('product', company.slug, product.slug), title: product.slug, depth: 2, path: product.path, entity: { machineId, scope: `${company.slug}/${product.slug}` } };
                groups.push(productRow);
                locations.push({ row: productRow, path: normalizeSessionPathForProjectGrouping(product.path, undefined) });
                for (const repo of product.repos) {
                    const target: HqRepoTarget = { machineId, company: company.slug, product: product.slug, repo: repo.name, path: repo.path };
                    const repoRow: HqGroupRow = { kind: 'repo', key: key('repo', company.slug, product.slug, repo.name), title: repo.name, depth: 3, path: repo.path, target, entity: { machineId, scope: `${company.slug}/${product.slug}/${repo.name}` } };
                    groups.push(repoRow);
                    locations.push({ row: repoRow, path: normalizeSessionPathForProjectGrouping(repo.path, undefined) });
                    for (const worktree of repo.worktrees) {
                        const worktreeRow: HqGroupRow = {
                            kind: 'worktree', key: key('worktree', company.slug, product.slug, repo.name, worktree.id),
                            title: worktree.task || worktree.id, depth: 4, path: worktree.path, branch: worktree.branch, target,
                        };
                        groups.push(worktreeRow);
                        locations.push({ row: worktreeRow, path: normalizeSessionPathForProjectGrouping(worktree.path, undefined) });
                    }
                }
            }
        }
    }

    // Assign ownership before applying visibility, so collapsed chats cannot
    // be mistaken for sessions outside the HQ catalog.
    groups.push(research, other);
    const researchPaths = new Map(input.catalogs.filter(item => item.catalog.research).map(item => [item.machineId, normalizeSessionPathForProjectGrouping(item.catalog.research!.path, undefined)]));
    const counts = new Map<string, number>();
    const sessionsByGroup = new Map<string, HqSessionRow[]>();
    const seen = new Set<string>();
    for (const item of input.sessions) {
        if (item.type !== 'session') continue;
        const serverId = item.serverId ?? input.serverId;
        const sessionKey = JSON.stringify(['session', serverId, item.session.id]);
        if (seen.has(sessionKey)) continue;
        seen.add(sessionKey);

        const metadata = item.session.metadata;
        const path = normalizeSessionPathForProjectGrouping(metadata?.path, metadata?.homeDir);
        let owner: HqSessionLocation | undefined;
        if (serverId === input.serverId && metadata?.machineId && path) {
            for (const location of locationsByMachine.get(metadata.machineId) ?? []) {
                if (!location.path || (owner && owner.path.length >= location.path.length)) continue;
                const prefix = location.path.endsWith('/') ? location.path : `${location.path}/`;
                if (path === location.path || path.startsWith(prefix)) owner = location;
            }
        }
        const researchPath = serverId === input.serverId && metadata?.machineId ? researchPaths.get(metadata.machineId) : undefined;
        const isResearch = Boolean(researchPath && (path === researchPath || path.startsWith(`${researchPath}/`)));
        const section = isResearch ? research : owner ? work : other;
        const groupKey = isResearch ? research.key : owner?.row.key ?? other.key;
        counts.set(section.key, (counts.get(section.key) ?? 0) + 1);
        const rows = sessionsByGroup.get(groupKey) ?? [];
        rows.push({ kind: 'session', key: sessionKey, depth: isResearch ? 1 : (owner?.row.depth ?? 0) + 1, item });
        sessionsByGroup.set(groupKey, rows);
    }

    const rows: HqTreeRow[] = [];
    let collapsedDepth: number | null = null;
    for (const group of groups) {
        if (collapsedDepth !== null && group.depth > collapsedDepth) continue;
        collapsedDepth = null;
        rows.push(group.depth === 0 ? { ...group, sessionCount: counts.get(group.key) ?? 0 } : group);
        if (!input.expanded.has(group.key)) {
            collapsedDepth = group.depth;
            continue;
        }
        rows.push(...(sessionsByGroup.get(group.key) ?? []));
    }
    return rows;
}
