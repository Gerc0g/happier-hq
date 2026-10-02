import { Platform } from 'react-native';
import { decodeBase64 } from '@/encryption/base64';
import { hqControl } from '@/sync/ops/hqControl';
import type { HistoryTarget } from './types';

type AttachmentChunk = { name: string; mime: string; data: string; nextOffset: number | null; total: number };
export async function openHistoryAttachment(target: HistoryTarget, id: string) {
    const chunks: Uint8Array[] = [];
    let offset: number | null = 0;
    let last: AttachmentChunk | null = null;
    while (offset !== null) {
        const chunk: AttachmentChunk = await hqControl<AttachmentChunk>(target.machineId, 'history.attachment', { scope: target.scope, id, offset }, target.serverId);
        chunks.push(decodeBase64(chunk.data, 'base64')); last = chunk;
        if (chunk.nextOffset !== null && chunk.nextOffset <= offset) throw new Error('Invalid attachment pagination');
        offset = chunk.nextOffset;
    }
    if (!last) return;
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    let position = 0; for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
    if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([bytes], { type: last.mime }));
        try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = last.name; anchor.click(); }
        finally { URL.revokeObjectURL(url); }
    } else {
        const { File, Paths } = await import('expo-file-system');
        const { shareAsync } = await import('expo-sharing');
        const file = new File(Paths.cache, `hq-${Date.now()}-${last.name}`); file.write(bytes);
        try { await shareAsync(file.uri, { mimeType: last.mime }); } finally { file.delete(); }
    }
}
