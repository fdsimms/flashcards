import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { failureText } from '../../core/failure';
import type { Api, Language, PhraseExplanation as Explained } from '../../reader/api';
import type { Pronunciation } from '../../reader/mining';
import { Icon, Tappable, ErrorNote } from '../kit';
import { registerLabel } from '../../reader/register';
import { prefs } from '../../reader/storage';
import { haptic } from '../haptics';
import { Pop } from '../motion';
import { hairline, lift, MIN_TAP, radius, space, type, useTheme, smooth } from '../theme';

/** Adding the phrase to the deck: the note editor opens with it, and saving there is the approval. */
export type PhraseMining = {
  /** The language whose deck it is: a phrase from a text in another language isn't offered. */
  language: Language;
  deck: string;
  /** Opens the note editor; true once the note is saved. */
  /** The word's IPA and where it's from when it has some (a phrase has none), for the note's Pronunciation field. */
  onAdd: (entry: string, meaning: string, pronunciation?: Pronunciation) => Promise<boolean>;
};

/** Where the selected phrase is on screen (window coordinates): the top of its first word and the bottom of its last. */
export type PhraseAnchor = { top: number; bottom: number };

// Space between the phrase and the popup's edge, and the most of the screen the popup may take.
const POPUP_GAP = 12;
const POPUP_MAX_SHARE = 0.6;

/**
 * A phrase selected in a line, explained by Claude, in a popup beside the phrase. Like
 * LineExplanation it asks the server when it mounts (the server keeps each phrase's answer, so
 * asking again costs nothing), and "Explain more simply" asks for the plainer version. Add to deck
 * only opens the note editor: nothing reaches the deck unless the note is saved there (CLAUDE.md,
 * Read & Listen).
 *
 * The popup opens on whichever side of the phrase has more room, chosen once, so it doesn't jump
 * from below to above when the answer arrives and it grows. Its height is capped: the heading and
 * the buttons stay put and the explanation between them scrolls.
 */
