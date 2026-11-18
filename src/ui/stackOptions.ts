import { resolveFontFace } from '../core/fonts';
import { useFont } from './AppFont';
import { useTheme } from './theme';

/**
 * The native stack's look, shared by the root stack and each tab's own stack. The header is native, so
 * the `Text` patch in AppFont.tsx never reaches it: its titles are given the app's font here. The face is the
 * weight (`resolveFontFace`), so no `fontWeight` is set over it. Call it below `AppFontScope`.
 */
export function useStackScreenOptions() {
  const c = useTheme();
  const font = useFont();
  const title = resolveFontFace(font, '600');
  const largeTitle = resolveFontFace(font, '700');
  return {
    headerTintColor: c.accent,
    headerTitleStyle: { color: c.text, ...(title ? { fontFamily: title } : {}) },
    headerLargeTitleStyle: { color: c.text, ...(largeTitle ? { fontFamily: largeTitle } : {}) },
    // No headerLargeStyle background: on iOS 26 a background on the large title hides its text.
    contentStyle: { backgroundColor: c.bg },
  };
}
