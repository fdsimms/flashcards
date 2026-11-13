import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from './haptics';
import { Button, ErrorNote, Field, Icon, Tappable } from './kit';
import { lift, radius, space, type, useTheme } from './theme';
import { failureText } from '../core/failure';

/**
 * Opens over the review screen when an answer makes a card a leech, asking for a hint to save in
 * the note's Mnemonic field (src/core/leechHint.ts). Skip leaves the card tagged and goes on.
 * `suggest` is present only while Read & Listen is signed in; it asks that server for ideas, and
 * only when the button is tapped.
 */
export function LeechHintSheet({ word, misses, suggest, onSave, onSkip }: {
  word: string;
  misses: number;
  suggest?: () => Promise<string[]>;
  /** Saves the hint on the note; throws with a sentence to show when it can't. */
  onSave: (hint: string) => Promise<void>;
  onSkip: () => void;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [hint, setHint] = useState('');
  const [ideas, setIdeas] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    if (!suggest || asking) return;
    haptic.tap();
    setAsking(true);
    setError(null);
    try {
      setIdeas(await suggest());
    } catch (e) {
      setError(failureText(e, { what: "Couldn't suggest hints.", next: 'Try again, or write your own.' }));
    } finally {
      setAsking(false);
    }
  };

  const save = async () => {
    if (saving || !hint.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(hint);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onSkip}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.shadow, opacity: 0.45 }]} onPress={onSkip} accessibilityLabel="Skip" />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
        <View style={{
          backgroundColor: c.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '85%',
          paddingTop: space.m, paddingBottom: Math.max(insets.bottom, space.l), ...lift(c, 'high'),
        }}>
          <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: c.textTertiary, opacity: 0.6, marginBottom: space.s }} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.l, gap: space.m }}>
            <Text style={{ ...type.headline, color: c.text }}>{`You've missed ${word} ${misses} times`}</Text>
            <Text style={{ ...type.footnote, color: c.textSecondary }}>
              Write a hint to see on the back of this card next time. It's saved on the note and synced to Anki.
            </Text>
            <Field label="Hint" value={hint} onChangeText={setHint} placeholder="A sound-alike, a picture, anything that sticks" multiline autoFocus />
            {suggest ? (
              <Tappable onPress={ask} disabled={asking} accessibilityRole="button" accessibilityLabel="Suggest hints" style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 36 }}>
                <Icon name="sparkles" size={18} color={c.accent} />
                <Text style={{ ...type.callout, fontWeight: '600', color: c.accent }}>{asking ? 'Asking Claude…' : ideas.length ? 'Suggest more hints' : 'Suggest hints'}</Text>
              </Tappable>
            ) : null}
            {ideas.map((idea) => (
              <Tappable
                key={idea}
                onPress={() => { haptic.select(); setHint(idea); }}
                accessibilityRole="button"
                accessibilityLabel={`Use this hint: ${idea}`}
                style={{ backgroundColor: c.accentFill, borderRadius: radius.m, paddingHorizontal: space.m, paddingVertical: space.s }}
              >
                <Text style={{ ...type.subhead, color: c.text }}>{idea}</Text>
              </Tappable>
            ))}
            {error ? <ErrorNote message={error} /> : null}
            <View style={{ flexDirection: 'row', gap: space.m }}>
              <Button label="Skip" variant="secondary" onPress={onSkip} style={{ flex: 1 }} disabled={saving} />
              <Button label="Save hint" onPress={save} style={{ flex: 1 }} busy={saving} disabled={!hint.trim()} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
