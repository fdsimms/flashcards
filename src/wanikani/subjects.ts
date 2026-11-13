/**
 * WaniKani's subjects and assignments, read out of its API's JSON (revision 20170710). Field names
 * follow the API; the shapes were checked against @bachmacintosh/wanikani-api-types 1.8.0, since
 * the docs site wasn't reachable when this was written. Anything not in the expected shape is
 * dropped rather than guessed at.
 */

export type SubjectType = 'radical' | 'kanji' | 'vocabulary' | 'kana_vocabulary';

export interface Meaning {
  meaning: string;
  primary: boolean;
  /** False for a meaning WaniKani lists but won't take as an answer. */
  accepted: boolean;
}

export interface Reading {
  reading: string;
  primary: boolean;
  accepted: boolean;
  /** A kanji's reading type; absent for vocabulary. */
  type?: 'onyomi' | 'kunyomi' | 'nanori';
}

export interface ContextSentence {
  en: string;
  ja: string;
}

export interface PronunciationAudio {
  url: string;
  contentType: string;
  gender: string;
  voiceActorId: number;
}

export interface Subject {
  id: number;
  type: SubjectType;
  level: number;
  /** Null for a radical drawn only as an image. */
  characters: string | null;
  /** A radical's picture, when it has no characters: an SVG unless WaniKani still sends a PNG. */
  image?: { url: string; svg: boolean };
  meanings: Meaning[];
  /** WaniKani's extra answers: whitelisted ones count as right, blacklisted ones as wrong. */
  auxiliaryMeanings: { meaning: string; type: 'whitelist' | 'blacklist' }[];
  readings: Reading[];
  meaningMnemonic: string;
  readingMnemonic?: string;
  meaningHint?: string;
  readingHint?: string;
  contextSentences: ContextSentence[];
  audio: PronunciationAudio[];
  partsOfSpeech: string[];
  /** Radicals and kanji that make this up, for a card's "Made of" row (`madeOf`). */
  componentIds: number[];
  srsId: number;
  /** Where it comes in its level's lessons. */
  lessonPosition: number;
  hidden: boolean;
  url: string;
}

export interface Assignment {
  id: number;
  subjectId: number;
  subjectType: SubjectType;
  /** 0 is a lesson not yet done; 1-4 Apprentice, 5-6 Guru, 7 Master, 8 Enlightened, 9 Burned. */
  srsStage: number;
  availableAt: string | null;
  startedAt: string | null;
  unlockedAt: string | null;
  /** When it first reached Guru. */
  passedAt: string | null;
  hidden: boolean;
}

