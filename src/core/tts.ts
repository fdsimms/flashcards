import { decodeEntities } from './typeAnswer';

/**
 * Anki's text-to-speech tags, read the way rslib reads them (card_rendering/parser.rs and
 * writer.rs, at ANKI_VERSION 26.09.4). {{tts en_US voices=Apple_Samantha speed=0.8:Front}} in a
 * template becomes [anki:tts lang=en_US voices=Apple_Samantha speed=0.8]...[/anki:tts], which a
 * field can also hold itself; each one is read aloud with the phone's voices (expo-speech).
 */

export interface TtsTag {
  /** The text to read: HTML stripped, line breaks as spaces, a cloze's [...] read as "blank". */
  text: string;
  /** Anki's language code, e.g. th_TH. */
  lang: string;
  /** Voices to try in order, by Anki's names (Apple_Samantha). */
  voices: string[];
  /** 1 is normal speed. */
  speed: number;
}

/** What the tts filter writes: {{tts <options>:Field}}. */
export function ttsFilter(options: string, text: string): string {
  return `[anki:tts lang=${options}]${text}[/anki:tts]`;
}

/** A tag with no language, which Anki shows as an error in place of a play button. */
export const TTS_NO_LANGUAGE = '[No language to read this aloud in. Add one, like {{tts en_US:Front}}.]';

const TTS_TAG = /\[anki:tts((?:[ \t\r\n]+[^\] \t\r\n=]+=(?:"[^"]*"|[^\] \t\r\n"]*))*)[ \t\r\n]*\]([\s\S]*?)\[\/anki:tts\]/g;
const OPTION = /([^\] \t\r\n=]+)=(?:"([^"]*)"|([^\] \t\r\n"]*))/g;
const LINEBREAK_TAGS = /<\/?(?:br|address|article|aside|blockquote|canvas|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|noscript|ol|output|p|pre|section|table|tfoot|ul|video)>/gi;
const HTML = /<!--.*?-->|<style.*?>.*?<\/style>|<script.*?>.*?<\/script>|<.*?>/gis;

/** Anki's strip_html_for_tts. */
function ttsText(html: string): string {
  return decodeEntities(html.replace(LINEBREAK_TAGS, ' ').replace(HTML, ''));
}

/**
 * Each [anki:tts] tag in `html`, in order, replaced by `replace(tag, index)`: a play button, or,
 * when `tag` is undefined (no language given), Anki's error in its place. `tags` lists the ones
 * that can be read.
 */
export function ttsTags(html: string, replace: (tag: TtsTag | undefined, index: number) => string): { html: string; tags: TtsTag[] } {
  const tags: TtsTag[] = [];
  const out = html.replace(TTS_TAG, (_, opts: string, content: string) => {
    const o = new Map<string, string>();
    for (const m of opts.matchAll(OPTION)) o.set(m[1], m[2] ?? m[3]);
    const lang = o.get('lang') ?? '';
    if (!lang) return replace(undefined, -1);
    const speed = Number(o.get('speed'));
    const tag: TtsTag = {
      text: ttsText(content).split('[...]').join(o.get('cloze_blank') ?? 'blank'),
      lang,
      voices: o.get('voices') ? o.get('voices')!.split(',') : [],
      speed: o.has('speed') && Number.isFinite(speed) && o.get('speed')!.trim() !== '' ? speed : 1,
    };
    tags.push(tag);
    return replace(tag, tags.length - 1);
  });
  return { html: out, tags };
}

/** [anki:tts] tags taken out, for {{FrontSide}} on the back, which doesn't read the question again. */
export function withoutTts(html: string): string {
  return html.replace(TTS_TAG, '');
}

/** Anki's th_TH as iOS writes it, th-TH. */
export function speechLanguage(lang: string): string {
  return lang.replace(/_/g, '-');
}

/**
 * The phone voice to read `tag` with: the first of its voices the phone has (Anki's
 * Apple_Samantha is iOS's Samantha), in the tag's language. Undefined leaves the choice to iOS,
 * which picks its voice for the language.
 */
export function pickVoice(available: { identifier: string; name: string; language: string }[], tag: TtsTag): string | undefined {
  const lang = speechLanguage(tag.lang).toLowerCase();
  const inLang = available.filter((v) => v.language.toLowerCase() === lang || v.language.toLowerCase().startsWith(`${lang}-`) || lang.startsWith(`${v.language.toLowerCase()}-`));
  for (const want of tag.voices) {
    const name = want.replace(/^Apple_/, '').replace(/_/g, ' ').toLowerCase();
    const found = inLang.find((v) => v.name.toLowerCase() === name || v.identifier.toLowerCase() === want.toLowerCase());
    if (found) return found.identifier;
  }
  return undefined;
}
