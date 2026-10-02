import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import type { SessionStorageKind } from '@/sync/domains/session/sessionStorageKind';
import { t } from '@/text';
import { SessionListStorageTabsBar } from './SessionListStorageTabsBar';
import { Icon } from '@/components/ui/icons/Icon';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';

export type HqSessionListView = 'projects' | 'history';

const stylesheet = StyleSheet.create(() => ({
    navigation: { paddingHorizontal: 15, paddingVertical: 10 },
    browseActionContainer: {
        marginTop: -4,
    },
    browseActionGroupSurface: {
        backgroundColor: 'transparent',
        boxShadow: 'none',
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
    },
}));

export type SessionsListStorageChromeProps = Readonly<{
    directSessionsEnabled: boolean;
    storageKind: SessionStorageKind;
    onSelectStorageKind: (storageKind: SessionStorageKind) => void;
    hqNavigation?: Readonly<{
        view: HqSessionListView;
        onSelectView: (view: HqSessionListView) => void;
        pathname: string;
    }>;
}>;

export const SessionsListStorageChrome = React.memo((props: SessionsListStorageChromeProps) => {
    const router = useRouter();
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const showDirectBrowseAction = props.directSessionsEnabled && props.storageKind === 'direct';
    const hq = props.hqNavigation;

    return (
        <>
            {hq ? (
                <View style={styles.navigation}>
                    <SegmentedTabBar<HqSessionListView | 'direct'>
                        tabs={[
                            { id: 'projects', label: t('hq.projects') },
                            { id: 'history', label: t('common.history') },
                            ...(props.directSessionsEnabled ? [{ id: 'direct' as const, label: t('sessionsList.storageDirectTab') }] : []),
                        ]}
                        activeTabId={props.storageKind === 'direct' ? 'direct' : hq.view}
                        testIDPrefix="hq-view"
                        scrollable
                        onSelectTab={(view) => {
                            void runGuardedNavigation(() => {
                                if (view !== 'direct') hq.onSelectView(view);
                                props.onSelectStorageKind(view === 'direct' ? 'direct' : 'persisted');
                                if (hq.pathname.startsWith('/hq/') || hq.pathname.startsWith('/settings')) router.push('/');
                            });
                        }}
                    />
                </View>
            ) : props.directSessionsEnabled ? (
                <SessionListStorageTabsBar
                    activeTabId={props.storageKind}
                    onSelectTab={props.onSelectStorageKind}
                />
            ) : null}
            {showDirectBrowseAction ? (
                <ItemGroup
                    style={styles.browseActionContainer}
                    containerStyle={styles.browseActionGroupSurface}
                    constrainToContentWidth={false}
                >
                    <Item
                        testID="direct-sessions-browse-button"
                        title={t('directSessions.browseOpenExisting')}
                        subtitle={t('directSessions.browseActionSubtitle')}
                        icon={<Icon name="folder-open" size={20} color={theme.colors.text.secondary} />}
                        onPress={() => {
                            void runGuardedNavigation(() => router.push('/direct/browse'));
                        }}
                    />
                </ItemGroup>
            ) : null}
        </>
    );
});
