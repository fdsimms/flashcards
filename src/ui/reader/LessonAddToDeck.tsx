import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { sendRecording, type RecordDeps } from '../../anki/recordService';
import { sha1Hex } from '../../anki/sha1';
import type { Api, AudioLesson, Language } from '../../reader/api';
import { firstChosen, hasClips, lessonClipName, lessonPhraseNote, phrasesToOffer, type OfferedPhrase } from '../../reader/lessonCards';
import type { MinedNote } from '../../reader/mining';
import { LANGUAGES } from '../../reader/languages';
import { failureText } from '../../core/failure';
import { withThaiLineHeight } from '../../core/script';
import { hasMedia, removeMedia, writeMedia } from '../../media/mediaFiles';
import type { NoteEditorResult } from '../AppContext';
import { haptic } from '../haptics';
import { Button, Divider, ErrorNote, Group, Help, Icon, Loading, Screen, Tag } from '../kit';
import { MIN_TAP, space, type, useTheme, readable } from '../theme';
import { HoverPressable } from '../hover';

/**
 * Add a lesson's phrases to the deck (docs/read-and-listen/architecture.md, Audio lessons): the
 * phrases, with those the deck has already marked and left unchosen; then the note editor for each
 * chosen one in turn, filled in with the phrase, its meaning and the lesson's recording of it.
 * Saving in the editor is the approval; closing it skips that phrase. A recording kept for a phrase
 * that wasn't saved is deleted again.
 */
export function LessonAddToDeck({ api, lesson, language, deck, recorder, loadEntries, edit, onDone }: {
  api: Api;
  lesson: AudioLesson;
  language: Language;
  deck: string;
  /** The media folder and the list of files the next sync sends, as recording a card uses them. */
  recorder: RecordDeps;
  /** The deck's entries, as newWords.entryKeys makes them. */
  loadEntries: () => Promise<Set<string>>;
  /** Opens the note editor on a note, resolving to how it closed. */
  edit: (note: MinedNote) => Promise<NoteEditorResult | undefined>;
  onDone: () => void;
}) {
  const c = useTheme();
  const [offered, setOffered] = useState<OfferedPhrase[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clips = hasClips(lesson);

  const load = () => {
    setLoadError(null);
    loadEntries().then((entries) => {
      const list = phrasesToOffer(lesson, entries);
      setOffered(list);
      setChosen(firstChosen(list));
    }, (e) => setLoadError(failureText(e, { what: "Couldn't read your deck.", next: 'Try again.' })));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on opening

  const toggle = (index: number) => {
    haptic.select();
    setChosen((now) => {
      const next = new Set(now);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const add = async () => {
    if (!offered || adding !== null) return;
    const queue = offered.filter((p) => chosen.has(p.index));
    setError(null);
    let failed: string | null = null;
    for (const [n, phrase] of queue.entries()) {
      setAdding(n);
      let audio: { name: string; sha1: string; fresh: boolean } | null = null;
      if (clips) {
        try {
          const bytes = await api.lessonPhraseAudio(lesson.id, phrase.index);
          const name = lessonClipName(bytes);
          const fresh = !hasMedia(name);
          if (fresh) await writeMedia(name, bytes);
          audio = { name, sha1: sha1Hex(bytes), fresh };
        } catch (e) {
          // The note still opens, saying under Audio why there's no recording.
          failed ??= failureText(e, { what: "Couldn't fetch the lesson's recording of a phrase.", next: 'Those phrases opened without it; record them from the note later.' });
        }
      }
      const result = await edit(lessonPhraseNote(phrase, deck, language, audio?.name ?? null));
      const saved = !!result && 'saved' in result && !!result.saved;
      if (audio && saved) await sendRecording(recorder, audio).catch(() => undefined);
      else if (audio?.fresh) removeMedia(audio.name);
    }
    setAdding(null);
    if (failed) setError(failed);
    else onDone();
  };

  const count = chosen.size;
  return (
    <Screen title="Add to deck">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
        <Help>
          {`Choose the phrases to study as cards in ${LANGUAGES[language].name}. Each opens in the note editor`}
          {clips ? ' with its recording from the lesson.' : ". This is an older lesson, so they come without its recording."}
        </Help>
        {offered === null ? <Loading error={loadError} onRetry={load} /> : (
          <Group accessibilityRole="list">
            {offered.map((p, i) => {
              const on = chosen.has(p.index);
              return (
                <HoverPressable
                  key={p.index}
                  onPress={() => toggle(p.index)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${p.text}, ${p.english}${p.inDeck ? ', already in your deck' : ''}`}
                  style={({ pressed }) => ({ minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, paddingHorizontal: space.l, backgroundColor: pressed ? c.fill : c.surface })}
                >
                  {i === 0 ? null : <Divider inset={space.l} />}
                  <Icon name={on ? 'checkmark.circle.fill' : 'circle'} size={22} color={on ? c.accent : c.textTertiary} weight="regular" />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ ...withThaiLineHeight(type.body, p.text), color: c.text }}>{p.text}</Text>
                    <Text style={{ ...type.footnote, color: c.textSecondary }}>{p.english}</Text>
                  </View>
                  {p.inDeck ? <Tag text="In deck" color={c.goodInk} fill={c.goodFill} /> : null}
                </HoverPressable>
              );
            })}
          </Group>
        )}
        {error ? <ErrorNote message={error} /> : null}
        <Button
          label={adding !== null ? `Adding ${adding + 1} of ${count}` : count ? `Add ${count} to ${LANGUAGES[language].name}` : 'Choose phrases to add'}
          onPress={add}
          busy={adding !== null}
          disabled={!count}
        />
      </ScrollView>
    </Screen>
  );
}
