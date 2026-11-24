import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, type Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import {
  answersToday, EXTRA_ANSWERS, isDone, planExtras, turnOrder, type Extra, type ExtraPrefs,
} from '../tools/extras';
import { loadExtras, saveExtraPrefs, subscribeExtras, updateExtraState, type Extras } from '../tools/extrasStorage';
import { liveMisses, markList } from '../tools/marks';
import { loadToolMarks, saveToolPrefs, toolMarks } from '../tools/storage';
import { toolById } from '../tools/tools';
import { useApp } from './AppContext';
import { useStudyDay } from './useStudyDay';

/** How long after one tap on an extra another one is taken as the same tap. */
const OPEN_GAP_MS = 1000;

/** One of today's extras as a screen shows it. */
export interface ExtraItem {
  extra: Extra;
  /** "Thai: Numbers". */
  title: string;
  /** Why it's offered, and how far along it is. */
  detail: string;
  done: boolean;
}

/**
 * Today's extras (src/tools/extras.ts) for the Today tab, the end of a deck and the settings
 * screen: one plan, so they never disagree. Needs Read & Listen's deck settings to know which deck
 * is which language, so it offers nothing while those aren't loaded. Never touches a card.
 */
export function useDailyExtras() {
  const router = useRouter();
  const { decks, reader } = useApp();
  const [saved, setSaved] = useState<Extras>();
  const [marksIn, setMarksIn] = useState(false);

  useEffect(() => {
    let live = true;
    const read = () => loadExtras().then((e) => { if (live) setSaved({ ...e }); });
    read();
    loadToolMarks().then(() => { if (live) setMarksIn(true); });
    const stop = subscribeExtras(() => { read(); });
    return () => { live = false; stop(); };
  }, []);

  const readerDecks = reader.settings?.decks;
  const languages = useMemo(() => {
    if (!readerDecks) return [];
    return (Object.entries(readerDecks) as [Language, string][])
      .filter(([, deck]) => (decks.find((d) => d.deck === deck)?.total ?? 0) > 0)
      .map(([l]) => l);
  }, [readerDecks, decks]);
  const readerOn = !!reader.api;
  const hour = reader.dayStartsAtHour;

  // Worked out again when the next study day starts, so Today left open overnight isn't on yesterday's plan.
  const day = useStudyDay(hour);
  const plan = useMemo(() => {
    if (!saved || !marksIn || !languages.length) return undefined;
    return planExtras({ prefs: saved.prefs, state: saved.state, languages, readerOn, marks: toolMarks(), now: new Date(), dayStartsAtHour: hour });
  }, [saved, marksIn, languages, readerOn, hour, day]); // eslint-disable-line react-hooks/exhaustive-deps -- `day` is when to work it out again

  // The first plan of the day, or one for changed settings, is kept so the day's list holds still.
  const kept = useRef<unknown>(undefined);
  useEffect(() => {
    if (!saved || !plan || plan === saved.state.plan || kept.current === plan) return;
    kept.current = plan;
    updateExtraState((s) => ({ ...s, plan }));
  }, [saved, plan]);

  const items = useMemo<ExtraItem[]>(() => {
    if (!saved || !plan) return [];
    return plan.extras.map((extra) => {
      const done = isDone(saved.state, extra, plan.start);
      const name = LANGUAGES[extra.language].name;
      if (extra.kind === 'read') {
        return { extra, title: `${name}: Read a text`, done, detail: done ? 'Done' : extra.why === 'focus' ? 'Focus language' : 'Your turn today' };
      }
      const title = `${name}: ${toolById(extra.kind)?.title ?? extra.kind}`;
      const missed = liveMisses(toolMarks()[markList(extra.kind, extra.language)], Date.now()) > 0;
      const progress = answersToday(saved.state, extra, plan.start);
      const detail = done ? 'Done'
        : progress > 0 ? `${progress} of ${EXTRA_ANSWERS} answers`
        : [extra.why === 'focus' ? 'Focus language' : 'Your turn today', missed ? 'you missed some recently' : ''].filter(Boolean).join(', ');
      return { extra, title, detail, done };
    });
  }, [saved, plan]);

  /** Opens the extra: a drill in its language, or Read & Listen's shelf in it. */
  // A second tap before the screen it opens is up (a double tap on a chip or a row) opens it once.
  const openedAt = useRef(0);
  const open = useCallback(async (extra: Extra): Promise<string | undefined> => {
    if (Date.now() - openedAt.current < OPEN_GAP_MS) return undefined;
    openedAt.current = Date.now();
    if (extra.kind !== 'read') {
      saveToolPrefs({ language: extra.language });
      router.push({ pathname: '/tool', params: { id: extra.kind } });
      return undefined;
    }
    if (!reader.api) return 'Turn on Read & Listen in Settings to read a text.';
    try {
      reader.setSettings(await reader.api.updateSettings({ language: extra.language }));
    } catch (e) {
      openedAt.current = 0; // nothing opened: Try again is taken at once
      return e instanceof ApiError ? e.message : "Couldn't open Read & Listen. Try again.";
    }
    router.navigate('/read');
    return undefined;
  }, [router, reader.api, reader.setSettings]);

  const savePrefs = useCallback((next: ExtraPrefs) => saveExtraPrefs(next), []);

  // Known once the saved extras and marks are in and, with Read & Listen on, its settings (which
  // deck is which language) are too. Today waits for it so the strip isn't inserted above the decks.
  const ready = !!saved && marksIn && (!readerOn || !!reader.settings);

  return {
    ready,
    prefs: saved?.prefs,
    savePrefs,
    items,
    done: items.filter((i) => i.done).length,
    open,
    /** The languages with a deck, for the settings screen. */
    languages,
    /** The languages taking turns, next first. */
    turns: saved ? turnOrder({ prefs: saved.prefs, state: saved.state, languages, readerOn }) : [],
  };
}
