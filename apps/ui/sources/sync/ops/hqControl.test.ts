import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hqControl } from './hqControl';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));

describe('HQ owner operations', () => {
    beforeEach(() => rpc.mockReset());
    it('sends typed input through the encrypted owner machine transport without a shell', async () => {
        rpc.mockResolvedValue({ v: 1, ok: true, result: { revision: 'saved' } });
        const args = { companyId: 'chimera', token: 'private; $(not-a-command)' };
        expect(await hqControl('machine', 'connections.credential.put', args, 'relay')).toEqual({ revision: 'saved' });
        expect(rpc).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine', serverId: 'relay', method: 'hq.control.v1',
            payload: { v: 1, operation: 'connections.credential.put', args },
            onIssued: expect.any(Function),
        }));
    });
    it('preserves conflict codes and does not retry mutations', async () => {
        rpc.mockResolvedValue({ v: 1, ok: false, error: { code: 'HQ_REVISION_CONFLICT', message: 'Reload before saving' } });
        await expect(hqControl('m', 'agent.save', {})).rejects.toMatchObject({ code: 'HQ_REVISION_CONFLICT' });
        expect(rpc).toHaveBeenCalledTimes(1);
    });
    it('fails on an unsupported response instead of treating it as saved', async () => {
        rpc.mockResolvedValue({ v: 2, ok: true });
        await expect(hqControl('m', 'agent.save', {})).rejects.toThrow();
    });
});