const SUBJECT_TYPES: readonly string[] = ['radical', 'kanji', 'vocabulary', 'kana_vocabulary'];

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function parseSubject(resource: unknown): Subject | null {
  const r = obj(resource);
  const d = obj(r?.data);
  const id = num(r?.id);
  const type = str(r?.object);
  if (!r || !d || id === null || !type || !SUBJECT_TYPES.includes(type)) return null;
  const meanings = arr(d.meanings).flatMap((m): Meaning[] => {
    const o = obj(m);
    const meaning = str(o?.meaning);
    return o && meaning ? [{ meaning, primary: o.primary === true, accepted: o.accepted_answer !== false }] : [];
  });
  if (!meanings.length) return null;
  const readings = arr(d.readings).flatMap((x): Reading[] => {
    const o = obj(x);
    const reading = str(o?.reading);
    if (!o || !reading) return [];
    const t = str(o.type);
    return [{
      reading, primary: o.primary === true, accepted: o.accepted_answer !== false,
      ...(t === 'onyomi' || t === 'kunyomi' || t === 'nanori' ? { type: t } : {}),
    }];
  });
  const images = arr(d.character_images).flatMap((x) => {
    const o = obj(x);
    const url = str(o?.url);
    const ct = str(o?.content_type);
    return url && ct ? [{ url, contentType: ct }] : [];
  });
  // A PNG draws in an Image; an SVG needs a WebView. Prefer the PNG when there is one.
  const png = images.find((i) => i.contentType === 'image/png');
  const svg = images.find((i) => i.contentType === 'image/svg+xml');
  const image = png ? { url: png.url, svg: false } : svg ? { url: svg.url, svg: true } : undefined;
  return {
    id,
    type: type as SubjectType,
    level: num(d.level) ?? 0,
    characters: str(d.characters),
    ...(image && !str(d.characters) ? { image } : {}),
    meanings,
    auxiliaryMeanings: arr(d.auxiliary_meanings).flatMap((x) => {
      const o = obj(x);
      const meaning = str(o?.meaning);
      const t = str(o?.type);
      return meaning && (t === 'whitelist' || t === 'blacklist') ? [{ meaning, type: t }] : [];
    }),
    readings,
    meaningMnemonic: str(d.meaning_mnemonic) ?? '',
    ...(str(d.reading_mnemonic) ? { readingMnemonic: str(d.reading_mnemonic)! } : {}),
    ...(str(d.meaning_hint) ? { meaningHint: str(d.meaning_hint)! } : {}),
    ...(str(d.reading_hint) ? { readingHint: str(d.reading_hint)! } : {}),
    contextSentences: arr(d.context_sentences).flatMap((x) => {
      const o = obj(x);
      const en = str(o?.en);
      const ja = str(o?.ja);
      return en && ja ? [{ en, ja }] : [];
    }),
    audio: arr(d.pronunciation_audios).flatMap((x): PronunciationAudio[] => {
      const o = obj(x);
      const meta = obj(o?.metadata);
      const url = str(o?.url);
      const contentType = str(o?.content_type);
      return url && contentType ? [{ url, contentType, gender: str(meta?.gender) ?? '', voiceActorId: num(meta?.voice_actor_id) ?? 0 }] : [];
    }),
    partsOfSpeech: arr(d.parts_of_speech).flatMap((x) => (str(x) ? [str(x)!] : [])),
    componentIds: arr(d.component_subject_ids).flatMap((x) => (num(x) !== null ? [num(x)!] : [])),
    srsId: num(d.spaced_repetition_system_id) ?? 1,
    lessonPosition: num(d.lesson_position) ?? 0,
    hidden: !!str(d.hidden_at),
    url: str(d.document_url) ?? '',
  };
}

export function parseAssignment(resource: unknown): Assignment | null {
  const r = obj(resource);
  const d = obj(r?.data);
  const id = num(r?.id);
  const subjectId = num(d?.subject_id);
  const subjectType = str(d?.subject_type);
  const srsStage = num(d?.srs_stage);
  if (!d || id === null || subjectId === null || srsStage === null || !subjectType || !SUBJECT_TYPES.includes(subjectType)) return null;
  return {
    id, subjectId, subjectType: subjectType as SubjectType, srsStage,
    availableAt: str(d.available_at), startedAt: str(d.started_at), unlockedAt: str(d.unlocked_at),
    passedAt: str(d.passed_at), hidden: d.hidden === true,
  };
}

/** Whether WaniKani asks this subject's reading: kanji and vocabulary do; radicals and kana-only words don't. */
export function asksReading(s: Pick<Subject, 'type'>): boolean {
  return s.type === 'kanji' || s.type === 'vocabulary';
}

export function primaryMeaning(s: Subject): string {
  return (s.meanings.find((m) => m.primary) ?? s.meanings[0]).meaning;
}

/** The meanings to show after the primary one: the other accepted ones (not the auxiliary ones, which WaniKani doesn't show either). */
export function otherMeanings(s: Subject): string[] {
  const primary = primaryMeaning(s);
  return s.meanings.filter((m) => m.accepted && m.meaning !== primary).map((m) => m.meaning);
}

export function primaryReading(s: Subject): string | undefined {
  return (s.readings.find((r) => r.primary) ?? s.readings[0])?.reading;
}

