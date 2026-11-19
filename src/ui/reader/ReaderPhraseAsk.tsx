import React, { useRef, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View, type TextInputInstance } from 'react-native';
import type { AskTurn } from '../../core/askCard';
import { haptic } from '../haptics';
import { ErrorNote, Icon, Tappable } from '../kit';
import { hairline, MIN_TAP, radius, space, type, useTheme, smooth } from '../theme';
import { AskingText } from '../AskingText';

/** The questions asked about the phrase and the answers, under its explanation. */
export function PhraseThread({ turns, asking, error, onRetry }: { turns: AskTurn[]; asking: boolean; error: string | null; onRetry?: () => void }) {
  const c = useTheme();
  if (!turns.length) return null;
  return (
    <View style={{ gap: space.s, borderTopWidth: hairline, borderTopColor: c.border, paddingTop: space.s }}>
      {turns.map((t, i) => (
        t.role === 'user' ? (
          <View key={i} style={{ alignSelf: 'flex-end', backgroundColor: c.accentFill, borderRadius: radius.m, ...smooth, paddingHorizontal: space.m, paddingVertical: space.s, maxWidth: '88%' }}>
            <Text style={{ ...type.subhead, color: c.text }}>{t.content}</Text>
          </View>
        ) : (
          <Text key={i} selectable style={{ ...type.subhead, color: c.text }}>{t.content}</Text>
        )
      ))}
      {asking ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <ActivityIndicator color={c.accent} />
          <AskingText style={{ ...type.subhead, color: c.textSecondary }} />
        </View>
      ) : null}
      {error ? <ErrorNote message={error} onRetry={onRetry} /> : null}
    </View>
  );
}

/** The field a question is typed in, at the bottom of the popup. Sends on the arrow or the keyboard's Send. */
export function PhraseAskField({ asking, followUp, onSend }: { asking: boolean; followUp: boolean; onSend: (question: string) => Promise<boolean> }) {
  const c = useTheme();
  const [text, setText] = useState('');
  const input = useRef<TextInputInstance>(null);
  const ready = !asking && text.trim().length > 0;
  const submit = async () => {
    if (!ready) return;
    haptic.tap();
    const question = text;
    setText('');
    // A question that wasn't sent (one was already on its way) goes back in the field.
    if (!(await onSend(question))) setText(question);
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
      <TextInput
        ref={input}
        autoFocus
        value={text}
        onChangeText={setText}
        placeholder={followUp ? 'Ask another question' : 'Ask about this phrase'}
        placeholderTextColor={c.textSecondary}
        accessibilityLabel="Question about this phrase"
        returnKeyType="send"
        enablesReturnKeyAutomatically
        submitBehavior="submit"
        onSubmitEditing={() => void submit()}
        style={{ ...type.subhead, flex: 1, minHeight: MIN_TAP - space.s, color: c.text, backgroundColor: c.fill, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: space.s }}
      />
      <Tappable
        onPress={() => void submit()}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityLabel="Send question"
        scaleTo={0.92}
        style={{ width: MIN_TAP - space.s, height: MIN_TAP - space.s, borderRadius: radius.pill, backgroundColor: ready ? c.accent : c.fill, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="arrow.up" size={16} color={ready ? c.onAccent : c.textSecondary} weight="bold" />
      </Tappable>
    </View>
  );
}
