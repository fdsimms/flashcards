import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { useColorScheme } from 'react-native';
import { AppProvider } from '../ui/AppContext';
import { useStackScreenOptions } from '../ui/stackOptions';
import { useTheme } from '../ui/theme';

/**
 * The root of the app: the shared state, the navigation theme (the app's own palette, so a screen
 * never flashes the system's white or black while it slides in), and the stack every screen is
 * pushed onto (the tabs sit at its root). Each route file wraps one screen from src/ui; the screen
 * sets its own title and header buttons (`Screen` in src/ui/kit.tsx).
 */
export default function RootLayout() {
  const c = useTheme();
  const stackOptions = useStackScreenOptions();
  const dark = useColorScheme() === 'dark';
  const base = dark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, primary: c.accent, background: c.bg, card: c.bg, text: c.text, border: c.border },
  };
  return (
    <ThemeProvider value={theme}>
      <AppProvider>
        <Stack screenOptions={stackOptions}>
          {/* The tabs (Decks, Read & Listen) each hold their own stack, with their own header. The
              title is never shown; it is the back button's label on a screen pushed over a tab,
              which would otherwise read "(tabs)", the route group's name. */}
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Back' }} />
          {/* The note editor opens over Review and Browse as a sheet. */}
          <Stack.Screen name="note-editor" options={{ presentation: 'modal' }} />
        </Stack>
      </AppProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
