import React, { useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from './haptics';
import { Button, ErrorNote, Field, Icon, Tappable } from './kit';
import { MIN_TAP, radius, space, type, useTheme } from './theme';
import { failureText } from '../core/failure';

/**
 * Opens over the review screen when an answer makes a card a leech, asking for a hint to save in
 * the note's Mnemonic field (src/core/leechHint.ts). Skip leaves the card tagged and goes on.
 * When the deck's options suspended the card (`suspended`), the sheet says so, and saving a hint
 * also unsuspends it (`saveLeechHint`), so the hint gets its chance; Skip leaves it suspended.
 * `suggest` is present only while Read & Listen is signed in; it asks that server for ideas, and
 * only when the button is tapped.
 *
 * It's iOS's own page sheet: the screen behind it recedes and dims, and a swipe down skips it, as
 * Skip does. Not while a hint is written or being saved: then the sheet springs back, as iOS
 * does for a sheet with changes that would be lost.
 */
export function LeechHintSheet({ word, gloss, misses, suspended, suggest, onSave, onSkip }: {
  word: string;
  /** What the word means (with its transliteration), so the sheet makes sense without the card behind it. */
  gloss?: string;
  /** How many times the card was missed; absent when the sheet was opened by hand from the review screen, which retitles it and calls the way out Cancel. */
  misses?: number;
  /** The answer suspended the card, as the deck's options say for a leech; saving a hint unsuspends it. */
  suspended?: boolean;
  suggest?: () => Promise<string[]>;
  /** Saves the hint on the note (and unsuspends the card, when `suspended`); throws when it can't, and the sheet says why. */
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

  // A swipe that iOS refuses (allowSwipeDismissal off) also calls onRequestClose, so it checks the same thing.
  const swipeSkips = !saving && !hint.trim();
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      allowSwipeDismissal={swipeSkips}
      onRequestClose={() => { if (swipeSkips) onSkip(); }}
      backdropColor={c.surface}
    >
      {/* The sheet sits below the screen's top, so the keyboard's overlap is measured natively (a KeyboardAvoidingView reads its own layout, not the window, and pads too little). */}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        style={{ flex: 1, backgroundColor: c.surface }}
        contentContainerStyle={{ paddingHorizontal: space.l, paddingTop: space.xl, paddingBottom: Math.max(insets.bottom, space.l), gap: space.m }}
      >
        <View style={{ gap: space.xs }}>
          <Text style={{ ...type.headline, color: c.text }}>{misses === undefined ? `Mnemonic for ${word}` : `You've missed ${word} ${misses} times`}</Text>
          {gloss ? <Text style={{ ...type.callout, color: c.textSecondary }}>{gloss}</Text> : null}
        </View>
        {suspended ? (
          <Text style={{ ...type.footnote, color: c.textSecondary }}>
            This card is now suspended, as this deck's options say for a leech. Save a hint to see on the back of this card, and the card goes back into your reviews. The hint is saved on the note and synced to Anki. If you skip, the card stays suspended.
          </Text>
        ) : (
          <Text style={{ ...type.footnote, color: c.textSecondary }}>
            Write a hint to see on the back of this card next time. It's saved on the note and synced to Anki. Swipe down to skip.
          </Text>
        )}
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
        {suspended ? (
          // The longer label gets the whole width, the main action on top.
          <View style={{ gap: space.s }}>
            <Button label="Save hint and keep studying" onPress={save} busy={saving} disabled={!hint.trim()} />
            <Button label="Skip" variant="secondary" onPress={onSkip} disabled={saving} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: space.m }}>
            <Button label={misses === undefined ? 'Cancel' : 'Skip'} variant="secondary" onPress={onSkip} style={{ flex: 1 }} disabled={saving} />
            <Button label="Save hint" onPress={save} style={{ flex: 1 }} busy={saving} disabled={!hint.trim()} />
          </View>
        )}
      </ScrollView>
    </Modal>
  );
}
