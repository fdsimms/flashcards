import { useTheme } from './theme';

/** The native stack's look, shared by the root stack and each tab's own stack. */
export function useStackScreenOptions() {
  const c = useTheme();
  return {
    headerTintColor: c.accent,
    headerTitleStyle: { color: c.text },
    headerLargeTitleStyle: { color: c.text },
    // No headerLargeStyle background: on iOS 26 a background on the large title hides its text.
    contentStyle: { backgroundColor: c.bg },
  };
}
