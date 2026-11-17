import React, { useMemo, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isOmnilanguage } from '../core/cards';
import { partnerIndex, partnerSummary, type ConfusedPair } from '../core/confusedPairs';
import { failureText } from '../core/failure';
import { headword } from '../core/forms';
import { htmlToText } from '../core/html';
import { hasThai, thaiTextStyle } from '../core/script';
import type { Card, Note } from '../core/types';
import { LANGUAGES } from '../reader/languages';
import { linkCandidates, mixupLanguage, mixupSet, searchWords, type MixupWord } from '../tools/mixups';
import { haptic } from './haptics';
import { Button, Divider, ErrorNote, Field, Group, Help, Icon, Tappable } from './kit';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

/**
 * Confused words in Review (src/core/confusedPairs.ts): the sheet that links the card on screen
 * to a word it gets mixed up with, and the row on the answer side that names the partners.
 * Linking and unlinking never touch a card's schedule.
 */

/** Whether a note can be linked: Similar words, where the pairs are practiced, covers Omnilanguage notes. */
export function canLinkConfused(note: Note): boolean {
  return isOmnilanguage(note) && !!mixupLanguage(note);
}

const text = (field: string | undefined) => htmlToText(field ?? '').replace(/\s+/g, ' ').trim();

/** One word in a list: the word large, its romanization and meaning under it, and whatever goes at the end. */
function WordRow({ word, onPress, label, children }: { word: MixupWord; onPress?: () => void; label: string; children?: React.ReactNode }) {
  const c = useTheme();
  const wordStyle = hasThai(word.word) ? { ...thaiTextStyle('large'), fontSize: 24 } : { ...type.title, fontWeight: '400' as const };
  return (
    <Tappable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: MIN_TAP + 12, paddingHorizontal: space.m, paddingVertical: space.s }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...wordStyle, color: c.text }}>{word.word}</Text>
        <Text style={{ ...type.subhead, color: c.textSecondary }}>{[word.roman, word.meaning].filter(Boolean).join(' · ')}</Text>
      </View>
      {children}
    </Tappable>
  );
}

/**
 * Opens over the review screen to link `note` to the word it was mixed up with: the words that
 * sound or look close to it first, and a search for any other word in the same language. Also lists
 * what it's already linked to, each with Unlink. It's iOS's own page sheet, so a swipe down closes it.
 */