/** A kanji's readings by type, primary type first, for the answer side. Vocabulary gets one group with no type. */
export function readingGroups(s: Subject): { type?: Reading['type']; readings: string[]; primary: boolean }[] {
  if (s.type !== 'kanji') return s.readings.length ? [{ readings: s.readings.filter((r) => r.accepted).map((r) => r.reading), primary: true }] : [];
  const order: Reading['type'][] = ['onyomi', 'kunyomi', 'nanori'];
  const primaryType = s.readings.find((r) => r.primary)?.type;
  return order
    .map((type) => ({ type, readings: s.readings.filter((r) => r.type === type).map((r) => r.reading), primary: type === primaryType }))
    .filter((g) => g.readings.length)
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

/**
 * The radicals and kanji the given subjects are made of that aren't among them already: each once,
 * in the order they come, so they're read in one batch with the API's ids filter.
 */
export function missingComponentIds(subjects: readonly Subject[]): number[] {
  const have = new Set(subjects.map((s) => s.id));
  const out = new Set<number>();
  for (const s of subjects) for (const id of s.componentIds) if (!have.has(id)) out.add(id);
  return [...out];
}

/**
 * The subjects, followed by the parts they're made of (`missingComponentIds`), read with `read`,
 * which batches by id. The parts only fill a card's "Made of" row, so when they can't be read the
 * subjects come back on their own rather than failing the session or the offline copy.
 */
export async function withComponents(subjects: Subject[], read: (ids: number[]) => Promise<Subject[]>): Promise<Subject[]> {
  const ids = missingComponentIds(subjects);
  if (!ids.length) return subjects;
  const parts = await read(ids).catch((): Subject[] => []);
  return [...subjects, ...parts];
}

/** One part in a card's "Made of" row: its characters, or a radical's picture when it has none, and its meaning. */
export interface Part {
  id: number;
  type: SubjectType;
  characters: string | null;
  image?: Subject['image'];
  meaning: string;
}

/**
 * What a kanji or a word is made of, in WaniKani's order: a kanji's radicals, a word's kanji.
 * A part that wasn't read (the read failed, or an offline copy made before parts were kept) is
 * left out; a radical has none.
 */
export function madeOf(s: Subject, subjects: ReadonlyMap<number, Subject>): Part[] {
  return s.componentIds.flatMap((id): Part[] => {
    const p = subjects.get(id);
    if (!p) return [];
    return [{ id, type: p.type, characters: p.characters, ...(p.image ? { image: p.image } : {}), meaning: primaryMeaning(p) }];
  });
}

export const SUBJECT_TYPE_NAMES: Record<SubjectType, string> = {
  radical: 'Radical', kanji: 'Kanji', vocabulary: 'Vocabulary', kana_vocabulary: 'Vocabulary',
};

export const READING_TYPE_NAMES: Record<NonNullable<Reading['type']>, string> = {
  onyomi: "On'yomi", kunyomi: "Kun'yomi", nanori: 'Nanori',
};

/** A piece of a mnemonic: plain text, or a word WaniKani marks up (`<radical>`, `<kanji>`, `<reading>`...). */
export interface MnemonicPart {
  text: string;
  mark?: 'radical' | 'kanji' | 'vocabulary' | 'reading' | 'meaning' | 'ja';
}

const MARKUP = /<(radical|kanji|vocabulary|reading|meaning|ja)>(.+?)<\/\1>/gu;

/** A mnemonic split into its marked-up words and the text between them. Other tags are dropped. */
export function mnemonicParts(markup: string): MnemonicPart[] {
  const parts: MnemonicPart[] = [];
  const plain = (s: string) => {
    const text = s.replace(/<[^>]+>/g, '');
    if (text) parts.push({ text });
  };
  let at = 0;
  for (const m of markup.matchAll(MARKUP)) {
    plain(markup.slice(at, m.index));
    parts.push({ text: m[2].replace(/<[^>]+>/g, ''), mark: m[1] as MnemonicPart['mark'] });
    at = (m.index ?? 0) + m[0].length;
  }
  plain(markup.slice(at));
  return parts;
}
