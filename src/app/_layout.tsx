import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { useColorScheme } from 'react-native';
import { AppProvider } from '../ui/AppContext';
import { useTheme } from '../ui/theme';

/**
 * The root of the app: the shared state, the navigation theme (the app's own palette, so a screen
 * never flashes the system's white or black while it slides in), and the stack every screen is
 * pushed onto. Each route file wraps one screen from src/ui; the screen sets its own title and
 * header buttons (`Screen` in src/ui/kit.tsx).
 */
export default function RootLayout() {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const base = dark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, primary: c.accent, background: c.bg, card: c.bg, text: c.text, border: c.border },
  };
  return (
    <ThemeProvider value={theme}>
      <AppProvider>
        <Stack
          screenOptions={{
            headerTintColor: c.accent,
            headerTitleStyle: { color: c.text },
            headerLargeTitleStyle: { color: c.text },
            headerLargeStyle: { backgroundColor: c.bg },
            contentStyle: { backgroundColor: c.bg },
          }}
        >
          {/* The note editor opens over Review and Browse as a sheet. */}
          <Stack.Screen name="note-editor" options={{ presentation: 'modal' }} />
        </Stack>
      </AppProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
