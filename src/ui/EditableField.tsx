import React, { useEffect, useState, type ReactNode } from 'react';
import { Text, TextInput, useColorScheme, View } from 'react-native';
import { failureText } from '../core/failure';
import { haptic } from './haptics';
import { Button, ErrorNote, Icon, Tappable } from './kit';
import { MIN_TAP, hairline, radius, smooth, space, type, useTheme } from './theme';

/**
 * A card's Mnemonic or Notes block, with an edit icon that turns it into a text box in place. Not editing,
 * it draws `children` (the block as the card shows it) with the icon (the one the review screen's
 * "Edit this card's note" button uses) in the box's bottom right corner; the box reserves room for it
 * with `EDIT_ICON_ROOM`, so text never runs under it; editing, it replaces them with the box and Cancel and Save. `onSave`
 * writes the note; when it throws, the box stays open with what was typed and the reason under it.
 * `onEditing` says whether the box is open, so the card can stop a swipe from rating it meanwhile.
 */
/** Right padding a block's box takes so its text clears the edit icon. */
export const EDIT_ICON_ROOM = space.xl + space.m;

export function EditableField({ label, text, onSave, onEditing, children }: {
  label: string;
  /** What the block shows now: the box starts with it. */
  text: string;
  onSave: (text: string) => Promise<void>;
  onEditing?: (editing: boolean) => void;
  children: ReactNode;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Told while the box is open, and when it closes with the card (each card's Side is keyed to it).
  useEffect(() => {
    if (!editing) return;
    onEditing?.(true);
    return () => onEditing?.(false);
  }, [editing, onEditing]);

  const open = () => { haptic.tap(); setDraft(text); setError(null); setEditing(true); };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e) {
      setError(failureText(e, { what: "Couldn't save the note.", next: 'What you typed is still here. Try again.' }));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <View>
        {children}
        <Tappable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${label.toLowerCase()}`}
          onPress={open}
          hitSlop={space.s}
          scaleTo={0.9}
          style={{ position: 'absolute', bottom: 0, right: 0, width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="square.and.pencil" size={16} color={c.textTertiary} />
        </Tappable>
      </View>
    );
  }

  return (
    <View style={{ gap: space.s }}>
      <Text style={{ ...type.overline, color: c.accent }}>{label}</Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        multiline
        autoFocus
        editable={!saving}
        accessibilityLabel={label}
        placeholderTextColor={c.textTertiary}
        selectionColor={c.accent}
        keyboardAppearance={dark ? 'dark' : 'light'}
        style={{
          ...type.body, color: c.text, backgroundColor: c.fill, ...smooth, borderRadius: radius.m,
          borderWidth: hairline, borderColor: c.accent, paddingHorizontal: space.m, paddingVertical: space.s + 2, minHeight: MIN_TAP, textAlignVertical: 'top',
        }}
      />
      {error ? <ErrorNote message={error} /> : null}
      <Text style={{ ...type.caption, color: c.textSecondary }}>Saved to the note, so every card of this word shows it.</Text>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button label="Cancel" variant="secondary" disabled={saving} onPress={() => setEditing(false)} style={{ flex: 1 }} />
        <Button label="Save" busy={saving} onPress={save} style={{ flex: 1 }} />
      </View>
    </View>
  );
}
