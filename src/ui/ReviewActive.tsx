import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Text, TextInput, View, useColorScheme } from 'react-native';
import { withMnemonic } from '../core/leechHint';
import { failureText } from '../core/failure';
import type { Note } from '../core/types';
import { saveNote, type NoteStore } from '../anki/noteService';
import type { Repo } from '../db/repo';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

/**
 * Review's asks for producing rather than recognizing (src/core/activeRecall.ts): the Type it
 * button beside Show answer on a reverse card, and the field for the learner's own hook on a new
 * word's first answer side. In a file of their own so Review only places them.
 */

/** Beside Show answer: opens a box to type the word before the answer is shown. */
export function TypeItButton({ onPress }: { onPress: () => void }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel="Type it"
      accessibilityHint="Type the word before the answer is shown, to compare with it"
      scaleTo={0.98}
      dimTo={0.85}
      style={{
        minHeight: 52, borderRadius: radius.m + 2, ...smooth, paddingHorizontal: space.l,
        flexDirection: 'row', alignItems: 'center', gap: space.s, backgroundColor: c.fill,
      }}
    >
      <Icon name="keyboard" size={18} color={c.text} />
      <Text style={{ ...type.headline, fontWeight: '400', color: c.text }}>Type it</Text>
    </Tappable>
  );
}

/**
 * The learner's own hook for a word: whether it's asked (Settings, Review), what's typed so far,
 * and saving it to the note's Mnemonic once the card is answered. Cleared for each card shown.
 */
export function useOwnHook(repo: Repo, showing: string | undefined, onSaved: (note: Note) => void) {
  const [on, setOn] = useState(false);
  const [text, setText] = useState('');
  useEffect(() => { repo.askOwnHook().then(setOn).catch(() => setOn(false)); }, [repo]);
  useEffect(() => { setText(''); }, [showing]);
  // Read in `answered`, which runs from an answer's closure after its awaits.
  const latest = useRef(text);
  latest.current = text;
  // After the answer is saved: the hook goes into Mnemonic as the leech hint does. A failure leaves the answer as it is.
  const answered = useCallback(async (note: Note) => {
    const hint = latest.current.trim();
    if (!hint) return;
    setText('');
    try {
      // The note as it is now: the answer may have changed it (a tag) since the card was shown.
      const now = (await repo.getNote(note.id)) ?? note;
      const saved = await saveNote(repo as NoteStore, { id: now.id, deck: now.deck, model: now.model, fields: withMnemonic(now.fields, hint), tags: now.tags });
      onSaved(saved);
    } catch (e) {
      Alert.alert("Couldn't save your hook", failureText(e, { next: `The answer is saved. Add the hook in the note editor: "${hint}"` }));
    }
  }, [repo, onSaved]);
  return { on, text, setText, answered };
}

/** On the answer side of a new word seen for the first time: an optional line for one's own mnemonic. */
export function OwnHookField({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  return (
    <View style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, padding: space.m, gap: space.s }}>
      <Text style={{ ...type.subhead, fontWeight: '600', color: c.text }}>
        Your own hook <Text style={{ fontWeight: '400', color: c.textSecondary }}>(optional)</Text>
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline
        placeholder="A picture, a sound-alike, a word it reminds you of"
        accessibilityLabel="Your own hook for this word"
        placeholderTextColor={c.textTertiary}
        selectionColor={c.accent}
        keyboardAppearance={dark ? 'dark' : 'light'}
        style={{
          ...type.callout, color: c.text, backgroundColor: c.surface, ...smooth, borderRadius: radius.s,
          borderWidth: hairline, borderColor: c.border, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP,
        }}
      />
      <Text style={{ ...type.caption, color: c.textSecondary }}>
        Saved to the note's Mnemonic when you answer, and shown on the back from then on. Asked only the first time you see a new word.
      </Text>
    </View>
  );
}
