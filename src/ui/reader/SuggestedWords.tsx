import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import type { Api, Language, WordSuggestions } from '../../reader/api';
import {
  firstTicked, suggestionDetail, suggestionSections, tickedEntries, wordsToTick,
} from '../../reader/newWords';
import { rankFrequency } from '../../reader/frequency';
import { connection } from '../connection';
import { haptic } from '../haptics';
import { FrequencyMeter } from './FrequencyMeter';
import { Button, Divider, ErrorNote, Group, Help, Icon, Loading, Screen, SectionTitle, Tappable } from '../kit';
import { readable, space, type, useTheme } from '../theme';

/**
 * Suggested words for a language deck running low on new cards (src/reader/newWords.ts, server/reader's
 * word_suggestions.py): words from texts read, then common words the deck lacks. The ticked ones go to
 * the note queue, as Quick add's do, where Claude fills each one in; nothing reaches the deck until a
 * note is saved in the note editor. The x is Not interested: the server won't suggest the word again.
 */
export function SuggestedWords({ deck, name, language, perDay, api, loadDeck, held, onAdd, onDone }: {
  deck: string;
  /** The deck's own name, as the screen says it. */
  name: string;
  language: Language;
  /** The deck's own daily new card limit, for how many words start ticked. */
  perDay: number;
  api: Api;
  /** The deck's entries as the phone has them now, and its cards per note. */
  loadDeck: () => Promise<{ entries: Set<string>; perNote: number }>;
  /** Words held on the phone for Claude for this deck (`heldKeys`). */
  held: ReadonlySet<string>;
  onAdd: (language: Language, deck: string, entries: { entry: string; meaning: string }[]) => Promise<'queued' | 'held' | undefined>;
  onDone: () => void;
}) {
  const c = useTheme();
  const [found, setFound] = useState<{ words: WordSuggestions; entries: Set<string>; perNote: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [words, own] = await Promise.all([api.wordSuggestions(language), loadDeck()]);
      setFound({ words, ...own });
    } catch (e) {
      setLoadError(failureText(e, { what: "Couldn't load the suggested words.", next: 'Try again.' }));
    }
  }, [api, language, loadDeck]);
  useEffect(() => { void load(); }, [load]);

  const sections = useMemo(
    () => (found ? suggestionSections(found.words, found.entries, held, dismissed) : []),
    [found, held, dismissed],
  );
  // Ticked once, when the list first arrives; after that only the owner's taps change it.
  useEffect(() => {
    if (found && ticked === null) setTicked(firstTicked(sections, wordsToTick(perDay, found.perNote)));
  }, [found, sections, ticked, perDay]);
  const picked = ticked ?? new Set<string>();
  const count = sections.reduce((n, s) => n + s.words.filter((w) => picked.has(w.word)).length, 0);

  const toggle = (word: string) => {
    haptic.tap();
    setTicked((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(word)) next.delete(word); else next.add(word);
      return next;
    });
  };

  const dismiss = async (word: string) => {
    haptic.tap();
    setError(null);
    // Off the list at once; put back if the server didn't take it, so it isn't lost silently.
    setDismissed((prev) => new Set(prev).add(word));
    try {
      await api.dismissWord(language, word);
    } catch (e) {
      setDismissed((prev) => { const next = new Set(prev); next.delete(word); return next; });
      setError(failureText(e, { what: `Couldn't leave out ${word}.`, next: 'Try again.' }));
    }
  };

  const add = async () => {
    // A second tap while the request is out would queue every word twice.
    if (busyRef.current || !count) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const entries = tickedEntries(sections, picked);
    try {
      const added = await onAdd(language, deck, entries);
      if (added === 'held') {
        Alert.alert(
          entries.length === 1 ? 'Added 1 word' : `Added ${entries.length} words`,
          `${connection.offline() ? "You're offline, so they go to Claude when you're back online" : "Your server isn't answering, so they go to Claude once it does"}. Then they'll be ready to review on Today.`,
        );
      }
      onDone();
    } catch (e) {
      setError(failureText(e, { what: "Couldn't add these words.", next: 'Try again.' }));
      busyRef.current = false;
      setBusy(false);
    }
  };

  const footer = found ? (
    <Button
      label={count ? (count === 1 ? 'Add 1 word' : `Add ${count} words`) : 'Choose words to add'}
      onPress={add}
      busy={busy}
      disabled={!count}
    />
  ) : undefined;

  return (
    <Screen title="Suggested words" footer={footer}>
      {!found ? <Loading error={loadError} onRetry={load} /> : (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
          <Help>{`Words for ${name} that aren't in the deck yet. Claude fills in each word you add, then you check it and save it, as with Quick add.`}</Help>
          {sections.length ? sections.map((s) => (
            <View key={s.key} style={{ gap: space.s }}>
              <SectionTitle>{s.title}</SectionTitle>
              <Group accessibilityRole="list">
                {s.words.map((w, i) => {
                  const on = picked.has(w.word);
                  const detail = suggestionDetail(w);
                  const frequency = rankFrequency(w.rank);
                  return (
                    <View key={w.word} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingRight: space.xs }}>
                      {i ? <Divider inset={space.l + 24 + space.m} /> : null}
                      <Tappable
                        onPress={() => toggle(w.word)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={[w.word, detail, frequency.spoken].filter(Boolean).join(', ')}
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, paddingLeft: space.l }}
                      >
                        <Icon name={on ? 'checkmark.circle.fill' : 'circle'} size={24} color={on ? c.accent : c.controlEdge} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={{ ...type.body, color: c.text }}>{w.word}</Text>
                          {detail ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{detail}</Text> : null}
                        </View>
                        <FrequencyMeter frequency={frequency} />
                      </Tappable>
                      <Tappable
                        onPress={() => void dismiss(w.word)}
                        accessibilityRole="button"
                        accessibilityLabel={`Not interested in ${w.word}`}
                        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Icon name="xmark" size={13} color={c.textTertiary} />
                      </Tappable>
                    </View>
                  );
                })}
              </Group>
            </View>
          )) : <Help>{`There are no words to suggest for ${name} right now. Read a text and its new words will show here.`}</Help>}
          {error ? <ErrorNote message={error} /> : null}
          {sections.length ? <Help>The x leaves a word out of later suggestions too.</Help> : null}
        </ScrollView>
      )}
    </Screen>
  );
}
