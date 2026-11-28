import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, ScrollView, Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import type { Api, JournalEntry, Language } from '../../reader/api';
import { asksAnotherTry, JOURNAL_MAX, kindPractice, withDraft, type Draft } from '../../reader/journal';
import { LANGUAGES } from '../../reader/languages';
import { CASE_LANGUAGES } from '../../tools/cases';
import { haptic } from '../haptics';
import { Button, ErrorNote, Field, Help, Icon, Loading, Screen, Tappable } from '../kit';
import { readable, radius, smooth, space, type, useTheme } from '../theme';
import { useKeyboardScroll } from '../useKeyboardScroll';
import { useNoteQueue } from '../useNoteQueue';
import { checkOrHold, journalDrafts, newEntryKey } from './journalWork';
import { JournalCorrections, JournalFirstTry } from './JournalParts';
import { recordPlanItem } from '../../tools/planStorage';

type Stage =
  | { kind: 'loading' }
  | { kind: 'write' }
  | { kind: 'held' }
  | { kind: 'first'; entry: JournalEntry }
  | { kind: 'corrections'; entry: JournalEntry };

const CASE_LANGUAGE_LIST = Object.keys(CASE_LANGUAGES) as Language[];

/**
 * One journal entry (src/reader/journal.ts), as a sheet: written, checked by Claude, tried once more with
 * the mistakes marked and hinted at, then shown corrected. `entryId` opens a kept entry at its corrections.
 * What's typed is kept as it's typed (journalDrafts), so leaving loses nothing; an entry checked while the
 * server can't be reached is held and checked later (checkOrHold). A word written in [brackets] comes back
 * filled in, with Add to deck to queue it for the deck. Nothing here grades a card.
 */