export function PhraseExplanation({ api, textId, line, phrase, anchor, mining, onClose }: {
  api: Api;
  textId: number;
  line: number;
  phrase: string;
  anchor: PhraseAnchor;
  mining?: PhraseMining;
  onClose: () => void;
}) {
  const c = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const body = useRef<ScrollViewInstance>(null);
  const roomAbove = anchor.top - POPUP_GAP - insets.top - space.s;
  const roomBelow = height - anchor.bottom - POPUP_GAP - insets.bottom - space.s;
  const [below] = useState(() => roomBelow >= roomAbove);
  const maxHeight = Math.max(0, Math.min(height * POPUP_MAX_SHARE, below ? roomBelow : roomAbove));
  const [simple, setSimple] = useState(false);
  const [answer, setAnswer] = useState<Explained | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Counts requests, so an answer that arrives after a newer one was asked for (or after closing) is dropped.
  const latest = useRef(0);
  // The note editor is open: a second tap mustn't open another.
  const adding = useRef(false);

  const load = async (wantSimple: boolean) => {
    const mine = ++latest.current;
    setError(null);
    setAnswer(null);
    body.current?.scrollTo({ y: 0, animated: false });
    try {
      const got = await api.explainPhrase(textId, line, phrase, wantSimple, prefs().explainInLanguage);
      if (latest.current === mine) { setAnswer(got); setSimple(wantSimple); }
    } catch (e) {
      if (latest.current === mine) { setError(failureText(e, { what: "Couldn't explain this phrase.", next: 'Try again.' })); setSimple(wantSimple); }
    }
  };

  useEffect(() => {
    load(false);
    return () => { latest.current++; };
    // Asked once when the phrase is selected; a new phrase mounts a new one (the reader keys it).
  }, []);

  const add = async () => {
    if (!mining || !answer || adding.current) return;
    adding.current = true;
    // The popup is a modal, so it closes before the note editor opens over the reader.
    onClose();
    try {
      await mining.onAdd(phrase, answer.meaning);
    } finally {
      adding.current = false;
    }
  };

  const pill = { alignSelf: 'flex-start', backgroundColor: c.fill, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: space.s } as const;
  // The pill is shorter than a full tap target; this makes up the rest.
  const pillSlop = { top: space.s, bottom: space.s };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      {/* Anchored by its near edge, so it grows away from the phrase and never over it. */}
      <View
        pointerEvents="box-none"
        onAccessibilityEscape={onClose}
        style={{ position: 'absolute', left: space.l, right: space.l, ...(below ? { top: anchor.bottom + POPUP_GAP } : { bottom: height - anchor.top + POPUP_GAP }) }}
      >
        <Pop
          from={0.96}
          style={{ maxHeight, backgroundColor: c.surface, borderWidth: hairline, borderColor: c.border, borderRadius: radius.l, ...smooth, padding: space.m, gap: space.s, ...lift(c, 'high') }}
        >
          <View accessibilityLabel={`Explanation of ${phrase}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.headline, color: c.accent }}>{phrase}</Text>
            </View>
            <Tappable
              onPress={() => { haptic.tap(); onClose(); }}
              accessibilityRole="button"
              accessibilityLabel="Close the phrase"
              scaleTo={0.92}
              style={{ minWidth: MIN_TAP, minHeight: MIN_TAP, marginTop: -space.s, marginRight: -space.s, alignItems: 'center', justifyContent: 'center' }}
            >
              <View style={{ width: 28, height: 28, borderRadius: radius.pill, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="xmark" size={12} color={c.textSecondary} weight="bold" />
              </View>
            </Tappable>
          </View>
          {/* Only this part scrolls; the heading above and the buttons below stay. */}
          <ScrollView ref={body} style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ gap: space.s }} showsVerticalScrollIndicator>
            {error ? (
              <ErrorNote message={error} onRetry={() => load(simple)} />
            ) : answer === null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                <ActivityIndicator color={c.accent} />
                <Text style={{ ...type.subhead, color: c.textSecondary }}>Asking Claude…</Text>
              </View>
            ) : (
              <>
                <Text style={{ ...type.body, fontWeight: '600', color: c.text }}>{answer.meaning}</Text>
                {answer.literal ? (
                  <Text style={{ ...type.subhead, color: c.textSecondary }}>
                    <Text style={{ fontWeight: '600', color: c.text }}>Literal meaning: </Text>
                    {answer.literal}
                  </Text>
                ) : null}
                {registerLabel(answer.register) ? (
                  <Text style={{ ...type.subhead, color: c.textSecondary }}>
                    <Text style={{ fontWeight: '600', color: c.text }}>Register: </Text>
                    {answer.register_note ? `${registerLabel(answer.register)}. ${answer.register_note}` : registerLabel(answer.register)}
                  </Text>
                ) : null}
                {answer.points.map((p, i) => (
                  <Text key={i} style={{ ...type.subhead, color: c.text }}>
                    <Text style={{ fontWeight: '700', color: c.accent }}>{p.phrase}</Text>
                    {`: ${p.note}`}
                  </Text>
                ))}
              </>
            )}
          </ScrollView>
          {answer !== null && !error && ((!simple) || mining) ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {simple ? null : (
                <Tappable
                  onPress={() => { haptic.tap(); load(true); }}
                  accessibilityRole="button"
                  accessibilityLabel="Explain more simply"
                  hitSlop={pillSlop}
                  style={pill}
                >
                  <Text style={{ ...type.footnote, color: c.text }}>Explain more simply</Text>
                </Tappable>
              )}
              {mining ? (
                <Tappable
                  onPress={() => { haptic.tap(); add(); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${phrase} to ${mining.deck}`}
                  hitSlop={pillSlop}
                  style={pill}
                >
                  <Text style={{ ...type.footnote, color: c.text }}>Add to deck</Text>
                </Tappable>
              ) : null}
            </View>
          ) : null}
        </Pop>
      </View>
    </Modal>
  );
}

/** Shown above the player while the last word of a phrase is being chosen. */
export function PhrasePickBanner({ first, onCancel }: { first: string; onCancel: () => void }) {
  const c = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: c.surface, borderWidth: hairline, borderColor: c.border, borderRadius: radius.m, ...smooth, paddingVertical: space.s, paddingLeft: space.m, paddingRight: space.s }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.subhead, fontWeight: '600', color: c.text }}>Tap the last word of the phrase</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>{`Starting from "${first}". A phrase stays within one line. You can also hold a word and drag.`}</Text>
      </View>
      <Tappable
        onPress={() => { haptic.tap(); onCancel(); }}
        accessibilityRole="button"
        style={{ minHeight: MIN_TAP, justifyContent: 'center', backgroundColor: c.fill, borderRadius: radius.pill, paddingHorizontal: space.m }}
      >
        <Text style={{ ...type.footnote, color: c.text }}>Cancel</Text>
      </Tappable>
    </View>
  );
}
