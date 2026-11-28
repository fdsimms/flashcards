// Today's plan (docs/read-and-listen/architecture.md, "Today's plan"): a few things for the day, picked
// from everything Franki has, sized to the time set, in one language, and ticked off from what Franki
// already records. Reviews come first; when they'd fill the time, the plan is reviews alone and new
// words wait. Then new words, one thing to take in (a text, a video or podcast, or a Your words lesson)
// and one thing to produce (a drill from what's been missed, a Situations scene or a journal entry),
// rotating day by day so the same kind doesn't come up every time. It replaces the Daily extras strip
// on Today (its drills become one kind of item). Pure, so it's tested; it never moves a card's schedule.
import type { Language } from '../reader/api';
import { LANGUAGE_ORDER } from '../reader/languages';

export type PlanKind = 'reviews' | 'new' | 'read' | 'watch' | 'listen' | 'drill' | 'speak' | 'write';
/** The kinds the learner can leave out (Today's plan settings); reviews and new words are always offered. */
export type ChoiceKind = Exclude<PlanKind, 'reviews' | 'new'>;
export const CHOICE_KINDS: readonly ChoiceKind[] = ['read', 'watch', 'listen', 'drill', 'speak', 'write'];
const TAKE_IN: readonly ChoiceKind[] = ['read', 'watch', 'listen'];
const PRODUCE: readonly ChoiceKind[] = ['drill', 'speak', 'write'];

export const PLAN_MINUTES = [15, 30, 45, 60] as const;
export type PlanMinutes = (typeof PLAN_MINUTES)[number];

export interface PlanPrefs {
  on: boolean;
  minutes: PlanMinutes;
  /** 'auto': the language with the most to do today. */
  language: Language | 'auto';
  kinds: Record<ChoiceKind, boolean>;
}

export const DEFAULT_PLAN_PREFS: PlanPrefs = {
  on: true,
  minutes: 30,
  language: 'auto',
  kinds: { read: true, watch: true, listen: true, drill: true, speak: true, write: true },
};

/** About how long things take, for sizing the day: a new card's first answers take longer than a review. */
export const SECONDS_PER_NEW = 20;
export const DEFAULT_SECONDS_PER_REVIEW = 8;
const MINUTES: Record<'drill' | 'speak' | 'write', number> = { drill: 3, speak: 8, write: 8 };
/** Less time left than this, and nothing more is added. */
const ROOM_TO_TAKE_IN = 5;
const ROOM_TO_PRODUCE = 3;

export interface PlanItem {
  kind: PlanKind;
  title: string;
  detail: string;
  minutes: number;
  /** What it opens beyond its kind: a video's or an episode's text id, a drill's tool. */
  ref?: string;
  done?: boolean;
}

/** What's on offer today, for the planner to pick from; a kind without one isn't available. */
export interface PlanOffer {
  /** The language's deck: due reviews and new cards left today. */
  due: number;
  fresh: number;
  secondsPerReview?: number;
  read?: { title: string; minutes: number; coverage: number };
  watch?: { id: number; title: string; minutes: number; what: 'video' | 'podcast' };
  listen?: { words: number; minutes: number };
  /** A drill, with why: what was missed in it lately, or none. */
  drill?: { tool: string; title: string; missed: boolean };
  speak?: boolean;
  write?: boolean;
}

/** The day's plan as kept for the study day, so the list holds still once made. */
export interface SavedPlan {
  day: string;
  language: Language;
  minutes: number;
  items: PlanItem[];
}

export interface PlanState {
  saved?: SavedPlan;
  /** Each study day's outcome, for the week's dots: all done, or part. Kept for a fortnight. */
  days: Record<string, 'all' | 'part'>;
  /** When a lesson was last heard, a scene played, an entry written, by `${kind}|${language}`. */
  done: Record<string, number>;
}

export const EMPTY_PLAN_STATE: PlanState = { days: {}, done: {} };

