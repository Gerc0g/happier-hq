import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { ToolbarButton } from '@/components/ui/buttons/ToolbarButton';
import { ConstrainedScreenContent } from '@/components/ui/layout/ConstrainedScreenContent';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { HqScreenShell } from '@/components/hq/HqScreenShell';
import { HqAgentSettings } from '@/components/hq/settings/HqAgentSettings';
import { t } from '@/text';

export default function HqSettingsScreen() {
    const router = useRouter();
    return <View style={{ flex: 1, minHeight: 0 }}>
        <ConstrainedScreenContent>
            <View style={{ alignItems: 'flex-end', paddingHorizontal: 16, paddingVertical: 8 }}>
                <ToolbarButton testID="hq-app-settings" label={t('settings.title')} onPress={() => { void runGuardedNavigation(() => router.push('/settings')); }} />
            </View>
        </ConstrainedScreenContent>
        <HqScreenShell title={t('hq.agent.title')}>{(target, active) => <HqAgentSettings target={target} active={active} />}</HqScreenShell>
    </View>;
}
