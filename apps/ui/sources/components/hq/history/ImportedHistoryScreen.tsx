import * as React from 'react';
import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ToolbarButton } from '@/components/ui/buttons/ToolbarButton';
import { Text } from '@/components/ui/text/Text';
import { Item } from '@/components/ui/lists/Item';
import { ConstrainedScreenContent } from '@/components/ui/layout/ConstrainedScreenContent';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { hqControl } from '@/sync/ops/hqControl';
import { readHqCatalog } from '@/sync/ops/hq';
import type { HqCatalog } from '@/sync/domains/hq/hqCatalog';
import { t } from '@/text';
import type { ContinuationContext, ImportedPage, ImportedThread, HistoryTarget } from './types';
import { launchHqSession } from '@/components/sessions/hq/launchHqSession';
import { historyStyles as styles } from './styles';
import { openHistoryAttachment } from './openHistoryAttachment';

type HistoryResult = { threads: ImportedThread[]; total: number; nextOffset: number | null };
export function ImportedHistoryScreen({ target, active = true }: Readonly<{ target: HistoryTarget; active?: boolean }>) {
    const [list, setList] = React.useState<HistoryResult | null>(null);
    const [page, setPage] = React.useState<ImportedPage | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [failed, setFailed] = React.useState(false);
    const [context, setContext] = React.useState<ContinuationContext | null>(null);
    const [catalog, setCatalog] = React.useState<HqCatalog | null>(null);
    const router = useRouter();
    const alive = React.useRef(active); alive.current = active;
    React.useEffect(() => () => { alive.current = false; }, []);
    const request = React.useCallback(<T,>(operation: string, args: object = {}) => hqControl<T>(target.machineId, operation, { scope: target.scope, ...args }, target.serverId), [target]);
    const load = React.useCallback(async (offset = 0) => { if (!active) return; setBusy(true); setFailed(false); try { const result = await request<HistoryResult>('history.list', { offset }); if (alive.current) setList((old) => offset && old ? { ...result, threads: [...old.threads, ...result.threads] } : result); } catch { if (alive.current) setFailed(true); } finally { if (alive.current) setBusy(false); } }, [active, request]);
    React.useEffect(() => { void load(); }, [load]);
    const open = async (thread: ImportedThread, cursor?: string) => { setBusy(true); setFailed(false); try { const result = await request<ImportedPage>('history.get', { id: thread.id, cursor }); if (alive.current) { setPage((old) => cursor && old ? { ...result, items: [...result.items, ...old.items] } : result); if (!cursor) setContext(null); } } catch { if (alive.current) setFailed(true); } finally { if (alive.current) setBusy(false); } };
    const prepare = async () => { if (!page) return; setBusy(true); setFailed(false); try { const result = await request<ContinuationContext>('history.continuation', { id: page.thread.id }); const repos = target.scope.kind !== 'research' ? await readHqCatalog(target.machineId, target.serverId) : null; if (alive.current) { setContext(result); setCatalog(repos); } } catch { if (alive.current) setFailed(true); } finally { if (alive.current) setBusy(false); } };
    const launch = async (directory?: string) => { if (!context) return; setBusy(true); setFailed(false); try { const research = directory ? null : await hqControl<{ directory: string }>(target.machineId, 'knowledge.context', { scope: { kind: 'research' } }, target.serverId); if (alive.current) await launchHqSession({ ...target, directory: directory ?? research!.directory, text: context.text, isCurrent: () => alive.current, navigate: (route) => router.push(route) }); } catch { if (alive.current) setFailed(true); } finally { if (alive.current) setBusy(false); } };
    const header = <ConstrainedScreenContent style={styles.content}><View style={styles.row}>{page && <ToolbarButton label={t('common.back')} style={styles.button} onPress={() => { setPage(null); setContext(null); }} />}<Text style={styles.title}>{page?.thread.title ?? t('hq.history.title')}</Text></View><Text style={styles.secondary}>{t('hq.history.readOnlyArchive')}</Text>{busy && <Text>{t('hq.history.loading')}</Text>}{failed && <Text accessibilityRole="alert">{t('hq.history.failed')}</Text>}
        {page && <ToolbarButton label={t('hq.history.continue')} disabled={busy} style={styles.button} onPress={() => { void prepare(); }} />}
        {context && <View style={styles.panel}><Text style={styles.title}>{t('hq.history.continuation')}</Text>{context.truncated && <Text style={styles.secondary}>{t('hq.history.partialContext')}</Text>}{target.scope.kind !== 'company' && <ToolbarButton label={t('hq.history.research')} style={styles.button} disabled={busy} onPress={() => { void launch(); }} />}{catalog?.companies.filter((company) => target.scope.kind === 'personal' || company.slug === target.scope.company).flatMap((company) => company.products.flatMap((product) => product.repos.flatMap((repo) => [{ title: `${company.slug}/${product.slug}/${repo.name}`, path: repo.path }, ...repo.worktrees.map((worktree) => ({ title: `${repo.name} · ${worktree.task || worktree.id}`, path: worktree.path }))]))).map((repo) => <ToolbarButton key={repo.path} label={repo.title} style={styles.button} disabled={busy} onPress={() => { void launch(repo.path); }} />)}</View>}
        {page?.hasMore && <ToolbarButton label={t('hq.history.loadMore')} disabled={busy} style={styles.button} onPress={() => { void open(page.thread, page.nextCursor ?? undefined); }} />}
    </ConstrainedScreenContent>;
    if (page) return <FlatList style={styles.root} data={page.items} keyExtractor={(item) => item.id} ListHeaderComponent={header} renderItem={({ item }) => <ConstrainedScreenContent style={styles.content}><TranscriptItem item={item} target={target} /></ConstrainedScreenContent>} />;
    return <FlatList style={styles.root} data={list?.threads ?? []} keyExtractor={(item) => item.id} ListHeaderComponent={header} renderItem={({ item }) => <ConstrainedScreenContent><ThreadRow thread={item} open={(thread) => { void open(thread); }} /></ConstrainedScreenContent>} ListEmptyComponent={!busy ? <ConstrainedScreenContent style={styles.content}><Text>{t('hq.history.empty')}</Text></ConstrainedScreenContent> : null} ListFooterComponent={<ConstrainedScreenContent style={styles.content}><ToolbarButton label={t('hq.history.refresh')} style={styles.button} disabled={busy} onPress={() => { void load(); }} />{list?.nextOffset != null && <ToolbarButton label={t('hq.history.loadMore')} style={styles.button} disabled={busy} onPress={() => { void load(list.nextOffset!); }} />}</ConstrainedScreenContent>} />;
}
function ThreadRow({ thread, open }: Readonly<{ thread: ImportedThread; open: (thread: ImportedThread) => void }>) { const [expanded, setExpanded] = React.useState(false); return <View><Item title={thread.title} subtitle={`${thread.timestamp} · ${thread.originalCwd}`} onPress={() => open(thread)} />{thread.children.length > 0 && <View style={styles.content}><ToolbarButton label={`${t('hq.history.children')} (${thread.children.length})`} style={styles.button} active={expanded} onPress={() => setExpanded(!expanded)} />{expanded && thread.children.map((child) => <ThreadRow key={child.id} thread={child} open={open} />)}</View>}</View>; }
function TranscriptItem({ item, target }: Readonly<{ item: ImportedPage['items'][number]; target: HistoryTarget }>) {
    const [attachmentFailed, setAttachmentFailed] = React.useState(false);
    const [attachmentBusy, setAttachmentBusy] = React.useState(false);
    const attachments = [...new Set([...JSON.stringify(item.raw).matchAll(/\.codex\/((?:attachments|generated_images)\/[^\s"'\\)<>]+)/g)].map((match) => `codex/${match[1]}`))];
    const openAttachment = async (id: string) => { setAttachmentBusy(true); setAttachmentFailed(false); try { await openHistoryAttachment(target, id); } catch { setAttachmentFailed(true); } finally { setAttachmentBusy(false); } };
    const raw = item.raw as { role?: string; content?: { type?: string; text?: string; data?: { type?: string; message?: string; name?: string; input?: unknown; output?: unknown } } };
    const text = raw.role === 'user' ? raw.content?.text : raw.content?.data?.message;
    return <View style={styles.panel}><Text style={styles.secondary}>{raw.role === 'user' ? t('voiceActivity.format.you') : 'Codex'} · {new Date(item.createdAtMs).toLocaleString()}</Text>{typeof text === 'string' ? <MarkdownView markdown={text} /> : <Text selectable style={styles.secondary}>{JSON.stringify(raw.content?.data ?? raw.content, null, 2)}</Text>}{attachments.map((id) => <ToolbarButton key={id} label={`${t('hq.history.attachment')} · ${id.split('/').pop()}`} style={styles.button} disabled={attachmentBusy} onPress={() => { void openAttachment(id); }} />)}{attachmentFailed && <Text accessibilityRole="alert">{t('hq.history.attachmentFailed')}</Text>}</View>;
}