/** The language to plan in: the chosen one when it has a deck, else the one with the most due, then new. */
export function pickLanguage(prefs: PlanPrefs, languages: readonly { language: Language; due: number; fresh: number }[]): Language | null {
  if (!languages.length) return null;
  if (prefs.language !== 'auto' && languages.some((l) => l.language === prefs.language)) return prefs.language;
  const order = (l: Language) => LANGUAGE_ORDER.indexOf(l);
  return [...languages].sort((a, b) => b.due - a.due || b.fresh - a.fresh || order(a.language) - order(b.language))[0].language;
}

/** Which of `choices` comes up on day `dayNumber`: each in turn, so none comes up every day. */
const rotate = <T>(choices: readonly T[], dayNumber: number): T | undefined => (choices.length ? choices[((dayNumber % choices.length) + choices.length) % choices.length] : undefined);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The day's items: reviews first, then new words in the time left, then one thing to take in and one
 * to produce if there's room. `dayNumber` is the study day counted from any fixed day, for the turns.
 */
export function planDay(prefs: PlanPrefs, offer: PlanOffer, dayNumber: number): PlanItem[] {
  const items: PlanItem[] = [];
  let left = prefs.minutes;
  if (offer.due > 0) {
    const minutes = Math.max(1, Math.ceil((offer.due * (offer.secondsPerReview ?? DEFAULT_SECONDS_PER_REVIEW)) / 60));
    items.push({ kind: 'reviews', title: 'Reviews', detail: plural(offer.due, 'card', 'cards'), minutes });
    left -= minutes;
    if (left <= 0) return items;
  }
  if (offer.fresh > 0) {
    const fits = Math.min(offer.fresh, Math.floor((left * 60) / SECONDS_PER_NEW));
    if (fits > 0) {
      const minutes = Math.max(1, Math.ceil((fits * SECONDS_PER_NEW) / 60));
      items.push({ kind: 'new', title: 'New words', detail: fits < offer.fresh ? `${fits} of ${offer.fresh} left today` : plural(fits, 'word', 'words'), minutes });
      left -= minutes;
    }
  }
  if (left >= ROOM_TO_TAKE_IN) {
    const open = TAKE_IN.filter((k) => prefs.kinds[k] && offer[k as 'read' | 'watch' | 'listen']);
    const pick = rotate(open, dayNumber);
    const item = pick === 'read' && offer.read
      ? { kind: 'read' as const, title: `Read: ${offer.read.title}`, detail: `A text you'd understand ${Math.round(offer.read.coverage * 100)}% of`, minutes: offer.read.minutes }
      : pick === 'watch' && offer.watch
        ? { kind: 'watch' as const, title: `${offer.watch.what === 'podcast' ? 'Listen' : 'Watch'}: ${offer.watch.title}`, detail: `A ${offer.watch.what} on your shelf`, minutes: offer.watch.minutes, ref: String(offer.watch.id) }
        : pick === 'listen' && offer.listen
          ? { kind: 'listen' as const, title: 'Listen: Your words', detail: `A lesson of ${plural(offer.listen.words, 'word', 'words')} from your deck`, minutes: offer.listen.minutes }
          : undefined;
    if (item) {
      items.push(item);
      left -= item.minutes;
    }
  }
  if (left >= ROOM_TO_PRODUCE) {
    const open = PRODUCE.filter((k) => prefs.kinds[k] && (k === 'drill' ? offer.drill : offer[k as 'speak' | 'write']));
    // A drill with misses comes first: it's what's been going wrong. Otherwise each in turn.
    const pick = offer.drill?.missed && open.includes('drill') ? 'drill' : rotate(open, dayNumber);
    if (pick === 'drill' && offer.drill) items.push({ kind: 'drill', title: `Practice: ${offer.drill.title}`, detail: offer.drill.missed ? 'You missed some lately' : 'A few questions', minutes: MINUTES.drill, ref: offer.drill.tool });
    else if (pick === 'speak') items.push({ kind: 'speak', title: 'Speak: a Situations scene', detail: 'A short conversation, then what to fix', minutes: MINUTES.speak });
    else if (pick === 'write') items.push({ kind: 'write', title: 'Write: a journal entry', detail: 'A few sentences, checked for you', minutes: MINUTES.write });
  }
  return items;
}

