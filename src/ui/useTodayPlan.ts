import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { studyDayStart } from '../core/day';
import { listenMinutes } from '../core/listenWords';
import { ApiError, type Language, type Shelf } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { isWatched, minutesFor } from '../reader/shelf';
import { EXTRA_ANSWERS, isDone, type ExtraKind, type ExtraState } from '../tools/extras';
import { loadExtras, subscribeExtras } from '../tools/extrasStorage';
import { liveMisses, markList } from '../tools/marks';
import {
  dayNumberOf, outcomeOf, pickLanguage, planDay, recordDay, weekDots, withDone, type PlanItem, type PlanKind, type PlanOffer, type PlanPrefs, type PlanState,
} from '../tools/plan';
import { loadPlan, savePlanPrefs, subscribePlan, updatePlanState } from '../tools/planStorage';
import { saveToolPrefs, toolMarks } from '../tools/storage';
import { toolById } from '../tools/tools';
import { useApp } from './AppContext';
import type { useDailyExtras } from './useDailyExtras';
import { useListenWords } from './useListenWords';
import { useStudyDay } from './useStudyDay';

/** How long after one tap on an item another one is taken as the same tap. */
const OPEN_GAP_MS = 1000;

/**
 * Today's plan (src/tools/plan.ts) for the Today tab: the language to plan in, what's on offer in it
 * (its deck's reviews and new words, the shelf's texts and its videos and podcasts, a Your words
 * lesson, a drill from Daily extras' plan, a scene, an entry), the day's items kept once made so the
 * list holds still, and which are done, from what Franki records. Needs Read & Listen's deck settings
 * to know which deck is which language, so it plans nothing while those aren't there. Never touches a card.
 */
