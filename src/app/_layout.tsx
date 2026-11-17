import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppFontScope } from '../ui/AppFont';
import { AppProvider, useApp } from '../ui/AppContext';
import { HeldWork } from '../ui/HeldWork';
import { ShelfDownloads } from '../ui/reader/ShelfDownloads';
import { ReaderPlayerProvider } from '../ui/useReaderPlayer';
import { useStackScreenOptions } from '../ui/stackOptions';
import { useTheme } from '../ui/theme';
import { VocabReadyBanner } from '../ui/VocabReadyBanner';

/**
 * The root of the app: the shared state, the navigation theme (the app's own palette, so a screen
 * never flashes the system's white or black while it slides in), and the stack every screen is
 * pushed onto (the tabs sit at its root). Each route file wraps one screen from src/ui; the screen
 * sets its own title and header buttons (`Screen` in src/ui/kit.tsx).
 */
/** The app's font (Settings, Font) for everything under the shared state. */
function FontScope({ children }: { children: React.ReactNode }) {
  return <AppFontScope repo={useApp().repo}>{children}</AppFontScope>;
}

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
    <GestureHandlerRootView style={{ flex: 1 }}>
    <ThemeProvider value={theme}>
      <AppProvider>
        <FontScope>
        <ReaderPlayerProvider>
        <Stack screenOptions={stackOptions}>
          {/* The tabs (Decks, Read & Listen) each hold their own stack, with their own header. The
              title is never shown; it is the back button's label on a screen pushed over a tab,
              which would otherwise read "(tabs)", the route group's name. */}
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Back' }} />
          {/* The note editor opens over Review and Browse as a sheet: half height first, pulled up to full. */}
          <Stack.Screen name="note-editor" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.65, 1], sheetInitialDetentIndex: 0, sheetGrabberVisible: true }} />
          {/* Read & Listen's + button opens writing a text as a sheet, full height for the keyboard. */}
          <Stack.Screen name="read-write" options={{ presentation: 'formSheet', sheetAllowedDetents: [1], sheetGrabberVisible: true }} />
          {/* The header's Offline button opens what's waiting for the connection as a short sheet. */}
          <Stack.Screen name="offline" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.5, 1], sheetInitialDetentIndex: 0, sheetGrabberVisible: true }} />
        </Stack>
        <VocabReadyBanner />
        <HeldWork />
        <ShelfDownloads />
        </ReaderPlayerProvider>
        </FontScope>
      </AppProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
    </GestureHandlerRootView>
  );
}
