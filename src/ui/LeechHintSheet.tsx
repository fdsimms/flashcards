import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from './haptics';
import { Button, ErrorNote, Field, Icon, Tappable } from './kit';
import { lift, MIN_TAP, radius, space, type, useTheme } from './theme';
import { failureText } from '../core/failure';

/**
 * Opens over the review screen when an answer makes a card a leech, asking for a hint to save in
 * the note's Mnemonic field (src/core/leechHint.ts). Skip leaves the card tagged and goes on.
 * `suggest` is present only while Read & Listen is signed in; it asks that server for ideas, and
 * only when the button is tapped.
 */
export function LeechHintSheet({ word, gloss, misses, suggest, onSave, onSkip }: {
  word: string;
  /** What the word means (with its transliteration), so the sheet makes sense without the card behind it. */
  gloss?: string;
  misses: number;
  suggest?: () => Promise<string[]>;
  /** Saves the hint on the note; throws when it can't, and the sheet says why. */
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
      setError(failureText(e, { what: "Couldn't save the hint.", next: 'Try again, or skip it.' }));
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onSkip}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.shadow, opacity: 0.45 }]} onPress={onSkip} accessibilityRole="button" accessibilityLabel="Skip" />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
        {/* Floats just above the bottom edge with every corner rounded, rather than running into the phone's own square-cut edge. */}
        <View style={{
          backgroundColor: c.surface, borderRadius: radius.xl, maxHeight: '85%',
          marginHorizontal: space.s, marginBottom: Math.max(insets.bottom, space.s),
          paddingTop: space.m, paddingBottom: space.l, ...lift(c, 'high'),
        }}>
          <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: c.textTertiary, opacity: 0.6, marginBottom: space.s }} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.l, gap: space.m }}>
            <View style={{ gap: space.xs }}>
              <Text style={{ ...type.headline, color: c.text }}>{`You've missed ${word} ${misses} times`}</Text>
              {gloss ? <Text style={{ ...type.callout, color: c.textSecondary }}>{gloss}</Text> : null}
            </View>
            <Text style={{ ...type.footnote, color: c.textSecondary }}>
              Write a hint to see on the back of this card next time. It's saved on the note and synced to Anki.
            </Text>
            <Field label="Hint" value={hint} onChangeText={setHint} placeholder="A sound-alike, a picture, anything that sticks" multiline autoFocus />
            {suggest ? (
              <Tappable onPress={ask} disabled={asking} accessibilityRole="button" accessibilityLabel="Suggest hints" accessibilityState={{ busy: asking, disabled: asking }} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: MIN_TAP }}>
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
