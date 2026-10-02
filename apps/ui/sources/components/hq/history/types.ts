import type { DirectTranscriptRawMessageV1 } from '@happier-dev/protocol';
export type HistoryScope = Readonly<{ kind: 'work' | 'research' | 'company' | 'personal' | 'vault'; company?: string }>;
export type ImportedThread = Readonly<{ id: string; title: string; originalCwd: string; mappedCwd: string; timestamp: string; parentId?: string; children: ImportedThread[]; scope: HistoryScope }>;
export type ImportedPage = Readonly<{ thread: ImportedThread; items: DirectTranscriptRawMessageV1[]; hasMore: boolean; nextCursor: string | null }>;
export type ContinuationContext = Readonly<{ sourceThreadId: string; scope: HistoryScope; text: string; truncated: boolean }>;
export type HistoryTarget = Readonly<{ machineId: string; serverId: string; scope: HistoryScope }>;