export function JournalEntryScreen({ api, onSay, language, entryId, prompt: givenPrompt, words, deck, toolbar }: {
  api: Api;
  /** Reads text aloud in the language with the phone's voice. */
  onSay: (text: string) => void;
  language: Language;
  entryId?: number;
  /** The idea written about, from the journal's home. */
  prompt?: string;
  /** Words being learned, to tap into the entry. */
  words: string[];
  /** The language's deck, for Add to deck; null when Read & Listen names none. */
  deck: string | null;
  toolbar: React.ReactNode;
}) {
  const c = useTheme();
  const router = useRouter();
  const info = LANGUAGES[language];
  const queue = useNoteQueue(api);
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const [stage, setStage] = useState<Stage>({ kind: entryId ? 'loading' : 'write' });
  const [draft, setDraft] = useState<Draft>({ language, text: '', prompt: givenPrompt ?? '', key: newEntryKey() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, 'adding' | 'added' | 'failed'>>({});
  const save = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A kept entry opens at its corrections; a new one goes on from the language's draft, if there is one.
  useEffect(() => {
    let live = true;
    if (entryId) {
      api.journalEntry(entryId).then(
        (entry) => { if (live) setStage({ kind: 'corrections', entry }); },
        (e) => { if (live) setError(failureText(e, { what: "Couldn't open the entry.", next: 'Try again.' })); },
      );
    } else {
      void journalDrafts.load().then(() => {
        const kept = journalDrafts.get().find((d) => d.language === language);
        if (live && kept?.text.trim()) setDraft(givenPrompt && !kept.prompt ? { ...kept, prompt: givenPrompt } : kept);
      });
    }
    return () => { live = false; };
  }, [api, entryId, language]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (save.current) clearTimeout(save.current); }, []);
  const keep = (next: Draft | null) => {
    if (save.current) clearTimeout(save.current);
    save.current = setTimeout(() => { void journalDrafts.update((list) => withDraft(list, language, next)); }, next ? 400 : 0);
  };
  const type_ = (text: string) => {
    const next = { ...draft, text };
    setDraft(next);
    keep(text.trim() ? next : null);
  };
  const addWord = (word: string) => type_(draft.text && !/\s$/.test(draft.text) ? `${draft.text} ${word}` : `${draft.text}${word}`);

  const check = async () => {
    const text = draft.text.trim();
    if (!text || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    try {
      const got = await checkOrHold(api, { key: draft.key, language, text, prompt: draft.prompt, entryId: draft.entryId });
      haptic.tap();
      // Today's plan's Write item (src/tools/plan.ts): an entry written, checked now or held to be.
      recordPlanItem('write', language);
      if (got === 'held') {
        keep(null);
        setStage({ kind: 'held' });
      } else if (asksAnotherTry(got)) {
        const next = { ...draft, text: got.text, entryId: got.id };
        setDraft(next);
        keep(next);
        setStage({ kind: 'first', entry: got });
      } else {
        keep(null);
        setStage({ kind: 'corrections', entry: got });
      }
    } catch (e) {
      setError(failureText(e, { what: "Couldn't check your entry.", next: 'Try again in a moment. It stays here as you wrote it.' }));
    } finally {
      setBusy(false);
    }
  };

  const showCorrections = (entry: JournalEntry) => {
    keep(null);
    setStage({ kind: 'corrections', entry });
  };

  const onKind = (kind: string, group: string) => {
    // A grammar point's id is `<language>.<name>`; a general kind ("word_order") has no dot.
    const practice = kindPractice({ group, point: kind.includes('.') ? kind : null }, CASE_LANGUAGE_LIST, language);
    if (practice === 'cases') router.push({ pathname: '/tool', params: { id: 'cases' } });
    else if (practice === 'point') router.push({ pathname: '/read-grammar-point', params: { id: kind } });
  };

  const add = async (word: string, english: string) => {
    if (!deck) return;
    setAdded((a) => ({ ...a, [word]: 'adding' }));
    try {
      await queue.add(language as Parameters<typeof queue.add>[0], deck, [{ entry: word, meaning: english }]);
      setAdded((a) => ({ ...a, [word]: 'added' }));
    } catch {
      setAdded((a) => ({ ...a, [word]: 'failed' }));
    }
  };

  const remove = (entry: JournalEntry) => {
    Alert.alert('Delete this entry?', "It's taken out of your journal, and its mistakes out of the counts.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          api.deleteJournalEntry(entry.id).then(
            () => router.back(),
            (e) => setError(failureText(e, { what: "Couldn't delete the entry.", next: 'Try again.' })),
          );
        },
      },
    ]);
  };

  const title = stage.kind === 'write' || stage.kind === 'held' ? (draft.entryId ? 'Try again' : 'New entry') : 'Entry';
  let body: React.ReactNode;
  if (stage.kind === 'loading') {
    body = error ? <ErrorNote message={error} /> : <Loading />;
  } else if (stage.kind === 'held') {
    body = (
      <View style={{ gap: space.m }}>
        <Help>Read & Listen can't be reached right now, so your entry is saved on this phone. It's checked as soon as it can be reached, and shows in your journal then.</Help>
        <Button label="Done" onPress={() => router.back()} />
      </View>
    );
  } else if (stage.kind === 'write') {
    body = (
      <View style={{ gap: space.m }}>
        {draft.prompt ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{draft.prompt}</Text> : null}
        <Field
          label={`Your entry in ${info.name}`}
          value={draft.text}
          onChangeText={type_}
          multiline
          maxLength={JOURNAL_MAX}
          autoCorrect={false}
          placeholder="e.g. what you did yesterday evening"
          keyboardLanguage={info.speech}
          style={{ minHeight: 180, textAlignVertical: 'top' }}
        />
        {words.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {words.map((w) => (
              <Tappable
                key={w}
                onPress={() => addWord(w)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${w} to the entry`}
                style={{ paddingHorizontal: space.m, paddingVertical: space.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}
              >
                <Text style={{ ...type.subhead, color: c.text }} accessibilityLanguage={info.speech}>{w}</Text>
              </Tappable>
            ))}
          </View>
        ) : null}
        <Help>{"Don't know a word? Write it in English in [brackets] and Claude puts it in."}</Help>
        {error ? <ErrorNote message={error} /> : null}
        <Button label="Check it" onPress={() => void check()} busy={busy} busyLabel="Checking" disabled={!draft.text.trim()} />
        <Text style={{ ...type.caption, color: c.textDim }}>{`${draft.text.length} of ${JOURNAL_MAX.toLocaleString('en-US')} characters. Kept as you type.`}</Text>
      </View>
    );
  } else if (stage.kind === 'first') {
    body = (
      <View style={{ gap: space.m }}>
        <JournalFirstTry check={stage.entry.check} lang={info.speech} />
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <View style={{ flex: 1 }}><Button label="Show the corrections" variant="secondary" onPress={() => showCorrections(stage.entry)} /></View>
          <View style={{ flex: 1 }}><Button label="Try again" onPress={() => setStage({ kind: 'write' })} /></View>
        </View>
      </View>
    );
  } else {
    const { entry } = stage;
    const corrected = entry.check.sentences.map((s) => s.corrected).join(' ');
    body = (
      <View style={{ gap: space.m }}>
        <JournalCorrections
          check={entry.check}
          lang={info.speech}
          onPlay={() => onSay(corrected)}
          onKind={onKind}
        />
        {entry.check.filled.map((f) => {
          const state = added[f.word];
          return (
            <View key={f.word} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.m, ...smooth, padding: space.m }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.headline, color: c.text }} accessibilityLanguage={info.speech}>{f.word}</Text>
                <Text style={{ ...type.footnote, color: c.textSecondary }}>{state === 'failed' ? "Couldn't add it. Try again." : f.english}</Text>
              </View>
              {deck ? (
                state === 'added' ? <Icon name="checkmark.circle.fill" size={22} color={c.goodInk} /> : (
                  <Button label="Add to deck" variant="secondary" onPress={() => void add(f.word, f.english)} busy={state === 'adding'} />
                )
              ) : null}
            </View>
          );
        })}
        {error ? <ErrorNote message={error} /> : null}
        <Button label="Done" onPress={() => router.back()} />
        {entryId ? <Button label="Delete entry" variant="destructive" onPress={() => remove(entry)} /> : null}
      </View>
    );
  }

  return (
    <Screen title={title} largeTitle={false} toolbar={toolbar}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.l + bottomPadding, gap: space.m }}
        {...scrollProps}
      >
        {body}
      </ScrollView>
    </Screen>
  );
}