export function ConfusedLinkSheet({ note, notes, cards, pairs, onLink, onUnlink, onClose }: {
  note: Note;
  notes: Map<string, Note>;
  cards: Card[];
  pairs: ConfusedPair[];
  /** Links the note to `partnerId`; throws when it can't be saved, and the sheet says why. */
  onLink: (partnerId: string) => Promise<void>;
  onUnlink: (partnerId: string) => Promise<void>;
  onClose: () => void;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const language = mixupLanguage(note);
  const linked = useMemo(() => new Set(partnerIndex(pairs).get(note.id) ?? []), [pairs, note.id]);
  // The card on screen counts as studied even if its card is still new: it can be what's mixed up.
  const set = useMemo(() => {
    const studied = new Set(cards.filter((card) => card.sched.state !== 0 && !card.retired).map((card) => card.noteId));
    studied.add(note.id);
    return mixupSet(notes.values(), studied, pairs);
  }, [notes, cards, pairs, note.id]);
  const candidates = useMemo(() => linkCandidates(set, note.id, linked), [set, note.id, linked]);
  const found = useMemo(() => (language ? searchWords(set, language, query, note.id, linked) : []), [set, language, query, note.id, linked]);
  const linkedWords = [...linked].map((id) => set.words.get(id)).filter((w): w is MixupWord => !!w);

  const run = async (action: () => Promise<void>, close: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      haptic.success();
      if (close) onClose();
    } catch (e) {
      setError(failureText(e, { what: "Couldn't save this change.", next: 'Try again.' }));
    } finally {
      setBusy(false);
    }
  };

  const word = headword(note);
  const gloss = [text(note.fields.Transliteration), text(note.fields.Meaning)].filter(Boolean).join(' · ');
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} backdropColor={c.surface}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        style={{ flex: 1, backgroundColor: c.surface }}
        contentContainerStyle={{ paddingHorizontal: space.l, paddingTop: space.xl, paddingBottom: Math.max(insets.bottom, space.l), gap: space.m }}
      >
        <View style={{ gap: space.xs }}>
          <Text style={{ ...type.headline, color: c.text }}>{`Which word did you mix up with ${word}?`}</Text>
          {gloss ? <Text style={{ ...type.callout, color: c.textSecondary }}>{gloss}</Text> : null}
        </View>
        <Help>Similar words will ask you to tell them apart. The link doesn't change when either card comes back, and it isn't sent to Anki.</Help>

        {candidates.length ? (
          <Group>
            {candidates.map((cand, i) => (
              <View key={cand.word.noteId}>
                {i ? <Divider inset={space.m} /> : null}
                <WordRow word={cand.word} label={`Link ${cand.word.word}, ${cand.why}`} onPress={() => run(() => onLink(cand.word.noteId), true)}>
                  <View style={{ backgroundColor: c.fill, borderRadius: radius.pill, paddingHorizontal: space.s, paddingVertical: 2 }}>
                    <Text style={{ ...type.caption, color: c.textSecondary }}>{cand.why}</Text>
                  </View>
                </WordRow>
              </View>
            ))}
          </Group>
        ) : null}

        <Field label="Search your words" value={query} onChangeText={setQuery} placeholder="A word or its meaning" autoCapitalize="none" autoCorrect={false} />
        {found.length ? (
          <Group>
            {found.map((w, i) => (
              <View key={w.noteId}>
                {i ? <Divider inset={space.m} /> : null}
                <WordRow word={w} label={`Link ${w.word}`} onPress={() => run(() => onLink(w.noteId), true)} />
              </View>
            ))}
          </Group>
        ) : query.trim() && language ? <Help>{`No ${LANGUAGES[language].name} word you're studying matches that.`}</Help> : null}

        {linkedWords.length ? (
          <View style={{ gap: space.s }}>
            <Text style={{ ...type.overline, color: c.textSecondary, paddingHorizontal: space.xs }}>Linked now</Text>
            <Group>
              {linkedWords.map((w, i) => (
                <View key={w.noteId}>
                  {i ? <Divider inset={space.m} /> : null}
                  <WordRow word={w} label={`${w.word}, linked`}>
                    <Tappable
                      onPress={() => run(() => onUnlink(w.noteId), false)}
                      accessibilityRole="button"
                      accessibilityLabel={`Unlink ${w.word}`}
                      style={{ minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: space.s }}
                    >
                      <Text style={{ ...type.callout, color: c.danger, fontWeight: '600' }}>Unlink</Text>
                    </Tappable>
                  </WordRow>
                </View>
              ))}
            </Group>
          </View>
        ) : null}

        {error ? <ErrorNote message={error} /> : null}
        <Button label="Not now" variant="secondary" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}

/**
 * Under a revealed answer: the words this card's note is linked to, as "Often mixed up with ก่อน ·
 * before", and how many more there are. Tapping it opens the link sheet, where they can be changed.
 * Nothing when the card has no partners, and only on the answer side, so it never gives one away.
 */
export function ConfusedRow({ note, partners, notes, onPress }: {
  note: Note;
  /** Every note's partners (`partnerIndex`). */
  partners: Map<string, string[]>;
  notes: Map<string, Note>;
  onPress: () => void;
}) {
  const c = useTheme();
  const summary = partnerSummary(partners.get(note.id) ?? [], (id) => notes.has(id));
  const other = summary ? notes.get(summary.first) : undefined;
  if (!summary || !other) return null;
  const name = headword(other);
  const meaning = text(other.fields.Meaning);
  const more = summary.more ? ` and ${summary.more} more` : '';
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={`Often mixed up with ${name}${meaning ? `, ${meaning}` : ''}${more}. Change links`}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: space.s, ...smooth, borderRadius: radius.m, backgroundColor: c.accentFill,
        paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP, borderWidth: hairline, borderColor: 'transparent',
      }}
    >
      <Icon name="arrow.left.arrow.right" size={16} color={c.accent} />
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.caption, color: c.textSecondary }}>Often mixed up with</Text>
        <Text style={{ ...type.callout, color: c.text }}>
          <Text style={{ fontWeight: '600' }}>{name}</Text>
          {meaning ? ` · ${meaning}` : ''}
          {more}
        </Text>
      </View>
      <Icon name="chevron.right" size={14} color={c.textTertiary} />
    </Tappable>
  );
}
