import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { cramLanguageOf, talkSummary, themeTopic } from '../../core/cram';
import { combineWeakSpots, THEME_FACTS_CHARS, themeCounts, themeDeckWords, themesRequest, themesToAvoid, themeWords, weakSpots, type ThemeKind, type ThemeWord } from '../../core/cramThemes';
import { failureText } from '../../core/failure';
import type { Api, CramTheme, Language } from '../../reader/api';
import { flaggedName, LANGUAGES } from '../../reader/languages';
import { keptLines } from '../../reader/corrections';
import { loadKept } from '../../reader/correctionsStorage';
import { loadParticle } from '../../reader/lessonStorage';
import { loadToolMarks } from '../../tools/storage';
import { toolById } from '../../tools/tools';
import { haptic } from '../haptics';
import { Button, Card, ErrorNote, Field, Help, Icon, Loading, Screen, Segments, Tappable } from '../kit';
import { readable, space, type, radius, useTheme, type Colors } from '../theme';
import { saveCram, useCollection, useCrams } from '../useCrams';
import { WorkingMark } from '../WorkingMark';
import { setThemeState, useThemeState } from './themeStore';
import { useKeyboardScroll } from '../useKeyboardScroll';

/** A small label in a color pair from the theme (`fill` behind `ink`). */
export function Chip({ label, ink, fill }: { label: string; ink: string; fill: string }) {
  return (
    <View style={{ borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: space.s + 1, backgroundColor: fill }}>
      <Text style={{ ...type.footnote, color: ink, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

const chipColors = (c: Colors): Record<ThemeKind | 'new', { ink: string; fill: string }> => ({
  cram: { ink: c.accentInk, fill: c.accentFill },
  carried: { ink: c.accentInk, fill: c.accentFill },
  missed: { ink: c.danger, fill: c.dangerFill },
  fresh: { ink: c.countNew, fill: c.countNewFill },
  deck: { ink: c.textSecondary, fill: c.fill },
  new: { ink: c.goodInk, fill: c.goodFill },
});

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What a theme's chips say: its words (`themeDeckWords`), by why they're on offer, and the ones to learn. */
export function themeChips(theme: CramTheme, words: ThemeWord[]): { key: ThemeKind | 'new'; label: string }[] {
  const n = themeCounts(theme, words);
  const out: { key: ThemeKind | 'new'; label: string }[] = [];
  if (n.cram) out.push({ key: 'cram', label: `${n.cram} in this cram` });
  if (n.carried) out.push({ key: 'carried', label: `${n.carried} from last time` });
  if (n.missed) out.push({ key: 'missed', label: `${n.missed} missed` });
  if (n.fresh) out.push({ key: 'fresh', label: `${n.fresh} recently added` });
  if (n.new) out.push({ key: 'new', label: `${n.new} new` });
  return out;
}

/**
 * Talking points for a cram: Claude writes a few angles on what the cram is for (its name) from the
 * words you have (the cram's own, the ones not used last time, missed, added lately, and any others
 * of the deck that fit), what Practice has been missing, and what really happened when you say (kept
 * on the cram, `Cram.facts`). Asked for when the screen opens, and again with Show different themes
 * or Write them again; a theme is opened to see its words and questions, and Use theme there adds
 * them to the cram. Several can be checked and added together with Use themes. Nothing is added to
 * the deck here.
 */
export function CramThemes({ repo, api, cramId, onOpen, onUse }: {
  repo: NoteStore;
  api: Api;
  cramId: string;
  onOpen: (index: number) => void;
  /** Keeps the checked themes on the cram and tags their words (`noteIds`); the screen says so if this throws. */
  onUse: (themes: CramTheme[], noteIds: string[]) => Promise<void>;
}) {
  const c = useTheme();
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const { suggested } = useThemeState();
  const { crams, loaded: cramsLoaded } = useCrams(repo);
  const collection = useCollection(repo);
  const cram = crams.find((x) => x.id === cramId);
  const topic = cram ? themeTopic(cram) : '';
  const language = cram && collection.loaded ? cramLanguageOf(cram, collection.notes) : undefined;
  const [stretch, setStretch] = useState(suggested?.cramId === cramId ? suggested.stretch : false);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string>();
  const asked = useRef(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [using, setUsing] = useState(false);
  const [facts, setFacts] = useState<string>();
  const factsDraft = facts ?? cram?.facts ?? '';

  const words = useMemo(
    () => (collection.loaded && language ? themeWords({ notes: collection.notes, cards: collection.cards, language, crams, now: new Date(), cram }) : []),
    [collection.loaded, collection.notes, collection.cards, language, crams],
  );
  const shown = suggested?.cramId === cramId && suggested.language === language ? suggested : undefined;

  const ask = useCallback(async (more: boolean, wantStretch: boolean, note?: string) => {
    if (asking || !words.length || !language) return;
    const forLanguage = language;
    const forFacts = (note ?? crams.find((x) => x.id === cramId)?.facts ?? '').replace(/\s+/g, ' ').trim();
    setAsking(true);
    setProblem(undefined);
    try {
      const marks = await loadToolMarks();
      const kept = await loadKept();
      const particle = await loadParticle();
      const weak = combineWeakSpots(weakSpots(marks, forLanguage, Date.now(), (id) => toolById(id)?.title), keptLines(kept, forLanguage, Date.now()));
      const already = more && shown ? shown.shown : [];
      // Not this cram's own name: every theme is an angle on it.
      const others = crams.filter((x) => x.id !== cramId);
      const answer = await api.cramThemes(themesRequest(forLanguage, words, weak, themesToAvoid(others, already), wantStretch, topic, crams.find((x) => x.id === cramId)?.register, particle, forFacts));
      // Each theme's words, found now while the notes are at hand: the deck's other words it named are matched by their word.
      const wordsOf = answer.themes.map((t) => themeDeckWords(t, words, collection.notes, forLanguage));
      setThemeState({ suggested: { cramId, language: forLanguage, words, themes: answer.themes, wordsOf, facts: forFacts, shown: [...already, ...answer.themes.map((t) => t.title)], stretch: wantStretch } });
    } catch (e) {
      setProblem(failureText(e, { what: "Couldn't get theme ideas.", next: 'Try again.' }));
    } finally {
      setAsking(false);
    }
  }, [api, asking, cramId, crams, language, shown, topic, words, collection.notes]);

  // Asked once on opening, when there's nothing for this language yet.
  useEffect(() => {
    if (asked.current || !collection.loaded || !cramsLoaded || !words.length || shown) return;
    asked.current = true;
    void ask(false, stretch);
  }, [collection.loaded, cramsLoaded, words.length, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  // What really happened is kept on the cram, then the themes are written again from it.
  const rewrite = async () => {
    if (!cram) return;
    haptic.tap();
    const note = factsDraft.replace(/\s+/g, ' ').trim();
    try {
      await saveCram(repo, { ...cram, facts: note || undefined });
    } catch (e) {
      setProblem(failureText(e, { what: "Couldn't save what happened.", next: 'Try again.' }));
      return;
    }
    setFacts(undefined);
    void ask(false, stretch, note);
  };
  const factsChanged = !!shown && factsDraft.replace(/\s+/g, ' ').trim() !== shown.facts;

  const pickStretch = (on: boolean) => {
    setStretch(on);
    haptic.select();
    void ask(false, on);
  };

  // Only themes still on screen count: asking for different ones replaces the list.
  const chosen = shown ? shown.themes.filter((t) => picked.has(t.title)) : [];
  const toggle = (title: string) => {
    haptic.select();
    setPicked((prev) => { const next = new Set(prev); if (!next.delete(title)) next.add(title); return next; });
  };
  const use = async () => {
    if (!shown || !chosen.length || using) return;
    haptic.tap();
    setUsing(true);
    try {
      const noteIds = [...new Set(shown.themes.flatMap((t, i) => (picked.has(t.title) ? (shown.wordsOf[i] ?? []).map((w) => w.noteId) : [])))];
      await onUse(chosen, noteIds);
    } catch (e) {
      Alert.alert("Couldn't use the themes", failureText(e, { next: 'Try again.' }));
    } finally {
      setUsing(false);
    }
  };

  const noWords = collection.loaded && !!language && !words.length;
  return (
    <Screen
      title="Talking points"
      largeTitle={false}
      footer={chosen.length ? <Button label={`Use ${chosen.length} ${plural(chosen.length, 'theme', 'themes')}`} busy={using} onPress={() => { void use(); }} /> : undefined}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ ...readable, padding: space.l, paddingBottom: space.l + bottomPadding, gap: space.m }} {...scrollProps}>
        {cram && collection.loaded && !language ? <Help>Choose the cram's language first (Edit, on its page).</Help> : null}
        {cram && language ? <Help>{topic ? `Ways to talk about "${topic}", from your ${LANGUAGES[language].name} words and what you've been missing.` : `Things to talk about, from your ${LANGUAGES[language].name} words and what you've been missing. The cram is named after the one you pick.`}</Help> : null}
        <Card>
          <Field
            label="What really happened? (optional)"
            value={factsDraft}
            onChangeText={(t) => setFacts(t.slice(0, THEME_FACTS_CHARS))}
            placeholder="e.g. Ran 21 km in 2:05, legs still sore"
            multiline
          />
          <Help>Your stories and answers are written from this, so they say what you'd really say.</Help>
          {factsChanged && !asking ? <Button variant="secondary" label="Write them again with this" onPress={() => { void rewrite(); }} /> : null}
        </Card>
        <Segments<'comfortable' | 'stretch'>
          options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'stretch', label: 'Stretch' }]}
          value={stretch ? 'stretch' : 'comfortable'}
          onChange={(v) => pickStretch(v === 'stretch')}
        />
        {!collection.loaded || !cramsLoaded ? <Loading /> : null}
        {noWords && language ? <Help>{`Needs ${LANGUAGES[language].name} words you've studied at least once.`}</Help> : null}
        {problem ? <ErrorNote message={problem} onRetry={() => { void ask(false, stretch); }} /> : null}
        {asking && !shown ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <WorkingMark />
            <Text style={{ ...type.subhead, color: c.textSecondary }}>Thinking of themes</Text>
          </View>
        ) : null}
        {shown?.themes.map((theme, i) => (
          <Tappable key={theme.title} onPress={() => { haptic.tap(); onOpen(i); }} accessibilityRole="button" accessibilityLabel={`Open ${theme.title}`} scaleTo={0.98}>
            <Card style={picked.has(theme.title) ? { borderColor: c.accent, borderWidth: 2 } : undefined}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
                <Text style={{ ...type.headline, color: c.text, flex: 1 }}>{theme.title}</Text>
                <Tappable
                  onPress={() => toggle(theme.title)}
                  hitSlop={space.s}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: picked.has(theme.title) }}
                  accessibilityLabel={`Select ${theme.title}`}
                >
                  <Icon name={picked.has(theme.title) ? 'checkmark.circle.fill' : 'circle'} size={24} color={picked.has(theme.title) ? c.accent : c.textTertiary} />
                </Tappable>
              </View>
              {theme.why ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{theme.why}</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s - 2 }}>
                {themeChips(theme, shown.wordsOf[i] ?? []).map((chip) => <Chip key={chip.key} label={chip.label} {...chipColors(c)[chip.key]} />)}
              </View>
              <Text style={{ ...type.footnote, color: c.textSecondary }}>
                {`${(shown.wordsOf[i] ?? []).length} of your ${plural((shown.wordsOf[i] ?? []).length, 'word', 'words')}${theme.new_words.length ? ` · ${theme.new_words.length} new` : ''} · ${talkSummary(theme)}`}
              </Text>
            </Card>
          </Tappable>
        ))}
        {shown ? (
          <Tappable onPress={() => { void ask(true, stretch); }} disabled={asking} accessibilityRole="button" accessibilityLabel="Show different themes" style={{ alignSelf: 'center', paddingVertical: space.s }}>
            {asking ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                <WorkingMark />
                <Text style={{ ...type.subhead, color: c.textSecondary }}>Thinking of themes</Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 }}>
                <Icon name="sparkles" size={16} color={c.accentInk} />
                <Text style={{ ...type.subhead, color: c.accentInk }}>Show different themes</Text>
              </View>
            )}
          </Tappable>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

