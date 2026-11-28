import React from 'react';
import { Text, View } from 'react-native';
import { compareTyped } from '../../core/typedCompare';
import type { JournalCheck, JournalSentence } from '../../reader/api';
import { firstTry, journalHeadline } from '../../reader/journal';
import { haptic } from '../haptics';
import { Icon, Tappable } from '../kit';
import { radius, smooth, space, type, useTheme } from '../theme';
import { TypedDiff } from '../TypedDiff';
import { PlayDot } from '../PlayCircle';

/**
 * The journal's check, drawn (src/reader/journal.ts): the headline, the first try's marked sentences and
 * hints (`JournalFirstTry`, never the fixes), and each sentence corrected with why (`JournalCorrections`).
 * Nothing here grades a card.
 */

function Headline({ check, corrections }: { check: JournalCheck; corrections: boolean }) {
  const c = useTheme();
  const fix = check.sentences.some((s) => s.verdict !== 'right');
  const tone = !fix ? c.goodInk : check.verdict === 'wrong' ? c.danger : c.warningInk;
  const icon = !fix ? 'checkmark.circle.fill' : check.verdict === 'wrong' ? 'xmark.circle.fill' : 'exclamationmark.circle.fill';
  return (
    <View accessible accessibilityRole="text" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
      <Icon name={icon} size={20} color={tone} />
      <Text style={{ ...type.headline, color: tone, flex: 1 }}>{journalHeadline(check, corrections)}</Text>
    </View>
  );
}

function Mark({ n }: { n: number }) {
  const c = useTheme();
  return (
    <Text style={{ ...type.caption, fontWeight: '700', color: c.danger }}>{` ${n} `}</Text>
  );
}

/** The entry as written with each mistake picked out and numbered, and a hint for each, so it can be fixed before the corrections are shown. */
export function JournalFirstTry({ check, lang }: { check: JournalCheck; lang?: string }) {
  const c = useTheme();
  const { sentences, hints } = firstTry(check);
  return (
    <View style={{ gap: space.m }}>
      <Headline check={check} corrections={false} />
      <View style={{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.m, ...smooth, padding: space.m }}>
        <Text style={{ ...type.body, color: c.text, lineHeight: 26 }} accessibilityLanguage={lang}>
          {sentences.map((parts, i) => (
            <Text key={i}>
              {i ? ' ' : ''}
              {parts.map((p, j) => (p.mark === undefined
                ? <Text key={j}>{p.text}</Text>
                : (
                  <Text key={j}>
                    <Text style={{ color: c.danger, textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: c.danger }}>{p.text}</Text>
                    <Mark n={p.mark} />
                  </Text>
                )))}
            </Text>
          ))}
        </Text>
      </View>
      {hints.length ? (
        <View style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, padding: space.m, gap: space.s }}>
          {hints.map((h) => (
            <View key={h.mark} style={{ flexDirection: 'row', gap: space.s }}>
              <Text style={{ ...type.subhead, fontWeight: '700', color: c.danger, minWidth: 16 }}>{h.mark}</Text>
              <Text style={{ ...type.subhead, color: c.text, flex: 1 }}>{h.hint}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** One sentence corrected: what was written against the fix, its English, and each mistake's reason and kind. */
function CorrectedSentence({ sentence, lang, onKind }: { sentence: JournalSentence; lang?: string; onKind: (kind: string, group: string) => void }) {
  const c = useTheme();
  if (sentence.verdict === 'right') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
        <Text style={{ ...type.body, color: c.text, flex: 1 }} accessibilityLanguage={lang}>{sentence.corrected}</Text>
        <Icon name="checkmark" size={15} color={c.goodInk} />
      </View>
    );
  }
  return (
    <View style={{ gap: space.s }}>
      <TypedDiff comparison={compareTyped(sentence.corrected, sentence.written)} showExpected size="body" lang={lang} expectedLabel="Corrected" showLine={false} />
      {sentence.english ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{sentence.english}</Text> : null}
      {sentence.mistakes.map((m, i) => (
        <View key={i} style={{ gap: space.xs }}>
          <Text style={{ ...type.subhead, color: c.text }}>{m.note || m.hint}</Text>
          <Tappable
            onPress={() => onKind(m.kind, m.kind === 'case' && m.case ? `case:${m.case}` : m.kind)}
            accessibilityRole="button"
            accessibilityLabel={`${m.name}. Practice it`}
            style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.s, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.accentFill }}
          >
            <Text style={{ ...type.caption, fontWeight: '600', color: c.accentInk }}>{m.name}</Text>
            <Icon name="chevron.right" size={10} color={c.accentInk} />
          </Tappable>
        </View>
      ))}
    </View>
  );
}

/** The whole check: the headline, every sentence corrected, and a button reading the corrected entry aloud. */
export function JournalCorrections({ check, lang, onPlay, onKind }: {
  check: JournalCheck;
  lang?: string;
  onPlay?: () => void;
  /** A mistake's kind tapped: its practice (Which case, a grammar point's page). */
  onKind: (kind: string, group: string) => void;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <View style={{ flex: 1 }}><Headline check={check} corrections /></View>
        {onPlay ? (
          <PlayDot label="Play the corrected entry" onPress={() => { haptic.tap(); onPlay(); }} />
        ) : null}
      </View>
      <View style={{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.m, ...smooth, padding: space.m, gap: space.l }}>
        {check.sentences.map((s, i) => <CorrectedSentence key={i} sentence={s} lang={lang} onKind={onKind} />)}
      </View>
    </View>
  );
}
