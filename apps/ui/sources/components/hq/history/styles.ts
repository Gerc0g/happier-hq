import { Platform } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
export const historyStyles = StyleSheet.create((theme) => ({
    root: { flex: 1, backgroundColor: theme.colors.background.canvas },
    content: { padding: theme.margins.lg, gap: theme.margins.md, paddingBottom: theme.margins.xl },
    areaHeader: { paddingHorizontal: theme.margins.lg, paddingTop: theme.margins.md, gap: theme.margins.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.margins.sm },
    title: { ...Typography.rowTitle(), color: theme.colors.text.primary },
    text: { ...Typography.body(), color: theme.colors.text.primary },
    secondary: { ...Typography.rowMeta(), color: theme.colors.text.secondary },
    button: { minHeight: Platform.OS === 'android' ? 48 : 44 },
    panel: { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.default, borderRadius: theme.borderRadius.md, padding: theme.margins.md, gap: theme.margins.sm, backgroundColor: theme.colors.surface.base },
}));
