import { afterEach, describe, expect, it, vi } from 'vitest';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';

installSessionShellCommonModuleMocks();
describe('HQ deployment agent catalog', () => {
    afterEach(() => vi.unstubAllEnvs());
    it('offers only Codex, even with stale preferences and custom backends', async () => {
        vi.stubEnv('EXPO_PUBLIC_HAPPIER_HQ_ENABLED', '1');
        const { getEnabledAgentIds } = await import('./enabled');
        const { getResolvedBackendCatalogEntries } = await import('@/agents/backendCatalog/getResolvedBackendCatalogEntries');
        expect(getEnabledAgentIds({ backendEnabledByTargetKey: { 'agent:codex': false } })).toEqual(['codex']);
        const entries = getResolvedBackendCatalogEntries({ enabledAgentIds: ['claude', 'codex'], acpCatalogSettingsV1: { v: 2, backends: [] } });
        expect(entries.map(entry => entry.providerAgentId)).toEqual(['codex']);
    });
});