export function useTodayPlan(extras: ReturnType<typeof useDailyExtras>) {
  const router = useRouter();
  const { decks, reader } = useApp();
  const [plan, setPlan] = useState<{ prefs: PlanPrefs; state: PlanState }>();
  const [extraState, setExtraState] = useState<ExtraState>();

  useEffect(() => {
    let live = true;
    const read = () => loadPlan().then((p) => { if (live) setPlan({ ...p }); });
    const readExtras = () => loadExtras().then((e) => { if (live) setExtraState(e.state); });
    read();
    readExtras();
    const stop = subscribePlan(read);
    const stopExtras = subscribeExtras(readExtras);
    return () => { live = false; stop(); stopExtras(); };
  }, []);

  const hour = reader.dayStartsAtHour;
  const day = useStudyDay(hour);
  const readerDecks = reader.settings?.decks;
  const languages = useMemo(() => {
    if (!readerDecks) return [];
    return (Object.entries(readerDecks) as [Language, string][]).flatMap(([language, deck]) => {
      const row = decks.find((d) => d.deck === deck);
      return row && row.total > 0 ? [{ language, deck, due: row.due, fresh: row.fresh }] : [];
    });
  }, [readerDecks, decks]);
  const language = plan ? pickLanguage(plan.prefs, languages) : null;
  const deck = languages.find((l) => l.language === language);

  // The shelf in the day's language, for a text to read and a video or episode to watch.
  const api = reader.api;
  const [shelf, setShelf] = useState<{ language: Language; day: string; shelf: Shelf | null }>();
  useEffect(() => {
    if (!api || !language || (shelf?.language === language && shelf.day === day)) return;
    let live = true;
    api.shelf(language).then(
      (got) => { if (live) setShelf({ language, day, shelf: got }); },
      () => { if (live) setShelf({ language, day, shelf: null }); },
    );
    return () => { live = false; };
  }, [api, language, day]); // eslint-disable-line react-hooks/exhaustive-deps
  const shelfIn = !api || (shelf?.language === language && shelf.day === day);

  const { words } = useListenWords(deck?.deck, 30);

  const offer = useMemo<PlanOffer | null>(() => {
    if (!deck || !language || !shelfIn || words === null) return null;
    const s = shelf?.shelf;
    // The text nearest a comfortable read (95% known), and the newest video or episode.
    const read = s?.texts.slice().sort((a, b) => Math.abs(a.coverage - 0.95) - Math.abs(b.coverage - 0.95))[0];
    const watch = s?.own?.find(isWatched);
    const drillExtra = extras.items.find((i) => i.extra.language === language && i.extra.kind !== 'read')?.extra;
    const drillTitle = drillExtra ? toolById(drillExtra.kind)?.title : undefined;
    return {
      due: deck.due,
      fresh: deck.fresh,
      ...(read ? { read: { title: read.title, minutes: minutesFor(read.lines), coverage: read.coverage } } : {}),
      ...(watch ? { watch: { id: watch.id, title: watch.title, minutes: minutesFor(watch.lines), what: watch.podcast ? 'podcast' as const : 'video' as const } } : {}),
      ...(api && words.length >= 3 ? { listen: { words: words.length, minutes: listenMinutes(words) } } : {}),
      ...(drillExtra && drillTitle ? { drill: { tool: drillExtra.kind, title: drillTitle, missed: liveMisses(toolMarks()[markList(drillExtra.kind as Exclude<ExtraKind, 'read'>, language)], Date.now()) > 0 } } : {}),
      speak: !!api,
      write: !!api,
    };
  }, [deck, language, shelfIn, shelf, words, extras.items, api]);

  // The day's items: kept once made, so the list holds still as things are done (reviews done
  // would otherwise drop out); made again for a new day, language or length.
  const saved = plan?.state.saved;
  const keep = !!saved && saved.day === day && saved.language === language && saved.minutes === plan?.prefs.minutes;
  const items = useMemo<PlanItem[] | null>(() => {
    if (!plan?.prefs.on || !language) return null;
    if (keep && saved) return saved.items;
    if (!offer) return null;
    return planDay(plan.prefs, offer, dayNumberOf(day));
  }, [plan, language, keep, saved, offer, day]);
  useEffect(() => {
    if (!items || keep || !language || !plan) return;
    updatePlanState((s) => ({ ...s, saved: { day, language, minutes: plan.prefs.minutes, items } }));
  }, [items, keep, language, plan, day]);

  const start = studyDayStart(new Date(), hour).getTime();
  const done = useCallback((item: PlanItem): boolean => {
    if (!language || !deck) return false;
    switch (item.kind) {
      case 'reviews': return deck.due === 0;
      case 'new': return deck.fresh === 0;
      case 'read':
      case 'watch': return (extraState?.reads[language] ?? 0) >= start;
      case 'drill': return !!extraState && !!item.ref && isDone(extraState, { kind: item.ref as ExtraKind, language, why: 'turn' }, start);
      default: return (plan?.state.done[`${item.kind}|${language}`] ?? 0) >= start;
    }
  }, [language, deck, extraState, plan, start]);

  const shown = useMemo(() => {
    if (!items) return null;
    const byKind = new Map(items.map((i) => [i.kind, i] as const));
    return withDone(items, (k: PlanKind) => done(byKind.get(k)!));
  }, [items, done]);

  // The day's outcome for the week's dots.
  const outcome = shown ? outcomeOf(shown.items) : null;
  useEffect(() => {
    if (!shown || !plan) return;
    if ((plan.state.days[day] ?? null) === outcome) return;
    updatePlanState((s) => recordDay(s, day, outcome));
  }, [outcome, day]); // eslint-disable-line react-hooks/exhaustive-deps

  const openedAt = useRef(0);
  const open = useCallback(async (item: PlanItem): Promise<string | undefined> => {
    if (!language || !deck || Date.now() - openedAt.current < OPEN_GAP_MS) return undefined;
    openedAt.current = Date.now();
    switch (item.kind) {
      case 'reviews':
      case 'new':
        router.push({ pathname: '/review', params: { deck: deck.deck } });
        return undefined;
      case 'read':
        return extras.open({ kind: 'read', language, why: 'turn' });
      case 'watch':
        router.push({ pathname: '/watch', params: { text: item.ref ?? '' } });
        return undefined;
      case 'drill':
        return extras.open({ kind: (item.ref ?? 'counting') as ExtraKind, language, why: 'turn' });
      case 'speak':
      case 'write':
        saveToolPrefs({ language });
        router.push({ pathname: '/tool', params: { id: item.kind === 'speak' ? 'situations' : 'journal' } });
        return undefined;
      case 'listen':
        if (!api) return 'Turn on Read & Listen in Settings to make a lesson.';
        try {
          reader.setSettings(await api.updateSettings({ language }));
        } catch (e) {
          openedAt.current = 0;
          return e instanceof ApiError ? e.message : "Couldn't open Lessons. Try again.";
        }
        router.navigate('/lessons');
        return undefined;
    }
  }, [language, deck, router, extras, api, reader.setSettings]);

  const savePrefs = useCallback((next: PlanPrefs) => savePlanPrefs(next), []);

  return {
    /** Known once the plan's settings are read and, with Read & Listen on, its settings and the shelf too. */
    ready: !!plan && (!api || !!reader.settings) && (!language || items !== null || !plan.prefs.on),
    on: !!plan?.prefs.on && !!items,
    prefs: plan?.prefs,
    savePrefs,
    language,
    languageName: language ? LANGUAGES[language].name : '',
    languages: languages.map((l) => l.language),
    items: shown?.items ?? [],
    minutes: plan?.prefs.minutes ?? 0,
    doneMinutes: shown?.doneMinutes ?? 0,
    planned: shown?.items.reduce((sum, i) => sum + i.minutes, 0) ?? 0,
    week: plan ? weekDots(plan.state, day) : [],
    open,
    extraAnswers: EXTRA_ANSWERS,
  };
}
