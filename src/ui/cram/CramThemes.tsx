import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { cramLanguageOf, themeTopic } from '../../core/cram';
import { combineWeakSpots, themeCounts, themesRequest, themesToAvoid, themeWords, weakSpots, type ThemeKind } from '../../core/cramThemes';
import { failureText } from '../../core/failure';
import type { Api, CramTheme, Language } from '../../reader/api';
import { flaggedName, LANGUAGES } from '../../reader/languages';
import { keptLines } from '../../reader/corrections';
import { loadKept } from '../../reader/correctionsStorage';
import { loadParticle } from '../../reader/lessonStorage';
import { loadToolMarks } from '../../tools/storage';
import { toolById } from '../../tools/tools';
import { haptic } from '../haptics';
import { Card, ErrorNote, Help, Icon, Loading, Screen, Segments, Tappable } from '../kit';
import { readable, space, type, radius, useTheme, type Colors } from '../theme';
import { useCollection, useCrams } from '../useCrams';
import { WorkingMark } from '../WorkingMark';
import { setThemeState, useThemeState } from './themeStore';

/** A small label in a color pair from the theme (`fill` behind `ink`). */
export function Chip({ label, ink, fill }: { label: string; ink: string; fill: string }) {
  return (
    <View style={{ borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: space.s + 1, backgroundColor: fill }}>
      <Text style={{ ...type.footnote, color: ink, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

const chipColors = (c: Colors): Record<ThemeKind | 'new', { ink: string; fill: string }> => ({
  carried: { ink: c.accentInk, fill: c.accentFill },
  missed: { ink: c.danger, fill: c.dangerFill },
  fresh: { ink: c.countNew, fill: c.countNewFill },
  deck: { ink: c.textSecondary, fill: c.fill },
  new: { ink: c.goodInk, fill: c.goodFill },
});

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What a theme's chips say: the words it reuses, by why they're on offer, and the ones to learn. */
export function themeChips(theme: CramTheme, words: Parameters<typeof themeCounts>[1]): { key: ThemeKind | 'new'; label: string }[] {
  const n = themeCounts(theme, words);
  const out: { key: ThemeKind | 'new'; label: string }[] = [];
  if (n.carried) out.push({ key: 'carried', label: `${n.carried} from last time` });
  if (n.missed) out.push({ key: 'missed', label: `${n.missed} missed` });
  if (n.fresh) out.push({ key: 'fresh', label: `${n.fresh} recently added` });
  if (n.new) out.push({ key: 'new', label: `${n.new} new` });
  return out;
}

/**
 * Talking points for a cram: Claude writes a few angles on what the cram is for (its name) from the
 * words you have (the ones not used last time, missed, added lately), and what Practice has been
 * missing. Asked for when the screen opens, and again with Show different themes; a theme is opened
 * to see its words and questions, and Use theme there adds them to the cram. Nothing is added to the
 * deck here.
 */
export function CramThemes({ repo, api, cramId, onOpen }: {
  repo: NoteStore;
  api: Api;
  cramId: string;
  onOpen: (index: number) => void;
}) {
  const c = useTheme();
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

  const words = useMemo(
    () => (collection.loaded && language ? themeWords({ notes: collection.notes, cards: collection.cards, language, crams, now: new Date() }) : []),
    [collection.loaded, collection.notes, collection.cards, language, crams],
  );
  const shown = suggested?.cramId === cramId && suggested.language === language ? suggested : undefined;

  const ask = useCallback(async (more: boolean, wantStretch: boolean) => {
    if (asking || !words.length || !language) return;
    const forLanguage = language;
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
      const answer = await api.cramThemes(themesRequest(forLanguage, words, weak, themesToAvoid(others, already), wantStretch, topic, crams.find((x) => x.id === cramId)?.register, particle));
      setThemeState({ suggested: { cramId, language: forLanguage, words, themes: answer.themes, shown: [...already, ...answer.themes.map((t) => t.title)], stretch: wantStretch } });
    } catch (e) {
      setProblem(failureText(e, { what: "Couldn't get theme ideas.", next: 'Try again.' }));
    } finally {
      setAsking(false);
    }
  }, [api, asking, cramId, crams, language, shown, topic, words]);

  // Asked once on opening, when there's nothing for this language yet.
  useEffect(() => {
    if (asked.current || !collection.loaded || !cramsLoaded || !words.length || shown) return;
    asked.current = true;
    void ask(false, stretch);
  }, [collection.loaded, cramsLoaded, words.length, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickStretch = (on: boolean) => {
    setStretch(on);
    haptic.select();
    void ask(false, on);
  };

  const noWords = collection.loaded && !!language && !words.length;
  return (
    <Screen title="Talking points" largeTitle={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
        {cram && collection.loaded && !language ? <Help>Choose the cram's language first (Edit, on its page).</Help> : null}
        {cram && language ? <Help>{topic ? `Ways to talk about "${topic}", from your ${LANGUAGES[language].name} words and what you've been missing.` : `Things to talk about, from your ${LANGUAGES[language].name} words and what you've been missing. The cram is named after the one you pick.`}</Help> : null}
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
            <Card>
              <Text style={{ ...type.headline, color: c.text }}>{theme.title}</Text>
              {theme.why ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{theme.why}</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s - 2 }}>
                {themeChips(theme, shown.words).map((chip) => <Chip key={chip.key} label={chip.label} {...chipColors(c)[chip.key]} />)}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ ...type.footnote, color: c.textSecondary }}>
                  {`${theme.word_ids.length} of your ${plural(theme.word_ids.length, 'word', 'words')}${theme.new_words.length ? ` · ${theme.new_words.length} new` : ''}`}
                </Text>
                <Text style={{ ...type.footnote, color: c.textSecondary }}>{`${theme.questions.length} ${plural(theme.questions.length, 'question', 'questions')}`}</Text>
              </View>
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
