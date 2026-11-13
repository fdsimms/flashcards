import { speechLangFor, isOmnilanguage } from './cards';
import { studyDayKey, studyDayStart } from './day';
import { inheritedSetting, isInDeck } from './deckTree';
import { grammarPointForForms, type GrammarPointInfo } from './grammar';
import { htmlToText } from './html';
import { foldUndecomposed, foldYo } from './letters';
import type { Card, DeckSettings, Note, ReviewLogEntry } from './types';

/**
 * Forms practice: the forms a word's note lists (a verb's conjugations, a noun's plural, its
 * gender, a Thai counting word), turned into short drills. Practice is never scheduled: it writes
 * nothing to FSRS or to Anki, only its own results (`PracticeRecord`), which decide what to ask
 * next and when to suggest practicing again.
 *
 * Where a note's forms come from:
 * - its `Forms` field, one form per line, `group · label: form` ("present · yo: espero"), or
 *   `label: form` with no group. Alternatives go after a slash ("tú: esperas / vos: esperás" is
 *   two lines; "esperase / esperara" is one form written two ways).
 * - Omnilanguage's own fields that hold one form each: Gender, Plural, Genitive, Classifier and
 *   AspectPartner.
 * A line that can't be read is kept in `unreadable`, so the drill can say so rather than drop it.
 */

/** One form a note lists. */
export interface WordForm {
  /** What practice history is kept by: `<group> · <label>`, or `field:<Field>` for a field. */
  key: string;
  /** What the form belongs to: a tense ("present"), or for a field its own label ("plural"). */
  group: string;
  /** Which form: a person ("yo"), or for a field its label ("plural"). */
  label: string;
  /** Accepted answers. The first is the one shown when the answer is revealed. */
  answers: string[];
}

export interface NoteForms {
  forms: WordForm[];
  /** Lines of the Forms field (or a Gender value) that couldn't be read, as written. */
  unreadable: string[];
}

type Gender = 'm' | 'f' | 'n';

/**
 * Gender words by language: the article where the language has one, as learners say it. More than
 * one is accepted where the language allows either: a Bokmål feminine noun takes "ei" or "en".
 */
const ARTICLES: Record<string, Partial<Record<Gender, string[]>>> = {
  de: { m: ['der'], f: ['die'], n: ['das'] },
  es: { m: ['el'], f: ['la'] },
  fr: { m: ['le'], f: ['la'] },
  it: { m: ['il'], f: ['la'] },
  pt: { m: ['o'], f: ['a'] },
  pl: { m: ['ten'], f: ['ta'], n: ['to'] },
  el: { m: ['ο'], f: ['η'], n: ['το'] },
  nb: { m: ['en'], f: ['ei', 'en'], n: ['et'] },
};
const GENDER_WORDS = { m: 'masculine', f: 'feminine', n: 'neuter' } as const;

/**
 * The articles an Entry may start with, by language, and which definite articles each goes with:
 * itself, or for an indefinite one those it pairs with ("un" goes with el in Spanish, so "un agua"
 * takes el too). An Entry whose article goes with none of its gender's in ARTICLES (el agua, lo zio,
 * l'acqua) has its gender asked as a word, since the article the table gives would be wrong for it.
 */
const ENTRY_ARTICLES: Record<string, Record<string, string[]>> = {
  de: { der: ['der'], die: ['die'], das: ['das'], ein: ['der', 'das'], eine: ['die'] },
  es: { el: ['el'], la: ['la'], un: ['el'], una: ['la'] },
  fr: { le: ['le'], la: ['la'], "l'": ["l'"], un: ['le', "l'"], une: ['la', "l'"] },
  it: { il: ['il'], lo: ['lo'], la: ['la'], "l'": ["l'"], un: ['il', "l'"], uno: ['lo'], una: ['la'], "un'": ["l'"] },
  pt: { o: ['o'], a: ['a'], um: ['o'], uma: ['a'] },
  pl: { ten: ['ten'], ta: ['ta'], to: ['to'] },
  el: { ο: ['ο'], η: ['η'], το: ['το'], ένας: ['ο'], μία: ['η'], μια: ['η'], ένα: ['το'] },
  nb: { en: ['en'], ei: ['ei'], et: ['et'] },
};

/**
 * Words whose article isn't the one ARTICLES gives, whatever the Entry shows: French and Italian
 * take l' before a vowel, and an Italian masculine noun takes lo before s and a consonant, z, gn,
 * ps, pn, x or y. French h is left out, as it goes either way (l'homme, le héros).
 */
function takesOtherArticle(lang: string, g: Gender, word: string): boolean {
  const w = word.toLocaleLowerCase();
  if ((lang === 'fr' || lang === 'it') && /^[aeiouàâäéèêëìíîïòóôöùúûüœæ]/u.test(w)) return true;
  return lang === 'it' && g === 'm' && /^(s[^aeiouàèéìíòóùú]|z|gn|ps|pn|x|y)/u.test(w);
}

