import React, { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, View, useColorScheme, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { failureText } from '../../core/failure';
import type { Api, FormExplanation, Language, Word } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { checkForm, formReason, markDecider, type FormCheck, type Settled } from '../../reader/formQuiz';
import { usePrimers } from './ReadFormSheet';
import { Button, HeaderAction, Icon, Tappable } from '../kit';
import { useKeyboardLanguage } from '../useKeyboardLanguage';
import { MIN_TAP, radius, smooth, space, type, useTheme } from '../theme';
import { MissingKeyboardNote } from '../useMissingKeyboard';

/**
 * The sheet a fill-in slot opens (reader/formQuiz.ts): the line with a blank where the word is, the
 * word's dictionary form, and a field for the form that fits. Check says right or what the text has,
 * and why (the form's name, and the word of the line that goes with it). Practice only: nothing is
 * graded, rated or saved, and a miss changes no card's schedule. Skip, a right answer or Done ends the
 * slot, so the text shows the word; closing the sheet any other way leaves it open. After a miss,
 * Explain asks Claude on the server why the line has that form (api.explainForm, kept per word),
 * only on the tap, and shows it as the line with the deciding word marked, the change as before and
 * after, and a tip, not as paragraphs.
 */
export function ReaderFormQuiz({ api, language, textId, line, word, before, after, onSettle, onClose }: {
  api: Api;
  /** The text's language, for the keyboard the form is typed on. */
  language: Language;
  textId: number;
  line: number;
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
  const keyboardLang = useKeyboardLanguage(LANGUAGES[language].speech);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<FormCheck | null>(null);
  const checked = result !== null && result !== 'empty';
  const right = result === 'right';
  const tint = right ? c.countDue : checked ? c.danger : c.accent;

  // Why the line has this form: asked on the tap, and an answer that arrives after the sheet is closed is dropped.
  const [why, setWhy] = useState<{ state: 'loading' } | { state: 'done'; explanation: FormExplanation } | { state: 'failed'; message: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const explain = async () => {
    if (why?.state === 'loading') return;
    setWhy({ state: 'loading' });
    try {
      const explanation = await api.explainForm(textId, line, word);
      if (alive.current) setWhy({ state: 'done', explanation });
    } catch (e) {
      if (alive.current) setWhy({ state: 'failed', message: failureText(e, { what: "Couldn't explain this form.", next: 'Try again.' }) });
    }
  };

  // The latest text, written the moment the field reports it. With an IME (kana), the first tap on
  // Check commits the composition while the render's `typed` is still the old value, so Check read
  // an empty field (and was disabled) and the tap did nothing until a second one.
  const latest = useRef('');
  const check = () => {
    const found = checkForm(latest.current, word, language);
    if (found === 'empty') input.current?.focus();
    else setResult(found);
  };
  const again = () => {
    setResult(null);
    setWhy(null);
    input.current?.focus();
  };
  const reason = formReason(word);
  // What the form means, from the same fixed text as the form chip's sheet; left out until it has loaded.
  const { primers } = usePrimers(api, language);
  const meaning = word.form ? primers?.find((p) => p.id === word.form?.id)?.summary : undefined;
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

        <View style={{ gap: space.xs }}>
          <Text style={{ ...type.subhead, color: c.textSecondary }}>Fill in the blank with the right form of this word:</Text>
          <Text style={{ ...type.cardBack, color: c.accent }}>
            {word.lemma}
            {word.gloss ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{`   "${word.gloss}"`}</Text> : null}
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
            {...keyboardLang}
            value={typed}
            onChangeText={(t) => { latest.current = t; setTyped(t); if (result) setResult(null); }}
            editable={!checked}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="done"
            onSubmitEditing={check}
            accessibilityLabel={`Type the form of ${word.lemma} that fills the blank`}
            placeholder="Type the word for the blank"
            placeholderTextColor={c.textTertiary}
            selectionColor={c.accent}
            keyboardAppearance={dark ? 'dark' : 'light'}
            style={{ ...type.reading, flex: 1, color: c.text, paddingVertical: space.s }}
          />
          {checked ? <Icon name={right ? 'checkmark' : 'xmark'} size={18} color={tint} weight="bold" /> : null}
        </View>
        <MissingKeyboardNote speechTag={LANGUAGES[language].speech} />

        {checked ? (
          <View accessibilityLiveRegion="polite" style={{ gap: space.xs }}>
            <Text style={{ ...type.headline, color: tint }}>
              {right ? 'Right' : result === 'accents' ? `The letters are right, but the accents aren't. The text has "${word.text}".` : `The text has "${word.text}".`}
            </Text>
            {reason ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{reason}</Text> : null}
            {meaning ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{meaning}</Text> : null}
          </View>
        ) : null}

        {checked && !right ? (
          <View style={{ gap: space.s }}>
            {why?.state !== 'done' ? (
              <Tappable
                accessibilityRole="button"
                onPress={explain}
                disabled={why?.state === 'loading'}
                hitSlop={{ top: space.s, bottom: space.s }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start' }}
              >
                <Icon name="sparkles" size={18} color={c.accent} />
                <Text style={{ ...type.headline, color: c.accent }}>{why?.state === 'loading' ? 'Explaining...' : why?.state === 'failed' ? 'Try explaining again' : 'Explain why'}</Text>
              </Tappable>
            ) : null}
            {why?.state === 'failed' ? <Text style={{ ...type.subhead, color: c.danger }}>{why.message}</Text> : null}
            {why?.state === 'done' ? <FormWhy word={word} before={before} after={after} explanation={why.explanation} /> : null}
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
              <Button label="Check" onPress={check} style={{ flex: 1 }} />
            </>
          )}
        </View>
      </ScrollView>
    </Modal>
  );
}

/**
 * Why the form: the line with the deciding word marked and the answer in its place, what that word does,
 * the change as before and after chips, and a tip. The server keeps each part short (explain.py, clean_form).
 */
function FormWhy({ word, before, after, explanation }: { word: Word; before: string; after: string; explanation: FormExplanation }) {
  const c = useTheme();
  const pieces = markDecider(before, after, explanation.deciding);
  const sentence = (parts: { text: string; mark: boolean }[]) =>
    parts.map((p, i) => (p.mark
      ? <Text key={i} style={{ backgroundColor: c.accentFill, color: c.accentInk, fontWeight: '600' }}>{p.text}</Text>
      : p.text));
  const chip = (text: string, tone: 'plain' | 'accent' | 'answer') => (
    <View style={{ borderRadius: radius.s, ...smooth, paddingHorizontal: space.m, paddingVertical: space.s, backgroundColor: tone === 'answer' ? c.dangerFill : tone === 'accent' ? c.accentFill : c.surface }}>
      <Text style={{ ...type.headline, color: tone === 'answer' ? c.danger : tone === 'accent' ? c.accentInk : c.text }}>{text}</Text>
    </View>
  );
  return (
    <View accessibilityLiveRegion="polite" style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, padding: space.m, gap: space.m }}>
      <Text style={{ ...type.overline, color: c.textSecondary }}>Why {word.text}</Text>
      <Text style={{ ...type.reading, color: c.text }}>
        {sentence(pieces.before)}
        <Text style={{ color: c.danger, fontWeight: '600', textDecorationLine: 'underline' }}>{word.text}</Text>
        {sentence(pieces.after)}
      </Text>
      <Text style={{ ...type.body, color: c.text }}>{explanation.rule}</Text>
      {explanation.changes.map((change, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.s }}>
          {chip(change.before, 'plain')}
          <Icon name="arrow.right" size={14} color={c.textSecondary} />
          {chip(change.after, i === 0 ? 'answer' : 'accent')}
        </View>
      ))}
      {explanation.tip ? (
        <Text style={{ ...type.body, color: c.text }}>
          <Text style={{ fontWeight: '600', color: c.accentInk }}>Check  </Text>
          {explanation.tip}
        </Text>
      ) : null}
    </View>
  );
}
