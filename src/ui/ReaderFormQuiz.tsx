import React, { useRef, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, View, useColorScheme, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Word } from '../reader/api';
import { checkForm, formReason, type FormCheck, type Settled } from '../reader/formQuiz';
import { Button, HeaderAction, Icon } from './kit';
import { MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

/**
 * The sheet a fill-in slot opens (reader/formQuiz.ts): the line with a blank where the word is, the
 * word's dictionary form, and a field for the form that fits. Check says right or what the text has,
 * and why (the form's name, and the word of the line that goes with it). Practice only: nothing is
 * graded, rated or saved, and a miss changes no card's schedule. Skip, a right answer or Done ends the
 * slot, so the text shows the word; closing the sheet any other way leaves it open.
 */
export function ReaderFormQuiz({ word, before, after, onSettle, onClose }: {
  word: Word;
  before: string;
  after: string;
  onSettle: (result: Settled) => void;
  onClose: () => void;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const input = useRef<TextInputInstance>(null);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<FormCheck | null>(null);
  const checked = result !== null && result !== 'empty';
  const right = result === 'right';
  const tint = right ? c.countDue : checked ? c.danger : c.accent;

  const check = () => {
    const found = checkForm(typed, word);
    if (found !== 'empty') setResult(found);
  };
  const again = () => {
    setResult(null);
    input.current?.focus();
  };
  const reason = formReason(word);
  const sentence = { ...type.reading, color: c.text };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} backdropColor={c.surface}>
      <ScrollView
        style={{ flex: 1, backgroundColor: c.surface }}
        contentContainerStyle={{ paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: Math.max(insets.bottom, space.l), gap: space.l }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.m }}>
          <Text accessibilityRole="header" style={{ ...type.overline, color: c.textSecondary }}>Practice the form</Text>
          <HeaderAction label="Close" onPress={onClose} />
        </View>

        <Text style={sentence}>
          {before}
          <Text style={{ color: tint, fontWeight: '600', textDecorationLine: 'underline' }}>{checked && !right ? word.text : typed.trim() || '   '}</Text>
          {after}
        </Text>

        <View style={{ gap: 2 }}>
          <Text style={{ ...type.cardBack, color: c.accent }}>{word.lemma}</Text>
          <Text style={{ ...type.subhead, color: c.textSecondary }}>
            {word.gloss ? `${word.gloss}. ` : ''}Type the form that fits the sentence.
          </Text>
        </View>

        <View
          style={{
            flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: MIN_TAP + space.s, ...smooth, borderRadius: radius.m,
            paddingHorizontal: space.m, borderWidth: 1.5,
            backgroundColor: right ? c.goodFill : checked ? c.dangerFill : c.fill,
            borderColor: right ? c.countDue : checked ? c.danger : 'transparent',
          }}
        >
          <TextInput
            ref={input}
            value={typed}
            onChangeText={(t) => { setTyped(t); if (result) setResult(null); }}
            editable={!checked}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="done"
            onSubmitEditing={check}
            accessibilityLabel={`Type the form of ${word.lemma} that fits the sentence`}
            placeholder="Type the form"
            placeholderTextColor={c.textTertiary}
            selectionColor={c.accent}
            keyboardAppearance={dark ? 'dark' : 'light'}
            style={{ ...type.reading, flex: 1, color: c.text, paddingVertical: space.s }}
          />
          {checked ? <Icon name={right ? 'checkmark' : 'xmark'} size={18} color={tint} weight="bold" /> : null}
        </View>

        {checked ? (
          <View accessibilityLiveRegion="polite" style={{ gap: space.xs }}>
            <Text style={{ ...type.headline, color: tint }}>
              {right ? 'Right' : result === 'accents' ? `The letters are right, but the accents aren't. The text has ${word.text}` : `The text has ${word.text}`}
            </Text>
            {reason ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{reason}</Text> : null}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: space.m }}>
          {checked && !right ? (
            <>
              <Button label="Try again" variant="secondary" onPress={again} style={{ flex: 1 }} />
              <Button label="Done" onPress={() => onSettle('missed')} style={{ flex: 1 }} />
            </>
          ) : right ? (
            <Button label="Done" onPress={() => onSettle('right')} style={{ flex: 1 }} />
          ) : (
            <>
              <Button label="Skip" variant="secondary" onPress={() => onSettle('skipped')} style={{ flex: 1 }} />
              <Button label="Check" onPress={check} disabled={!typed.trim()} style={{ flex: 1 }} />
            </>
          )}
        </View>

        <Text style={{ ...type.footnote, color: c.textSecondary }}>Practice only. It doesn't change any card's schedule.</Text>
      </ScrollView>
    </Modal>
  );
}
