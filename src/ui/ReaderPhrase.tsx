import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { failureText } from '../core/failure';
import type { Api, Language, PhraseExplanation as Explained } from '../reader/api';
import { Icon, Tappable, ErrorNote } from './kit';
import { haptic } from './haptics';
import { MIN_TAP, radius, space, type, useTheme } from './theme';

/** Adding the phrase to the deck: the note editor opens with it, and saving there is the approval. */
export type PhraseMining = {
  /** The language whose deck it is: a phrase from a text in another language isn't offered. */
  language: Language;
  deck: string;
  /** Opens the note editor; true once the note is saved. */
  onAdd: (entry: string, meaning: string) => Promise<boolean>;
};

/**
 * A phrase selected in a line, explained by Claude, under the line. Like LineExplanation it asks
 * the server when it mounts (the server keeps each phrase's answer, so asking again costs nothing),
 * and "Explain more simply" asks for the plainer version. Add to deck only opens the note editor:
 * nothing reaches the deck unless the note is saved there (CLAUDE.md, Read & Listen).
 */
export function PhraseExplanation({ api, textId, line, phrase, mining, onClose }: {
  api: Api;
  textId: number;
  line: number;
  phrase: string;
  mining?: PhraseMining;
  onClose: () => void;
}) {
  const c = useTheme();
  const [simple, setSimple] = useState(false);
  const [answer, setAnswer] = useState<Explained | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  // Counts requests, so an answer that arrives after a newer one was asked for (or after closing) is dropped.
  const latest = useRef(0);
  // The note editor is open: a second tap mustn't open another.
  const adding = useRef(false);

  const load = async (wantSimple: boolean) => {
    const mine = ++latest.current;
    setError(null);
    setAnswer(null);
    try {
      const got = await api.explainPhrase(textId, line, phrase, wantSimple);
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
    try {
      if (await mining.onAdd(phrase, answer.meaning)) setAdded(true);
    } finally {
      adding.current = false;
    }
  };

  const pill = { alignSelf: 'flex-start', backgroundColor: c.fill, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: space.s } as const;

  return (
    <View
      accessibilityLabel={`Explanation of ${phrase}`}
      style={{ marginTop: space.m, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.m, padding: space.m, gap: space.s }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>Phrase</Text>
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
      {error ? (
        <ErrorNote message={error} onRetry={() => load(simple)} />
      ) : answer === null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <ActivityIndicator />
          <Text style={{ ...type.subhead, color: c.textSecondary }}>Asking Claude…</Text>
        </View>
      ) : (
        <>
          <Text style={{ ...type.body, fontWeight: '600', color: c.text }}>{answer.meaning}</Text>
          {answer.points.map((p, i) => (
            <Text key={i} style={{ ...type.subhead, color: c.text }}>
              <Text style={{ fontWeight: '700', color: c.accent }}>{p.phrase}</Text>
              {`: ${p.note}`}
            </Text>
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.xs }}>
            {simple ? null : (
              <Tappable
                onPress={() => { haptic.tap(); load(true); }}
                accessibilityRole="button"
                accessibilityLabel="Explain more simply"
                style={pill}
              >
                <Text style={{ ...type.footnote, color: c.text }}>Explain more simply</Text>
              </Tappable>
            )}
            {mining && !added ? (
              <Tappable
                onPress={() => { haptic.tap(); add(); }}
                accessibilityRole="button"
                accessibilityLabel={`Add ${phrase} to ${mining.deck}`}
                style={pill}
              >
                <Text style={{ ...type.footnote, color: c.text }}>Add to deck</Text>
              </Tappable>
            ) : null}
          </View>
          {mining && added ? (
            <Text style={{ ...type.footnote, color: c.textSecondary }}>{`Added to ${mining.deck}.`}</Text>
          ) : null}
        </>
      )}
    </View>
  );
}

/** Shown above the player while the last word of a phrase is being chosen. */
export function PhrasePickBanner({ first, onCancel }: { first: string; onCancel: () => void }) {
  const c = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.m, paddingVertical: space.s, paddingLeft: space.m, paddingRight: space.s }}
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
