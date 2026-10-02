import type { HqCatalog } from './hqCatalog';

export type HqChatType = 'work' | 'research';
type Company = HqCatalog['companies'][number];
type Product = Company['products'][number];
type Repo = Product['repos'][number];
export type HqChatTarget = Readonly<{
    type: HqChatType;
    path: string;
    company?: Company;
    product?: Product;
    repo?: Repo;
    worktree?: Repo['worktrees'][number];
}>;

// Match the runner's exact binding contract, not the sidebar's descendant grouping.
export function resolveHqChatTarget(catalog: HqCatalog, path: string): HqChatTarget | null {
    if (catalog.research?.path === path) return { type: 'research', path };
    for (const company of catalog.companies) {
        if (company.path === path) return { type: 'work', path, company };
        for (const product of company.products) {
            if (product.path === path) return { type: 'work', path, company, product };
            for (const repo of product.repos) {
                if (repo.path === path) return { type: 'work', path, company, product, repo };
                const worktree = repo.worktrees.find(candidate => candidate.path === path);
                if (worktree) return { type: 'work', path, company, product, repo, worktree };
            }
        }
    }
    return null;
}

export function isHqChatRouteReady(target: HqChatTarget | null, type: HqChatType, taskName: string): boolean {
    if (!target || target.type !== type) return false;
    return type === 'research' || Boolean(target.repo && (target.worktree || taskName.trim()));
}
