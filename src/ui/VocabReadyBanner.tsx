import { usePathname, useRouter } from 'expo-router';
import React, { useEffect, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LANGUAGES } from '../reader/languages';
import { vocabWatch, watchStateOf } from '../reader/vocabWatch';
import { useApp } from './AppContext';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { lift, radius, smooth, space, type, useTheme } from './theme';

const POLL_MS = 3000;
const CHECK_PATH = '/read-vocab-check';

/** The pathname of the deck list, where the banner sits in the list's own stack instead of floating. */
export const DECKS_PATH = '/';

/**
 * What the banner says, or null when there's nothing to announce. No effects, so the deck list can
 * call it too; the waiting and the clean-up live in `VocabReadyBanner`, which is mounted once.
 */
export function useVocabReady() {
  const router = useRouter();
  const pathname = usePathname();
  const { reader } = useApp();
  const language = reader.settings?.language;
  const watch = useSyncExternalStore(vocabWatch.subscribe, vocabWatch.get);
  // The check opens on the language being read, so a banner for another one would open the wrong
  // questions: drop it. Reaching the check again from that language's settings shows its state.
  const stale = !!watch && watch.state !== 'waiting' && watch.language !== language;
  if (!watch || watch.state === 'waiting' || stale || pathname === CHECK_PATH) return { watch, stale, banner: null };
  const name = LANGUAGES[watch.language].name;
  const ready = watch.state === 'ready';
  return {
    watch,
    stale,
    banner: {
      ready,
      message: ready ? `The ${name} vocabulary check is ready` : `Couldn't write the ${name} questions`,
      hint: ready ? 'Tap to start' : 'Tap to see why and try again',
      open: () => { haptic.tap(); vocabWatch.clear(); router.push(CHECK_PATH); },
      dismiss: () => { haptic.tap(); vocabWatch.clear(); },
    },
  };
}

/** The banner's card: the same on the deck list and floating over any other screen. */
export function VocabReadyCard({ banner }: { banner: NonNullable<ReturnType<typeof useVocabReady>['banner']> }) {
  const c = useTheme();
  const { ready, message, hint } = banner;
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', borderRadius: radius.l, ...smooth,
        backgroundColor: c.surface, borderColor: c.border, borderWidth: 0.5, ...lift(c, 'high'),
      }}
    >
      <Tappable
        onPress={banner.open}
        accessibilityRole="button"
        accessibilityLabel={`${message}. ${hint}`}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56, paddingVertical: space.m, paddingLeft: space.l }}
      >
        <Icon name={ready ? 'checkmark.circle.fill' : 'exclamationmark.triangle.fill'} size={22} color={ready ? c.good : c.warning} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.callout, color: c.text }}>{message}</Text>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>{hint}</Text>
        </View>
      </Tappable>
      <Tappable
        onPress={banner.dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={{ width: 44, height: 44, marginRight: space.xs, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="xmark" size={14} color={c.textSecondary} />
      </Tappable>
    </View>
  );
}

/**
 * Says the vocabulary check's questions are ready when its screen was left while the server was
 * still writing them. It keeps asking in the background while Franki is open (the server pushes
 * nothing, so it can't reach you outside the app), and a tap opens the check.
 */
export function VocabReadyBanner() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { reader } = useApp();
  const api = reader.api;
  const { watch, stale, banner } = useVocabReady();

  // The check is open again: it shows its own state, so there's nothing to wait for or announce.
  useEffect(() => { if (pathname === CHECK_PATH) vocabWatch.clear(); }, [pathname]);
  // Without Read & Listen (signed out, or sync off) there's nobody to ask.
  useEffect(() => { if (!api) vocabWatch.clear(); }, [api]);

  const waitingOn = watch?.state === 'waiting' ? watch.language : null;
  useEffect(() => {
    if (!api || !waitingOn) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = async () => {
      try {
        const bank = await api.vocabCheck(waitingOn);
        if (cancelled) return;
        const next = watchStateOf(bank.state);
        if (next === 'waiting') timer = setTimeout(look, POLL_MS);
        else vocabWatch.finish(waitingOn, next);
      } catch {
        // A dropped connection shouldn't end the wait: ask again.
        if (!cancelled) timer = setTimeout(look, POLL_MS);
      }
    };
    look();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [api, waitingOn]);

  useEffect(() => { if (stale) vocabWatch.clear(); }, [stale]);

  // The deck list shows it in its own stack, above the sync problem, so it never covers either.
  if (!banner || pathname === DECKS_PATH) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + space.s, left: space.l, right: space.l }}>
      <VocabReadyCard banner={banner} />
    </View>
  );
}