/** The Entry's own article in its language, and the word after it: "el agua" -> el, agua. */
function entryArticle(note: Note, lang: string): { article: string; goesWith: string[]; rest: string } | undefined {
  const table = ENTRY_ARTICLES[lang];
  const m = table && /^([^\s'’]+['’]|[^\s'’]+\s+)(?=\S)/u.exec(headword(note));
  if (!m) return undefined;
  const article = m[1].trim().replace('’', "'").toLocaleLowerCase();
  const goesWith = table[article];
  return goesWith ? { article, goesWith, rest: headword(note).slice(m[1].length).trim() } : undefined;
}

/**
 * What a note's gender is asked as: the language's article for it, the Entry's own first where it
 * has one of them ("en bok" asks en, accepting ei), or the gender as a word ("feminine") where the
 * language has no article table or the article it gives isn't this word's (el agua, l'acqua).
 */
function genderAnswers(note: Note, g: Gender): string[] {
  const lang = langOf(note) ?? '';
  const accepted = ARTICLES[lang]?.[g];
  if (!accepted) return [GENDER_WORDS[g]];
  const own = entryArticle(note, lang);
  if (takesOtherArticle(lang, g, own?.rest ?? withoutArticle(headword(note)))) return [GENDER_WORDS[g]];
  if (!own) return accepted;
  const fits = accepted.filter((a) => own.goesWith.includes(a));
  return fits.length ? [...fits, ...accepted.filter((a) => !fits.includes(a))] : [GENDER_WORDS[g]];
}

const isGenderWord = (answer: string) => (Object.values(GENDER_WORDS) as string[]).includes(answer);

/** The word a gender prompt shows: without its article, which is what's asked or would mislead ("el agua", feminine). */
export function genderHeadword(note: Note): string {
  return entryArticle(note, langOf(note) ?? '')?.rest ?? withoutArticle(headword(note));
}

/**
 * Every article a headword or a listed form might start with, longest first, for taking it off the
 * word. Each ends in a space or an apostrophe, so only a whole article is taken: "une table", not
 * the "un" of "unité". German's indefinite articles are only the nominative ones a headword starts with.
 */
const LEADING_ARTICLES = [
  'los ', 'las ', 'una ', 'der ', 'die ', 'das ', 'des ', 'ein ', 'eine ', 'les ', 'une ', 'ten ', 'tej ', 'el ', 'la ', 'un ',
  'le ', "l'", 'l’', 'il ', 'lo ', 'ta ', 'to ', 'en ', 'ei ', 'et ', 'το ', 'ο ', 'η ', 'οι ', 'τα ', 'του ', 'της ', 'των ',
  'o ', 'a ',
].sort((a, b) => b.length - a.length);

const langOf = (note: Note) => speechLangFor(note)?.split('-')[0];

/** The word without a leading article: "el blindaje" -> "blindaje", "der Tisch" -> "Tisch". */
export function withoutArticle(word: string): string {
  const lower = word.toLocaleLowerCase();
  for (const a of LEADING_ARTICLES) {
    // Only when something follows, so the article "la" on its own stays "la".
    if (lower.startsWith(a) && word.length > a.length) return word.slice(a.length).trim();
  }
  return word;
}

/** The word a drill is about, as plain text: the note's Entry, else its first field. */
export function headword(note: Note): string {
  const raw = isOmnilanguage(note) ? note.fields.Entry : Object.values(note.fields)[0];
  return htmlToText(raw ?? '').replace(/\s+/g, ' ').trim();
}

function lines(field: string | undefined): string[] {
  return htmlToText(field ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
}

function answersOf(text: string): string[] {
  return text.split('/').map((a) => a.trim()).filter(Boolean);
}

/** A form as written plus, when it starts with an article, the form without it. */
function withBare(answers: string[]): string[] {
  const out = [...answers];
  for (const a of answers) {
    const bare = withoutArticle(a);
    if (bare !== a && !out.includes(bare)) out.push(bare);
  }
  return out;
}

const FIELD_FORMS: { field: string; label: string }[] = [
  { field: 'Plural', label: 'plural' },
  { field: 'Genitive', label: 'genitive' },
  { field: 'Classifier', label: 'counting word' },
  { field: 'AspectPartner', label: 'aspect pair' },
];

/** The forms a note lists. Empty for a note with none: no suggestion, no drill. */
export function formsOf(note: Note): NoteForms {
  const forms: WordForm[] = [];
  const unreadable: string[] = [];
  const seen = new Set<string>();
  const add = (f: WordForm) => {
    if (seen.has(f.key) || !f.answers.length) return;
    seen.add(f.key);
    forms.push(f);
  };

  for (const line of lines(note.fields.Forms)) {
    const colon = line.indexOf(':');
    const left = colon > 0 ? line.slice(0, colon).trim() : '';
    const answers = colon > 0 ? answersOf(line.slice(colon + 1)) : [];
    if (!left || !answers.length) { unreadable.push(line); continue; }
    const dot = left.indexOf('·');
    const group = dot >= 0 ? left.slice(0, dot).trim() : '';
    const label = dot >= 0 ? left.slice(dot + 1).trim() : left;
    if (!label) { unreadable.push(line); continue; }
    add({ key: group ? `${group} · ${label}` : label, group, label, answers });
  }

  if (!isOmnilanguage(note)) return { forms, unreadable };

  const gender = htmlToText(note.fields.Gender ?? '').trim();
  if (gender) {
    const g = genderLetter(gender);
    if (!g) unreadable.push(`Gender: ${gender}`);
    else add({ key: 'field:Gender', group: 'gender', label: 'gender', answers: genderAnswers(note, g) });
  }
  for (const { field, label } of FIELD_FORMS) {
    const text = htmlToText(note.fields[field] ?? '').replace(/\s+/g, ' ').trim();
    if (text) add({ key: `field:${field}`, group: label, label, answers: withBare(answersOf(text)) });
  }
  return { forms, unreadable };
}

/** "m", "masc", "masculine", "der" and the like, as m / f / n. Undefined when it isn't one. */
function genderLetter(text: string): Gender | undefined {
  const t = text.toLocaleLowerCase().replace(/[.\s]/g, '');
  if (['m', 'masc', 'masculine', 'männlich', 'der', 'el', 'le', 'il', 'ten', 'ο', 'en'].includes(t)) return 'm';
  if (['f', 'fem', 'feminine', 'weiblich', 'die', 'la', 'ta', 'η', 'ei'].includes(t)) return 'f';
  if (['n', 'neut', 'neuter', 'sächlich', 'das', 'to', 'το', 'et'].includes(t)) return 'n';
  return undefined;
}

/**
 * The gender choices offered for a note: its language's articles when that's what's asked, else
 * the genders as words, only those the language has (no neuter in Spanish).
 */
function genderChoices(note: Note, form: WordForm): string[] {
  const table = ARTICLES[langOf(note) ?? ''];
  if (table && !isGenderWord(form.answers[0])) return [...new Set(Object.values(table).flat())];
  return (Object.keys(GENDER_WORDS) as Gender[]).filter((g) => !table || table[g]).map((g) => GENDER_WORDS[g]);
}

// ---------------------------------------------------------------------------------------------
// Checking an answer

export type Verdict = 'right' | 'almost' | 'wrong';

/**
 * Ё is folded into е here, as Russian usually writes it, so "елка" for "ёлка" is right. So are what
 * a keyboard decides rather than the speller, as the Practice tools' check folds them (tools/answer.ts):
 * σ for a final ς, ss for ß, and a curly apostrophe for a straight one ("j’espère").
 */
const clean = (s: string) =>
  foldYo(s.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/[.!?¡¿]+$/u, '').toLocaleLowerCase())
    .replace(/ς/g, 'σ').replace(/ß/g, 'ss').replace(/[’‘ʼ]/g, "'");
/** Without accents and other marks: "esperé" -> "espere", "øl" -> "ol", "łza" -> "lza". */
const unmarked = (s: string) => foldUndecomposed(s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC'));

/**
 * A typed answer against a form's accepted answers. Case and surrounding spaces don't matter.
 * Right but for an accent is "almost": it's often a different form (espere, esperé), so it isn't
 * counted on its own, and the drill offers to count it. When it's exactly one of the word's other
 * forms (`others`: pisze for piszę, hablo for habló), it's wrong: the mark is the ending being drilled.
 */
export function checkAnswer(typed: string, answers: string[], others: string[] = []): Verdict {
  const t = clean(typed);
  if (!t) return 'wrong';
  const all = answers.map(clean);
  if (all.includes(t)) return 'right';
  if (others.some((o) => clean(o) === t)) return 'wrong';
  return all.some((a) => unmarked(a) === unmarked(t)) ? 'almost' : 'wrong';
}

/** A form as a drill names it: "present · yo", or only its label when it has no group of its own ("plural", "infinitive"). */
export const formName = (f: Pick<WordForm, 'group' | 'label'>): string => (f.group && f.group !== f.label ? `${f.group} · ${f.label}` : f.label);

/**
 * The word's other forms a wrong answer could be (never its gender, which no other form is): the
 * asked form's person first, then its tense, so espere asked as "preterite · yo" is taken for
 * "present subjunctive · yo" rather than "present subjunctive · él", which is spelled the same.
 */
function rivalForms(asked: WordForm, forms: WordForm[]): WordForm[] {
  if (asked.key === 'field:Gender') return [];
  const rank = (f: WordForm) => (f.label === asked.label ? 0 : f.group === asked.group ? 1 : 2);
  return forms.filter((f) => f.key !== asked.key && f.key !== 'field:Gender').sort((a, b) => rank(a) - rank(b));
}

/** Which of the word's other forms a wrong answer is, if it's one (`rivalForms`). */
function givenForm(given: string, asked: WordForm, forms: WordForm[]): WordForm | undefined {
  const t = clean(given);
  if (!t || asked.answers.some((a) => clean(a) === t)) return undefined;
  return rivalForms(asked, forms).find((f) => f.answers.some((a) => clean(a) === t));
}

/** The word's other form a wrong answer is, if it's one: "present · on" for pisze asked as piszę. */
export function formGiven(given: string, prompt: Pick<FormPrompt, 'answers' | 'otherForms'>): string | undefined {
  const t = clean(given);
  if (!t || prompt.answers.some((a) => clean(a) === t)) return undefined;
  return prompt.otherForms?.find((o) => clean(o.text) === t)?.name;
}

// ---------------------------------------------------------------------------------------------
// Practice history

/** One answered prompt. Kept in Franki only: Anki never sees practice. */
export interface PracticeRecord {
  noteId: string;
  /** `WordForm.key`. */
  key: string;
  /** Right, or "almost" counted as right. */
  correct: boolean;
  /** ISO. */
  practicedAt: string;
  /** What was typed or picked. Absent on practice logged before it was kept. */
  given?: string;
}

/** Keys missed in a note's latest practice (its latest study day with any), most recent first. */
function missedLastTime(history: PracticeRecord[], dayStartsAtHour: number): string[] {
  if (!history.length) return [];
  const latest = history.reduce((a, b) => (a.practicedAt > b.practicedAt ? a : b));
  const day = studyDayKey(new Date(latest.practicedAt), dayStartsAtHour);
  const that = history.filter((r) => studyDayKey(new Date(r.practicedAt), dayStartsAtHour) === day);
  // A form missed and then got right later that day isn't missed any more.
  const last = new Map<string, PracticeRecord>();
  for (const r of [...that].sort((a, b) => a.practicedAt.localeCompare(b.practicedAt))) last.set(r.key, r);
  return [...last.values()].filter((r) => !r.correct).sort((a, b) => b.practicedAt.localeCompare(a.practicedAt)).map((r) => r.key);
}

/** Right answers in a row that put a missed form right again. A pick is one in three by luck, so one isn't enough. */
export const FORM_CLEARED_AFTER = 2;
/** The most a form can owe, so a run of misses doesn't take forever to clear. */
const MAX_OWED = 6;

/**
 * Forms still owed a run of right answers, with how many: each miss adds FORM_CLEARED_AFTER, each
 * right answer takes one off. A miss stays until it's put right, however long ago it was. A right
 * answer straight after a miss on the same study day (`dayStartsAtHour`) takes nothing off: it's
 * the retry at the end of the drill, with the answer just seen, and counting it would clear a
 * form after one more right answer, the luck FORM_CLEARED_AFTER is there to rule out. It's still
 * logged; only the next right answer counts.
 */
export function weakForms(history: PracticeRecord[], dayStartsAtHour: number): Map<string, number> {
  const owed = new Map<string, number>();
  const previous = new Map<string, PracticeRecord>();
  for (const r of [...history].sort((a, b) => a.practicedAt.localeCompare(b.practicedAt))) {
    const now = owed.get(r.key) ?? 0;
    const before = previous.get(r.key);
    const retry = r.correct && !!before && !before.correct
      && studyDayStart(new Date(before.practicedAt), dayStartsAtHour).getTime() === studyDayStart(new Date(r.practicedAt), dayStartsAtHour).getTime();
    owed.set(r.key, retry ? now : r.correct ? Math.max(0, now - 1) : Math.min(MAX_OWED, now + FORM_CLEARED_AFTER));
    previous.set(r.key, r);
  }
  for (const [k, n] of owed) if (!n) owed.delete(k);
  return owed;
}

/** Misses of the same wrong answer for the same form before it's called a confusion, and how many words it takes. */
export const CONFUSION_MISSES = 3;
export const CONFUSION_WORDS = 2;

export interface Confusion {
  /**
   * "answer": the same wrong answer for the same right one ("ten" for "ta"). "form": another form
   * of each word for the one asked, whatever the words (the present subjunctive for the preterite).
   */
  kind: 'answer' | 'form';
  /** What the form's answer is ("ta"), or for "form" the form asked ("preterite · yo"). */
  expected: string;
  /** What was answered instead ("ten"), or for "form" the form it was ("present subjunctive · yo"). */
  given: string;
  misses: number;
  /** How many different words it happened on. */
  words: number;
  /** ISO: the latest miss. */
  lastAt: string;
}

/**
 * Gaps in a pattern rather than in one word, each seen CONFUSION_MISSES times across CONFUSION_WORDS
 * or more words: the same wrong answer given for the same right one ("ten" for "ta"), or another of
 * each word's forms given for the one asked (the present subjunctive for the preterite, whose
 * answers differ from verb to verb), worked out from the words' forms as they are now. Only
 * practice that kept what was answered can show one.
 */
export function confusions(history: PracticeRecord[], words: PracticeWord[]): Confusion[] {
  const formsOfNote = new Map(words.map((w) => [w.note.id, w.forms]));
  const found = new Map<string, Confusion & { notes: Set<string> }>();
  const tally = (r: PracticeRecord, kind: Confusion['kind'], expected: string, given: string, id: string) => {
    const key = `${kind}\u0000${id}`;
    const c = found.get(key) ?? { kind, expected, given, misses: 0, words: 0, lastAt: r.practicedAt, notes: new Set<string>() };
    c.misses++;
    c.notes.add(r.noteId);
    if (r.practicedAt > c.lastAt) c.lastAt = r.practicedAt;
    found.set(key, c);
  };
  for (const r of history) {
    const forms = formsOfNote.get(r.noteId);
    const asked = forms?.find((f) => f.key === r.key);
    if (r.correct || !r.given || !forms || !asked || asked.answers.some((a) => clean(a) === clean(r.given!))) continue;
    const expected = asked.answers[0];
    tally(r, 'answer', expected, r.given, `${clean(expected)}\u0000${clean(r.given)}`);
    const other = givenForm(r.given, asked, forms);
    if (other) tally(r, 'form', formName(asked), formName(other), `${formName(asked)}\u0000${formName(other)}`);
  }
  return [...found.values()]
    .map(({ notes, ...c }) => ({ ...c, words: notes.size }))
    .filter((c) => c.misses >= CONFUSION_MISSES && c.words >= CONFUSION_WORDS)
    .sort((a, b) => b.misses - a.misses || b.lastAt.localeCompare(a.lastAt));
}

/** Marks a form's name in `confusedAnswers`, so it can't be taken for an answer. */
const CONFUSED_FORM = 'form\u0000';

/**
 * What practice keeps getting mixed up, for ranking forms: the right answers (cleaned) of "answer"
 * confusions, and the names of the forms asked in "form" ones.
 */
export const confusedAnswers = (list: Confusion[]): Set<string> =>
  new Set(list.map((c) => (c.kind === 'form' ? CONFUSED_FORM + c.expected : clean(c.expected))));

/** Ask order: still owed a run of right answers, then a form often confused, then never asked, then asked. */
function askRank(f: WordForm, weak: Map<string, number>, asked: boolean, confused: Set<string>, practiced: boolean): number {
  if (weak.has(f.key)) return 0;
  if (confused.has(clean(f.answers[0])) || confused.has(CONFUSED_FORM + formName(f))) return 1;
  if (practiced) return 2;
  return asked ? 4 : 3;
}

/** The grammar point a note's form is (its Forms group's, in the note's language), if any. */
export function formGrammar(note: Note, form: WordForm): GrammarPointInfo | undefined {
  const lang = langOf(note);
  return lang && form.group && !form.key.startsWith('field:') ? grammarPointForForms(lang, form.group) : undefined;
}

/** Whether a form is of a grammar point practiced in Read & Listen (`practicing`, by point id). */
function isPracticed(note: Note, form: WordForm, practicing: Set<string>): boolean {
  const point = practicing.size ? formGrammar(note, form) : undefined;
  return !!point && practicing.has(point.id);
}

function shuffle<T>(xs: T[], random: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Which of a note's forms to ask, `count` at most: those still owed right answers (`weakForms`, the
 * most owed first), then those whose answer is often confused, then those of grammar practiced in
 * Read & Listen (`practiced`), then those never asked, then the ones asked longest ago. Ties are
 * shuffled.
 */
export function chooseForms(
  forms: WordForm[],
  history: PracticeRecord[],
  dayStartsAtHour: number,
  count: number,
  random: () => number = Math.random,
  confused: Set<string> = new Set(),
  practiced: (f: WordForm) => boolean = () => false,
): WordForm[] {
  const weak = weakForms(history, dayStartsAtHour);
  const lastAsked = new Map<string, string>();
  for (const r of history) if ((lastAsked.get(r.key) ?? '') < r.practicedAt) lastAsked.set(r.key, r.practicedAt);
  const rank = (f: WordForm) => askRank(f, weak, lastAsked.has(f.key), confused, practiced(f));
  return shuffle(forms, random)
    .sort((a, b) => rank(a) - rank(b) || (weak.get(b.key) ?? 0) - (weak.get(a.key) ?? 0) || (lastAsked.get(a.key) ?? '').localeCompare(lastAsked.get(b.key) ?? ''))
    .slice(0, count);
}

// ---------------------------------------------------------------------------------------------
// Prompts

export interface FormPrompt {
  noteId: string;
  key: string;
  /** The word, without its article when the prompt is its gender. */
  headword: string;
  meaning: string;
  /** Asked in large type ("nosotros", "plural"). */
  label: string;
  /** Shown beside it ("present"); empty when it's the same as the label. */
  group: string;
  answers: string[];
  /** For picking: the answer and up to three others, shuffled. Undefined: nothing to pick from, so it's typed. */
  choices?: string[];
  /** The note's example sentence with the answer blanked out, when it holds the answer. */
  sentence?: { before: string; after: string; translation?: string };
  /** The grammar point the form is (docs/grammar.md), shown once the answer is. */
  grammar?: { id: string; name: string; note: string };
  /** The word's other forms that are spelled differently, with their names ("present · on"), to say which one a wrong answer was. */
  otherForms?: { text: string; name: string }[];
  /** Every form key it stands for, when it's several asked as one (`mergeSentencePrompts`); else only `key`. */
  keys?: string[];
  /**
   * The right answer read aloud after a miss, with the phone's voice for the note's language. Absent
   * when the language isn't known, or for a gender asked as a word ("feminine"), which isn't in it.
   */
  say?: { text: string; lang: string };
}

/** The form keys a prompt's answer is logged under: one for each form it stands for. */
export const promptKeys = (p: Pick<FormPrompt, 'key' | 'keys'>): string[] => p.keys ?? [p.key];

const isLetter = (ch: string | undefined) => !!ch && /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/.test(ch);

/**
 * The note's Context sentence split around a whole-word occurrence of one of the answers, so the
 * drill can ask for it in a sentence. Scripts without word spaces (Thai) match anywhere.
 */
export function sentenceGap(note: Note, answers: string[]): FormPrompt['sentence'] {
  const text = htmlToText(note.fields.Context ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  const lower = text.toLocaleLowerCase();
  for (const a of answers) {
    const needle = a.toLocaleLowerCase();
    if (!needle || needle.length !== a.length) continue;
    for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, i + 1)) {
      if (isLetter(text[i - 1]) || isLetter(text[i + needle.length])) continue;
      const translation = htmlToText(note.fields.ContextTranslation ?? '').replace(/\s+/g, ' ').trim();
      return { before: text.slice(0, i), after: text.slice(i + needle.length), ...(translation ? { translation } : {}) };
    }
  }
  return undefined;
}

/**
 * A prompt for one form. Wrong choices come from the word's own other forms first (so picking
 * means reading the ending), then the same form of other words in `pool` (same language).
 */
export function promptFor(
  note: Note,
  form: WordForm,
  others: { note: Note; forms: WordForm[] }[],
  random: () => number = Math.random,
): FormPrompt {
  const own = formsOf(note).forms;
  const right = new Set(form.answers.map(clean));
  const wrong: string[] = [];
  const offer = (a: string | undefined) => {
    if (a && !right.has(clean(a)) && !wrong.some((w) => clean(w) === clean(a))) wrong.push(a);
  };
  if (form.key === 'field:Gender') {
    for (const g of genderChoices(note, form)) offer(g);
  } else {
    const sameGroup = own.filter((f) => f.key !== form.key && f.group === form.group && !f.key.startsWith('field:'));
    const sameLabel = own.filter((f) => f.key !== form.key && f.label === form.label && !f.key.startsWith('field:'));
    const rest = own.filter((f) => f.key !== form.key && !f.key.startsWith('field:'));
    for (const f of [...shuffle(sameGroup, random), ...shuffle(sameLabel, random), ...shuffle(rest, random)]) offer(f.answers[0]);
    const lang = langOf(note);
    for (const o of shuffle(others, random)) {
      if (o.note.id === note.id || langOf(o.note) !== lang) continue;
      offer(o.forms.find((f) => f.key === form.key)?.answers[0]);
    }
  }
  const picked = wrong.slice(0, 3);
  const gender = form.key === 'field:Gender';
  const word = gender ? genderHeadword(note) : headword(note);
  // In the order `rivalForms` gives, so `formGiven` names the one a wrong answer most likely was.
  const otherForms = rivalForms(form, own)
    .flatMap((f) => f.answers.filter((a) => !right.has(clean(a))).map((text) => ({ text, name: formName(f) })));
  const point = formGrammar(note, form);
  const lang = speechLangFor(note);
  // A gender is read with its word ("la mesa"), since an article alone is hard to make out.
  const spoken = gender ? (isGenderWord(form.answers[0]) ? undefined : `${form.answers[0]} ${word}`) : form.answers[0];
  return {
    noteId: note.id,
    key: form.key,
    headword: word,
    meaning: htmlToText(isOmnilanguage(note) ? note.fields.Meaning ?? '' : Object.values(note.fields)[1] ?? '').replace(/\s+/g, ' ').trim(),
    label: form.label,
    group: form.group === form.label ? '' : form.group,
    answers: form.answers,
    ...(picked.length ? { choices: shuffle([form.answers[0], ...picked], random) } : {}),
    ...(gender ? {} : { sentence: sentenceGap(note, form.answers) }),
    ...(point ? { grammar: { id: point.id, name: point.name, note: point.note } } : {}),
    ...(otherForms.length ? { otherForms } : {}),
    ...(lang && spoken ? { say: { text: spoken, lang } } : {}),
  };
}

/**
 * In a sentence, one word's prompts that would show the same sentence with the same gap and the
 * same answers, as one prompt standing for each of them: "imperfect · yo" and "imperfect · él" on
 * "Ella ___ el autobús." are asked once, as "yo / él", rather than twice with a subject the sentence
 * contradicts. It takes the first one's place, and its answer is logged under every key it covers.
 */
export function mergeSentencePrompts(prompts: FormPrompt[]): FormPrompt[] {
  const out: FormPrompt[] = [];
  const merged = new Map<string, { at: number; forms: FormPrompt[] }>();
  for (const p of prompts) {
    if (!p.sentence) { out.push(p); continue; }
    const answers = [...new Set(p.answers.map(clean))].sort().join('\u0001');
    const id = [p.noteId, p.sentence.before, p.sentence.after, answers].join('\u0000');
    const same = merged.get(id);
    if (same) { same.forms.push(p); continue; }
    merged.set(id, { at: out.length, forms: [p] });
    out.push(p);
  }
  for (const { at, forms } of merged.values()) {
    if (forms.length < 2) continue;
    const [first, ...rest] = forms;
    // Their group once when they share one ("imperfect", "yo / él"); else each form's whole name.
    const oneGroup = rest.every((f) => f.group === first.group);
    // The first's other forms and choices already leave the rest out, as they have the same answers.
    const { grammar, ...prompt } = first;
    out[at] = {
      ...prompt,
      label: forms.map((f) => (oneGroup ? f.label : [f.group, f.label].filter(Boolean).join(' · '))).join(' / '),
      group: oneGroup ? first.group : '',
      keys: forms.flatMap(promptKeys),
      // A grammar point only when it's every form's.
      ...(grammar && rest.every((f) => f.grammar?.id === grammar.id) ? { grammar } : {}),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// When to suggest practice

/** Prompts in one practice of a word's forms, unless Deck options says otherwise. */
export const DEFAULT_FORM_PROMPTS = 6;
export const FORM_PROMPT_CHOICES = [4, 6, 8, 10] as const;
/** The caps offered for one practice of a pattern; 0 is no cap. */
export const PATTERN_PROMPT_LIMITS = [10, 25, 0] as const;

/** A deck's forms practice settings: its own, else its nearest ancestor's, else the defaults. */
export function formsSettings(deck: string, all: Map<string, DeckSettings>): { suggest: boolean; prompts: number } {
  return {
    suggest: inheritedSetting(deck, all, 'suggestForms') ?? true,
    prompts: inheritedSetting(deck, all, 'formPrompts') ?? DEFAULT_FORM_PROMPTS,
  };
}

export interface FormsSuggestion {
  reason: 'missed' | 'new' | 'stale';
  title: string;
  detail: string;
}

/** Days after which forms practiced before are suggested again. */
export const PRACTICE_AGAIN_DAYS = 30;
/** How long a word counts as new: since its first card was first answered. */
export const NEW_WORD_DAYS = 7;

/** When each note's first card was first answered, from answers logged since some time (state 0 is a New card's first answer). */
export function introductions(reviews: ReviewLogEntry[], noteOfCard: Map<string, string>): Map<string, Date> {
  const out = new Map<string, Date>();
  for (const r of reviews) {
    if (r.state !== 0) continue;
    const noteId = noteOfCard.get(r.cardId);
    const at = new Date(r.reviewedAt);
    if (noteId && !(out.get(noteId)! <= at)) out.set(noteId, at);
  }
  return out;
}

/**
 * Whether the answer side suggests practicing this word's forms, and why. Only for a reason the
 * suggestion can name, so it isn't on every card: forms missed last time, a word met this week
 * whose forms were never practiced, or forms not practiced in a month. Never twice in one day.
 * The reason names a tense, never a form, which would give the answer away.
 */
export function formsSuggestion(input: {
  note: Note;
  forms: WordForm[];
  /** This note's practice. */
  history: PracticeRecord[];
  /** When the note's first card was first answered, if that's known. */
  introducedAt?: Date;
  now: Date;
  dayStartsAtHour: number;
}): FormsSuggestion | undefined {
  const { forms, history, now, dayStartsAtHour } = input;
  if (!forms.length) return undefined;
  const word = headword(input.note);
  const dayMs = 86400000;
  if (history.length) {
    const latest = history.reduce((a, b) => (a.practicedAt > b.practicedAt ? a : b));
    const at = new Date(latest.practicedAt);
    if (at >= studyDayStart(now, dayStartsAtHour)) return undefined;
    const missed = missedLastTime(history, dayStartsAtHour);
    const form = forms.find((f) => f.key === missed[0]);
    if (form) {
      const detail = form.key.startsWith('field:')
        ? `Last time you missed its ${form.label}.`
        : form.group ? `Last time you missed one of its ${form.group} forms.` : 'Last time you missed one of its forms.';
      return { reason: 'missed', title: 'Practice its forms again?', detail };
    }
    if (now.getTime() - at.getTime() >= PRACTICE_AGAIN_DAYS * dayMs) {
      return { reason: 'stale', title: 'Practice its forms?', detail: 'You last practiced them over a month ago.' };
    }
    return undefined;
  }
  if (input.introducedAt && now.getTime() - input.introducedAt.getTime() < NEW_WORD_DAYS * dayMs) {
    return {
      reason: 'new',
      title: 'New this week: practice its forms?',
      detail: `You know what ${word} means, but you haven't practiced its forms yet.`,
    };
  }
  return undefined;
}

/**
 * Prompts for practicing several words' forms (a card's own word, or the words gathered at the end
 * of a session): up to `perWord` each, taken in turn so one word's forms aren't all together.
 */
export function wordPrompts(
  notes: Note[],
  pool: PracticeWord[],
  history: PracticeRecord[],
  dayStartsAtHour: number,
  perWord: number,
  random: () => number = Math.random,
  confused: Set<string> = new Set(),
  practicing: Set<string> = new Set(),
): FormPrompt[] {
  const lists = notes.map((n) => chooseForms(
    formsOf(n).forms, history.filter((r) => r.noteId === n.id), dayStartsAtHour, perWord, random, confused, (f) => isPracticed(n, f, practicing),
  ).map((f) => promptFor(n, f, pool, random)));
  const out: FormPrompt[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

/** What the drill says about Forms lines it couldn't read, so none is dropped silently. */
export function unreadableNotice(notes: Note[]): string | undefined {
  const parts = notes
    .map((n) => ({ word: headword(n), count: formsOf(n).unreadable.length }))
    .filter((p) => p.count > 0)
    .map((p) => `${p.count} in ${p.word}`);
  if (!parts.length) return undefined;
  return `Some lines of the Forms field couldn't be read, so they weren't asked (${parts.join(', ')}). Each line needs what the form is and the form, like "present · yo: espero". Edit the note to fix them.`;
}

/** Every word with forms, for the drill's wrong choices. */
export function practicePool(notes: Iterable<Note>): PracticeWord[] {
  const out: PracticeWord[] = [];
  for (const note of notes) {
    const { forms } = formsOf(note);
    if (forms.length) out.push({ note, forms });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Practicing a pattern across a deck

/** A word's pattern, for practicing a whole pattern: its VerbClass, else its part of speech. */
export function patternOf(note: Note): string {
  const text = (name: string) => htmlToText(note.fields[name] ?? '').replace(/\s+/g, ' ').trim();
  return text('VerbClass') || text('PartOfSpeech') || 'other';
}

export interface PracticeWord {
  note: Note;
  forms: WordForm[];
}

/** The patterns and form groups among the words, in the order they first appear, for the chips. */
export function practiceChoices(words: PracticeWord[]): { patterns: string[]; groups: string[] } {
  const patterns: string[] = [];
  const groups: string[] = [];
  for (const w of words) {
    const p = patternOf(w.note);
    if (!patterns.includes(p)) patterns.push(p);
    for (const f of w.forms) if (f.group && !groups.includes(f.group)) groups.push(f.group);
  }
  return { patterns, groups };
}

/**
 * The kinds of form the practice screen starts with: those of grammar practiced in Read & Listen
 * (`practicing`, by point id) among these words, in the screen's order, and the points they are,
 * for saying why. Empty when none is practiced: the screen starts with its first kind, as before.
 */
export function practicedGroups(words: PracticeWord[], practicing: Set<string>): { groups: string[]; points: GrammarPointInfo[] } {
  const groups: string[] = [];
  const points: GrammarPointInfo[] = [];
  if (!practicing.size) return { groups, points };
  for (const g of practiceChoices(words).groups) {
    for (const w of words) {
      const form = w.forms.find((f) => f.group === g);
      const point = form && formGrammar(w.note, form);
      if (!point || !practicing.has(point.id)) continue;
      groups.push(g);
      if (!points.some((p) => p.name === point.name)) points.push(point);
      break;
    }
  }
  return { groups, points };
}

/** "Chosen because you're practicing the preterite and the present subjunctive in Read & Listen." */
export function practicedGroupsLine(points: GrammarPointInfo[]): string | undefined {
  const names = points.map((p) => `the ${p.name.toLocaleLowerCase()}`);
  if (!names.length) return undefined;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Chosen because you're practicing ${list} in Read & Listen.`;
}

/**
 * Prompts for practicing patterns across words already studied: `count` of them, among the forms
 * in `groups`, forms still owed right answers first, never the same word twice in a row when there's a choice.
 */
export function patternPrompts(
  words: PracticeWord[],
  choice: { patterns: string[]; groups: string[] },
  history: PracticeRecord[],
  dayStartsAtHour: number,
  count: number,
  random: () => number = Math.random,
  /** Where wrong choices are taken from: every word with forms, not only these. */
  pool: PracticeWord[] = words,
  confused: Set<string> = new Set(),
  practicing: Set<string> = new Set(),
): FormPrompt[] {
  const chosen = words.filter((w) => choice.patterns.includes(patternOf(w.note)));
  const byNote = new Map<string, PracticeRecord[]>();
  for (const r of history) (byNote.get(r.noteId) ?? byNote.set(r.noteId, []).get(r.noteId)!).push(r);
  const candidates: { word: PracticeWord; form: WordForm; rank: number; owed: number; lastAsked: string }[] = [];
  for (const w of chosen) {
    const mine = byNote.get(w.note.id) ?? [];
    const weak = weakForms(mine, dayStartsAtHour);
    const lastAsked = new Map<string, string>();
    for (const r of mine) if ((lastAsked.get(r.key) ?? '') < r.practicedAt) lastAsked.set(r.key, r.practicedAt);
    for (const f of w.forms) {
      if (!choice.groups.includes(f.group)) continue;
      candidates.push({
        word: w, form: f, rank: askRank(f, weak, lastAsked.has(f.key), confused, isPracticed(w.note, f, practicing)),
        owed: weak.get(f.key) ?? 0, lastAsked: lastAsked.get(f.key) ?? '',
      });
    }
  }
  // As `chooseForms` orders one word's: then the form asked longest ago, so yesterday's aren't as likely as last month's.
  const ordered = shuffle(candidates, random)
    .sort((a, b) => a.rank - b.rank || b.owed - a.owed || a.lastAsked.localeCompare(b.lastAsked))
    .slice(0, count);
  // Spread the words out: take the next candidate from a different word than the last one.
  const out: typeof ordered = [];
  const left = shuffle(ordered, random);
  while (left.length) {
    const prev = out[out.length - 1]?.word.note.id;
    const i = left.findIndex((c) => c.word.note.id !== prev);
    out.push(left.splice(i >= 0 ? i : 0, 1)[0]);
  }
  return out.map((c) => promptFor(c.word.note, c.form, pool, random));
}

// ---------------------------------------------------------------------------------------------
// What a drill asks

/**
 * What a drill is for, small enough to pass to its screen: some words' forms (a card's own word,
 * or the words gathered at the end of a session), or a pattern across a deck.
 */
export type DrillRequest =
  | { kind: 'words'; noteIds: string[]; perWord: number }
  | { kind: 'pattern'; deck: string; patterns: string[]; groups: string[]; sentence: boolean; /** Most prompts to ask; absent means every one. */ limit?: number };

/** Words in `deck` (and its subdecks) with forms, that have a card answered at least once. */
export function studiedWords(deck: string, notes: Iterable<Note>, cards: Card[]): PracticeWord[] {
  const studied = new Set(cards.filter((c) => c.sched.state !== 0).map((c) => c.noteId));
  return practicePool(notes).filter((w) => isInDeck(w.note.deck, deck) && studied.has(w.note.id));
}

/**
 * The prompts a drill asks, and what it says about Forms lines it couldn't read. "In a sentence"
 * keeps only forms that the word's example sentence holds, one prompt for forms that would show
 * the same gap with the same answer (`mergeSentencePrompts`).
 */
export function drillPrompts(
  request: DrillRequest,
  data: {
    notes: Note[];
    cards: Card[];
    practice: PracticeRecord[];
    /** The collection's "Next day starts at", which decides what counts as a retry the same day (`weakForms`). */
    dayStartsAtHour: number;
    /** Grammar point ids practiced in Read & Listen, asked first. */
    practicing?: Set<string>;
  },
  random: () => number = Math.random,
): { prompts: FormPrompt[]; notice?: string } {
  const practicing = data.practicing ?? new Set<string>();
  const pool = practicePool(data.notes);
  const confused = confusedAnswers(confusions(data.practice, pool));
  if (request.kind === 'words') {
    const byId = new Map(data.notes.map((n) => [n.id, n]));
    const targets = request.noteIds.map((id) => byId.get(id)).filter((n): n is Note => !!n);
    return { prompts: wordPrompts(targets, pool, data.practice, data.dayStartsAtHour, request.perWord, random, confused, practicing), notice: unreadableNotice(targets) };
  }
  const words = studiedWords(request.deck, data.notes, data.cards);
  const choice = { patterns: request.patterns, groups: request.groups };
  const limit = request.limit ?? Number.POSITIVE_INFINITY;
  // "In a sentence" filters after choosing, so it picks from every form rather than the first few.
  const all = patternPrompts(words, choice, data.practice, data.dayStartsAtHour, request.sentence ? Number.POSITIVE_INFINITY : limit, random, pool, confused, practicing);
  const prompts = request.sentence ? mergeSentencePrompts(all.filter((p) => p.sentence)).slice(0, limit) : all;
  const chosen = words.filter((w) => choice.patterns.includes(patternOf(w.note))).map((w) => w.note);
  return { prompts, notice: unreadableNotice(chosen) };
}

/**
 * The missed prompts, to practice again right after the summary that showed every answer: each
 * one's choices reshuffled, its answer never where it was, so a pick is made by reading the form
 * rather than by remembering where it sat.
 */
export function againPrompts(missed: FormPrompt[], random: () => number = Math.random): FormPrompt[] {
  return missed.map((p) => {
    // Always a new prompt, so the drill writes its answer afresh rather than taking it for the one before.
    if (!p.choices || p.choices.length < 2) return { ...p };
    const was = p.choices.indexOf(p.answers[0]);
    const choices = shuffle(p.choices, random);
    const at = choices.indexOf(p.answers[0]);
    if (at === was) {
      // Swap it with any other place, evenly.
      const other = (at + 1 + Math.floor(random() * (choices.length - 1))) % choices.length;
      [choices[at], choices[other]] = [choices[other], choices[at]];
    }
    return { ...p, choices };
  });
}
