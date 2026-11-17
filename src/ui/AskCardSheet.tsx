import React, { useEffect, useRef, useState } from 'react';
import { Linking, Modal, ScrollView, Text, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { claudeChatLink, SUGGESTED_QUESTIONS, withQuestion, type AskTurn, type CardForClaude } from '../core/askCard';
import { failureText } from '../core/failure';
import { haptic } from './haptics';
import { Button, ErrorNote, Field, Icon, Tappable } from './kit';
import { MIN_TAP, radius, space, type, useTheme } from './theme';

/**
 * Ask Claude about the card on screen, from Review's ⋯ menu. It opens over the card as iOS's own
 * page sheet and sends nothing until a question is sent (`ask`, which reaches Read & Listen's
 * server, present only while it's signed in). The conversation lives only while the sheet is
 * open, and each follow-up sends it again. "Open in the Claude app" hands the card and the typed
 * question to claude.ai instead, for asking without the server's key.
 *
 * `onUseAnswer` (present only for a note that can take a mnemonic) closes this sheet and opens the
 * mnemonic sheet with the answer filled in, so nothing is written to the note until it's saved there.
 * The button and its line say it's the Mnemonic field, which is where the answer ends up.
 * A swipe down closes the sheet, except while an answer is on its way.
 */
export function AskCardSheet({ card, ask, onUseAnswer, onClose }: {
  card: CardForClaude;
  ask?: (turns: AskTurn[]) => Promise<string>;
  onUseAnswer?: (answer: string) => void;
  onClose: () => void;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const open = useRef(true);
  useEffect(() => () => { open.current = false; }, []);

  const send = async (question: string) => {
    if (!ask || asking || !question.trim()) return;
    haptic.tap();
    const next = withQuestion(turns, question);
    setTurns(next);
    setText('');
    setAsking(true);
    setError(null);
    try {
      const answer = await ask(next);
      if (open.current) setTurns([...next, { role: 'assistant', content: answer }]);
    } catch (e) {
      if (open.current) setError(failureText(e, { what: "Couldn't get an answer.", next: 'Try again.' }));
    } finally {
      if (open.current) setAsking(false);
    }
  };

  const openInClaude = () => {
    haptic.tap();
    Linking.openURL(claudeChatLink(card, text)).catch(() => setError("Couldn't open the Claude app. Make sure it's installed, or open claude.ai in a browser."));
  };

  const lastAnswer = [...turns].reverse().find((t) => t.role === 'assistant')?.content;
  // A question that failed goes back in the box to resend, rather than staying as an unanswered turn.
  const failed = error && turns.at(-1)?.role === 'user' ? turns.at(-1)?.content : undefined;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!asking} onRequestClose={() => { if (!asking) onClose(); }} backdropColor={c.surface}>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        style={{ flex: 1, backgroundColor: c.surface }}
        contentContainerStyle={{ paddingHorizontal: space.l, paddingTop: space.xl, paddingBottom: Math.max(insets.bottom, space.l), gap: space.m }}
      >
        <View style={{ gap: space.xs }}>
          <Text style={{ ...type.headline, color: c.text }}>{`Ask about ${card.front}`}</Text>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>
            {ask
              ? 'Claude sees this card and its note, and what you ask here. Nothing is sent until you send a question.'
              : "Asking here needs Read & Listen (Settings, Read & Listen). You can still ask in the Claude app."}
          </Text>
        </View>
        {turns.map((t, i) => (
          <View
            key={i}
            style={t.role === 'user'
              ? { alignSelf: 'flex-end', backgroundColor: c.accent, borderRadius: radius.l, paddingHorizontal: space.m, paddingVertical: space.s, maxWidth: '85%' }
              : { alignSelf: 'flex-start', backgroundColor: c.fill, borderRadius: radius.l, paddingHorizontal: space.m, paddingVertical: space.s, maxWidth: '92%' }}
          >
            <Text selectable={t.role === 'assistant'} style={{ ...type.subhead, color: t.role === 'user' ? c.onAccent : c.text }}>{t.content}</Text>
          </View>
        ))}
        {asking ? <Text style={{ ...type.subhead, color: c.textSecondary }}>Asking Claude…</Text> : null}
        {error ? <ErrorNote message={error} onRetry={failed ? () => { setTurns((prev) => prev.slice(0, -1)); void send(failed); } : undefined} /> : null}
        {ask && !asking && !turns.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {SUGGESTED_QUESTIONS.map((q) => (
              <Tappable key={q} onPress={() => void send(q)} accessibilityRole="button" accessibilityLabel={`Ask: ${q}`} style={{ backgroundColor: c.accentFill, borderRadius: radius.m, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP, justifyContent: 'center' }}>
                <Text style={{ ...type.subhead, color: c.text }}>{q}</Text>
              </Tappable>
            ))}
          </View>
        ) : null}
        {onUseAnswer && lastAnswer && !asking ? (
          <View style={{ gap: space.xs }}>
            <Button label="Save as mnemonic" variant="secondary" onPress={() => { haptic.select(); onUseAnswer(lastAnswer); }} accessibilityLabel="Save this answer as the note's mnemonic" />
            <Text style={{ ...type.footnote, color: c.textSecondary }}>
              Opens the mnemonic editor with this answer filled in, so you can change it first. It's saved in the note's Mnemonic field, which shows on the back of the card.
            </Text>
          </View>
        ) : null}
        <Field label="Question" value={text} onChangeText={setText} placeholder={turns.length ? 'Ask a follow-up' : 'Why is it used this way?'} multiline />
        <View style={{ flexDirection: 'row', gap: space.m }}>
          <Button label="Close" variant="secondary" onPress={onClose} style={{ flex: 1 }} disabled={asking} />
          {ask ? <Button label="Ask" onPress={() => void send(text)} style={{ flex: 1 }} busy={asking} disabled={!text.trim()} /> : null}
        </View>
        <Tappable onPress={openInClaude} accessibilityRole="button" accessibilityLabel="Open this card in the Claude app" style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: MIN_TAP }}>
          <Icon name="arrow.up.forward.app" size={18} color={c.accent} />
          <Text style={{ ...type.callout, fontWeight: '600', color: c.accent }}>Open in the Claude app instead</Text>
        </Tappable>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>
          Opens a new chat with this card and your question filled in. It uses your Claude plan, not the server's key. If the app doesn't open, claude.ai opens in the browser.
        </Text>
      </ScrollView>
    </Modal>
  );
}
