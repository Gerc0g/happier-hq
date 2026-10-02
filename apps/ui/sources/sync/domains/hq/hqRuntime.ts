import { Platform } from 'react-native';

export function isHqWorkspaceEnabled(): boolean {
    return Platform.OS === 'web' && process.env.EXPO_PUBLIC_HAPPIER_HQ_ENABLED === '1';
}
