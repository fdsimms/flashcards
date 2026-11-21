import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { afterCardsAsked, cramLanguageOf } from '../../core/cram';
import { failureText, Refusal } from '../../core/failure';
import { noCandidatesText, type LessonWordCandidate } from '../../core/lessonWords';
import type { Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Button, Card, Help, Icon, Loading, Screen, Tappable } from '../kit';
import { radius, readable, space, type, useTheme } from '../theme';
import { cramsNow, saveCram, useCollection, useCrams } from '../useCrams';
import { WorkingMark } from '../WorkingMark';

type Lookup = { state: 'finding' } | { state: 'found'; list: LessonWordCandidate[] } | { state: 'failed'; why: string };

/**
 * Make cards for all, from a cram's From the lesson: every word jotted down in the lesson is looked
 * up as Find word does (one at a time, writing nothing), the first match picked for each, any of
 * which can be changed or skipped. Make cards sends the picks to the note queue in one request; the
 * cards join the cram once approved, and each jotting is replaced on the cram by its card being
 * written (`afterCardsAsked`).
 */
export function CramMakeCards({ repo, id, findWords, queue }: {
  repo: NoteStore;
  id: string;
  findWords: (language: Language, text: string) => Promise<LessonWordCandidate[]>;
  queue: (language: Language, entries: { entry: string; meaning: string }[]) => Promise<'queued' | 'held' | undefined>;
}) {
  const c = useTheme();
  const router = useRouter();
  const { crams } = useCrams(repo);
  const collection = useCollection(repo);
  const cram = crams.find((x) => x.id === id);
  const language = cram && collection.loaded ? cramLanguageOf(cram, collection.notes) : undefined;
  // The jottings as the screen opened: one jotted meanwhile waits for the next time.
  const [words, setWords] = useState<string[]>();
  const [lookups, setLookups] = useState<Map<string, Lookup>>(new Map());
  // The candidate picked for each word, by its place in the list; -1 skips the word.
  const [picks, setPicks] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const sending = useRef(false);

  useEffect(() => { if (cram && !words) setWords(cram.captured ?? []); }, [cram, words]);
  useEffect(() => {
    if (!words || !language) return undefined;
    let live = true;
    (async () => {
      // One at a time: a lesson's handful, never a burst of requests.
      for (const w of words) {
        if (!live) return;
        setLookups((m) => new Map(m).set(w, { state: 'finding' }));
        let result: Lookup;
        try {
          const list = await findWords(language, w);
          result = list.length ? { state: 'found', list } : { state: 'failed', why: noCandidatesText(w, LANGUAGES[language].name) };
        } catch (e) {
          result = { state: 'failed', why: failureText(e, { next: 'Try again later from the cram.' }) };
        }
        if (!live) return;
        setLookups((m) => new Map(m).set(w, result));
      }
    })();
    return () => { live = false; };
  }, [words, language]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cram || !words || !collection.loaded) return <Screen title="Make cards" largeTitle={false}><Loading /></Screen>;
  if (!language) {
    return (
      <Screen title="Make cards" largeTitle={false}>
        <ScrollView contentContainerStyle={{ ...readable, padding: space.l }}><Help>Choose the cram's language first (Edit, on its page).</Help></ScrollView>
      </Screen>
    );
  }
  const pickOf = (w: string) => {
    const l = lookups.get(w);
    if (l?.state !== 'found') return undefined;
    const i = picks.get(w) ?? 0;
    return i >= 0 ? l.list[i] : undefined;
  };
  const chosen = words.flatMap((w) => { const word = pickOf(w); return word ? [{ capture: w, word }] : []; });
  const looking = words.some((w) => !lookups.get(w) || lookups.get(w)!.state === 'finding');

  const make = async () => {
    if (sending.current || !chosen.length) return;
    sending.current = true;
    haptic.tap();
    setBusy(true);
    setProblem(undefined);
    try {
      const how = await queue(language, chosen.map(({ word }) => ({ entry: word.text, meaning: word.english })));
      if (!how) throw new Refusal(`Read & Listen has no ${LANGUAGES[language].name} deck to add cards to. Add one in Settings, Read & Listen.`);
      // The cram as it is now: a word jotted or a question checked while this was on its way is kept.
      const now = cramsNow().find((x) => x.id === id);
      if (now) await saveCram(repo, afterCardsAsked(now, chosen.map(({ capture, word }) => ({ capture, word: { text: word.text, english: word.english } }))));
      haptic.success();
      router.back();
    } catch (e) {
      setProblem(failureText(e, { what: "Couldn't send to Claude.", next: 'Try again.' }));
      setBusy(false);
    } finally {
      sending.current = false;
    }
  };

  return (
    <Screen
      title="Make cards"
      largeTitle={false}
      footer={(
        <>
          {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
          <Button label={chosen.length === 1 ? 'Make 1 card' : `Make ${chosen.length} cards`} onPress={make} busy={busy} disabled={!chosen.length || looking} />
          <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>Claude writes them. Approve them from the card on Today and they join the cram.</Text>
        </>
      )}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
        {words.map((w) => {
          const l = lookups.get(w);
          const at = picks.get(w) ?? 0;
          return (
            <Card key={w} style={{ gap: space.s }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                <Text style={{ ...type.headline, color: c.text, flex: 1 }}>{w}</Text>
                {l?.state === 'found' ? (
                  <Tappable onPress={() => { haptic.select(); setPicks((m) => new Map(m).set(w, at >= 0 ? -1 : 0)); }} accessibilityRole="button" accessibilityLabel={at >= 0 ? `Skip ${w}` : `Make a card for ${w}`}>
                    <Text style={{ ...type.subhead, color: c.accentInk }}>{at >= 0 ? 'Skip' : 'Include'}</Text>
                  </Tappable>
                ) : null}
              </View>
              {!l || l.state === 'finding' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                  <WorkingMark />
                  <Text style={{ ...type.subhead, color: c.textSecondary }}>{`Finding the ${LANGUAGES[language].name}`}</Text>
                </View>
              ) : l.state === 'failed' ? (
                <Text style={{ ...type.subhead, color: c.textSecondary }}>{l.why}</Text>
              ) : at < 0 ? (
                <Text style={{ ...type.subhead, color: c.textSecondary }}>Skipped. It stays on the cram.</Text>
              ) : (
                l.list.map((cand, i) => {
                  const on = i === at;
                  return (
                    <Tappable
                      key={cand.text}
                      onPress={() => { haptic.select(); setPicks((m) => new Map(m).set(w, i)); }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={[cand.text, cand.reading, cand.english].filter(Boolean).join(', ')}
                      scaleTo={0.98}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: on ? c.accentFill : c.fill, borderRadius: radius.m, borderWidth: on ? 2 : 0, borderColor: c.accent, padding: space.m }}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ ...type.title, color: c.text }}>{cand.text}</Text>
                        <Text style={{ ...type.subhead, color: c.textSecondary }}>{[cand.reading, cand.english].filter(Boolean).join(' · ')}</Text>
                      </View>
                      {on ? <Icon name="checkmark.circle.fill" size={20} color={c.accent} /> : null}
                    </Tappable>
                  );
                })
              )}
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
