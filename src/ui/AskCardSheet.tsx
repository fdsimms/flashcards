import React, { useEffect, useRef, useState } from 'react';
import { Linking, Modal, ScrollView, Text, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { claudeChatLink, SUGGESTED_QUESTIONS, withQuestion, type AskTurn, type CardForClaude } from '../core/askCard';
import { failureText } from '../core/failure';
import { haptic } from './haptics';
import { Button, ErrorNote, Field, Icon, Tappable } from './kit';
import { MIN_TAP, radius, space, type, useTheme, smooth } from './theme';

/**
 * Ask Claude about the card on screen, from Review's ⋯ menu. It opens over the card as iOS's own
 * page sheet and sends nothing until a question is sent (`ask`, which reaches Read & Listen's
 * server, present only while it's signed in). The conversation lives only while the sheet is
 * open, and each follow-up sends it again. "Open in the Claude app" hands the card and the typed
 * question to claude.ai instead, for asking without the server's key.
 *
 * `onSaveAnswer` (present only for a note with a Notes field) adds an answer there, under what's
 * already in it, when its button is tapped; the button names the field.
 * A swipe down closes the sheet, except while an answer is on its way.
 */
export function AskCardSheet({ card, ask, visible = true, onDismiss, onSaveAnswer, onClose }: {
  card: CardForClaude;
  ask?: (turns: AskTurn[]) => Promise<string>;
  /** False while the sheet is on its way out: it stays mounted until iOS reports it gone (`onDismiss`), so Review shows the next sheet only then (src/core/sheetQueue.ts). */
  visible?: boolean;
  onDismiss?: () => void;
  /** Adds an answer to the note's Notes field; throws when it can't be saved, and the sheet says why. */
  onSaveAnswer?: (answer: string) => Promise<void>;
  onClose: () => void;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The answer last added to the note, so its button doesn't add it twice.
  const [addedAnswer, setAddedAnswer] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
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

  const addToNote = async (answer: string) => {
    if (!onSaveAnswer || adding) return;
    haptic.select();
    setAdding(true);
    setError(null);
    try {
      await onSaveAnswer(answer);
      if (open.current) setAddedAnswer(answer);
    } catch (e) {
      if (open.current) setError(failureText(e, { what: "Couldn't add this to the note.", next: 'Try again.' }));
    } finally {
      if (open.current) setAdding(false);
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
    <Modal visible={visible} onDismiss={onDismiss} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!asking} onRequestClose={() => { if (!asking) onClose(); }} backdropColor={c.surface}>
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
              ? { alignSelf: 'flex-end', backgroundColor: c.accent, borderRadius: radius.l, ...smooth, paddingHorizontal: space.m, paddingVertical: space.s, maxWidth: '85%' }
              : { alignSelf: 'flex-start', backgroundColor: c.fill, borderRadius: radius.l, ...smooth, paddingHorizontal: space.m, paddingVertical: space.s, maxWidth: '92%' }}
          >
            <Text selectable={t.role === 'assistant'} style={{ ...type.subhead, color: t.role === 'user' ? c.onAccent : c.text }}>{t.content}</Text>
          </View>
        ))}
        {asking ? <Text style={{ ...type.subhead, color: c.textSecondary }}>Asking Claude…</Text> : null}
        {error ? <ErrorNote message={error} onRetry={failed ? () => { setTurns((prev) => prev.slice(0, -1)); void send(failed); } : undefined} /> : null}
        {ask && !asking && !turns.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {SUGGESTED_QUESTIONS.map((q) => (
              <Tappable key={q} onPress={() => void send(q)} accessibilityRole="button" accessibilityLabel={`Ask: ${q}`} style={{ backgroundColor: c.accentFill, borderRadius: radius.m, ...smooth, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP, justifyContent: 'center' }}>
                <Text style={{ ...type.subhead, color: c.text }}>{q}</Text>
              </Tappable>
            ))}
          </View>
        ) : null}
        {onSaveAnswer && lastAnswer && !asking ? (
          <View style={{ gap: space.xs }}>
            {addedAnswer === lastAnswer ? (
              <Text style={{ ...type.callout, fontWeight: '600', color: c.goodInk }}>Added to the note's Notes</Text>
            ) : (
              <>
                <Button label="Add to the note's Notes" variant="secondary" onPress={() => void addToNote(lastAnswer)} busy={adding} accessibilityLabel="Add this answer to the note's Notes field" />
                <Text style={{ ...type.footnote, color: c.textSecondary }}>
                  Adds this answer to the Notes field, under anything already there. Notes show on the card's back, and the change syncs to Anki. You can edit it later in the note editor.
                </Text>
              </>
            )}
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