/** The day's plan with what's done marked, and how many minutes of it are done. */
export function withDone(items: readonly PlanItem[], done: (kind: PlanKind) => boolean): { items: PlanItem[]; doneMinutes: number } {
  const marked = items.map((item) => ({ ...item, done: done(item.kind) }));
  return { items: marked, doneMinutes: marked.reduce((sum, i) => sum + (i.done ? i.minutes : 0), 0) };
}

/** `state` with a lesson heard, a scene played or an entry written at `now`. */
export function recordPlanDone(state: PlanState, kind: 'listen' | 'speak' | 'write', language: Language, now: number): PlanState {
  return { ...state, done: { ...state.done, [`${kind}|${language}`]: now } };
}

const KEPT_DAYS = 14;

/** `state` with the day's outcome, keeping the latest fortnight. */
export function recordDay(state: PlanState, day: string, outcome: 'all' | 'part' | null): PlanState {
  const days = { ...state.days };
  if (outcome) days[day] = outcome; else delete days[day];
  const kept = Object.keys(days).sort().slice(-KEPT_DAYS);
  return { ...state, days: Object.fromEntries(kept.map((d) => [d, days[d]])) };
}

/** The day's outcome from its items: all done, part, or none. */
export function outcomeOf(items: readonly PlanItem[]): 'all' | 'part' | null {
  const n = items.filter((i) => i.done).length;
  return n === 0 ? null : n === items.length ? 'all' : 'part';
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const KINDS: readonly PlanKind[] = ['reviews', 'new', ...CHOICE_KINDS];

export function parsePlanPrefs(raw: string | null): PlanPrefs {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (isRecord(parsed)) saved = parsed;
  } catch {
    // Not JSON: the defaults.
  }
  const kinds = { ...DEFAULT_PLAN_PREFS.kinds };
  if (isRecord(saved.kinds)) for (const k of CHOICE_KINDS) if (typeof saved.kinds[k] === 'boolean') kinds[k] = saved.kinds[k] as boolean;
  return {
    on: typeof saved.on === 'boolean' ? saved.on : DEFAULT_PLAN_PREFS.on,
    minutes: PLAN_MINUTES.find((m) => m === saved.minutes) ?? DEFAULT_PLAN_PREFS.minutes,
    language: LANGUAGE_ORDER.find((l) => l === saved.language) ?? 'auto',
    kinds,
  };
}

export function parsePlanState(raw: string | null): PlanState {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (isRecord(parsed)) saved = parsed;
  } catch {
    // Not JSON: nothing kept.
  }
  const days: PlanState['days'] = {};
  if (isRecord(saved.days)) for (const [d, o] of Object.entries(saved.days)) if (o === 'all' || o === 'part') days[d] = o;
  const done: PlanState['done'] = {};
  if (isRecord(saved.done)) for (const [k, t] of Object.entries(saved.done)) if (typeof t === 'number') done[k] = t;
  const s = saved.saved;
  const items = isRecord(s) && Array.isArray(s.items)
    ? s.items.flatMap((i): PlanItem[] => (isRecord(i) && KINDS.includes(i.kind as PlanKind) && typeof i.title === 'string' && typeof i.detail === 'string' && typeof i.minutes === 'number'
      ? [{ kind: i.kind as PlanKind, title: i.title, detail: i.detail, minutes: i.minutes, ...(typeof i.ref === 'string' ? { ref: i.ref } : {}) }]
      : []))
    : [];
  const language = isRecord(s) ? LANGUAGE_ORDER.find((l) => l === s.language) : undefined;
  const plan = isRecord(s) && typeof s.day === 'string' && typeof s.minutes === 'number' && language ? { day: s.day, language, minutes: s.minutes, items } : undefined;
  return { days, done, ...(plan ? { saved: plan } : {}) };
}

/** The last seven study days' outcomes, oldest first, for the week's dots: each day's key and its first letter. */
export function weekDots(state: PlanState, today: string): { day: string; letter: string; outcome: 'all' | 'part' | null }[] {
  const [y, m, d] = today.split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(y, m - 1, d - 6 + i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { day: key, letter: 'SMTWTFS'[date.getDay()], outcome: state.days[key] ?? null };
  });
}

/** The study day as a number, for the day's turns: days since 1 January 2000. */
export function dayNumberOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2000, 0, 1)) / 86_400_000);
}
