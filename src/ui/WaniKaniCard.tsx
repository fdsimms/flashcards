import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { JAPANESE_FONT } from '../core/script';
import { mnemonicParts, otherMeanings, primaryMeaning, READING_TYPE_NAMES, readingGroups, SUBJECT_TYPE_NAMES, type Part, type Subject, type SubjectType } from '../wanikani/subjects';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme, type Colors } from './theme';

/** Japanese on a card: the system's Japanese face, so kanji don't fall back to Chinese forms. */
const JA = { fontFamily: JAPANESE_FONT } as const;

/** The fill WaniKani's colors give a kind of subject: radicals blue, kanji pink, vocabulary purple. */
export function subjectColor(c: Colors, t: SubjectType): string {
  return t === 'radical' ? c.wkRadical : t === 'kanji' ? c.wkKanji : c.wkVocab;
}

/**
 * A radical with no character of its own, from WaniKani's picture, always on a subject color. A PNG
 * draws as an image tinted white; an SVG needs a WebView, and is inverted to white since WaniKani
 * draws it in black (an assumption from how its radicals look on wanikani.com; the files weren't checked).
 */
function RadicalImage({ image, size }: { image: NonNullable<Subject['image']>; size: number }) {
  const c = useTheme();
  // Labelled by what it is, not its meaning, which would give the answer away.
  if (!image.svg) return <Image source={{ uri: image.url }} style={{ width: size, height: size, tintColor: c.onWk }} accessibilityIgnoresInvertColors accessible accessibilityRole="image" accessibilityLabel="Radical picture" />;
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:transparent}img{width:100%;height:100%;object-fit:contain;filter:invert(1)}</style><img src="${image.url.replace(/"/g, '&quot;')}">`;
  return (
    <View style={{ width: size, height: size }} pointerEvents="none" accessible accessibilityRole="image" accessibilityLabel="Radical picture">
      <WebView source={{ html }} originWhitelist={['*']} scrollEnabled={false} opaque={false} style={{ backgroundColor: 'transparent' }} />
    </View>
  );
}

/** What a card asks by: the characters, large, or a radical's picture. */
export function SubjectFront({ subject, label }: { subject: Subject; label: string }) {
  const c = useTheme();
  const size = (subject.characters?.length ?? 1) > 3 ? 44 : 64;
  return (
    <View style={{ alignItems: 'center', gap: space.m }}>
      <Text style={{ ...type.overline, color: c.onWkSoft }}>{label}</Text>
      {subject.characters ? (
        <Text accessibilityLanguage="ja-JP" style={{ ...JA, fontSize: size, lineHeight: size * 1.25, fontWeight: '500', color: c.onWk, textAlign: 'center' }}>{subject.characters}</Text>
      ) : subject.image ? (
        <RadicalImage image={subject.image} size={72} />
      ) : (
        <Text style={{ ...type.body, color: c.onWkSoft }}>No picture for this radical.</Text>
      )}
    </View>
  );
}

/**
 * What a question asks, as a band across the card's foot: light for the meaning, dark for the
 * reading (WaniKani's own cue), split in two when one question asks both.
 */
export function QuestionBand({ kind }: { kind: 'meaning' | 'reading' | 'both' }) {
  const c = useTheme();
  const half = (k: 'meaning' | 'reading') => (
    <View key={k} style={{ flex: 1, minHeight: MIN_TAP, paddingHorizontal: space.m, paddingVertical: space.s, alignItems: 'center', justifyContent: 'center', backgroundColor: k === 'meaning' ? c.wkMeaningBand : c.wkReadingBand }}>
      <Text style={{ ...type.subhead, fontWeight: '600', color: k === 'meaning' ? c.onWkMeaningBand : c.onWkReadingBand }}>{k === 'meaning' ? 'Meaning' : 'Reading'}</Text>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row' }} accessible accessibilityLabel={kind === 'both' ? 'Meaning and reading' : kind === 'meaning' ? 'Meaning' : 'Reading'}>
      {kind === 'both' ? [half('meaning'), half('reading')] : half(kind)}
    </View>
  );
}

function FieldLabel({ children }: { children: string }) {
  const c = useTheme();
  return <Text style={{ ...type.overline, color: c.onWkSoft, textAlign: 'center' }}>{children}</Text>;
}

/**
 * What a kanji or a word is made of (`madeOf`), as WaniKani's lessons open with: each part's
 * characters, or a radical's picture, over its meaning. A radical with neither shows its name.
 */
function MadeOf({ parts }: { parts: Part[] }) {
  const c = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: space.s }}>
      <FieldLabel>Made up of</FieldLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s }}>
        {parts.map((p) => (
          <View
            key={p.id}
            accessible
            accessibilityLabel={`${SUBJECT_TYPE_NAMES[p.type]}${p.characters ? ` ${p.characters}` : ''}, ${p.meaning}`}
            style={{ alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 64, minHeight: MIN_TAP, paddingHorizontal: space.m, paddingVertical: space.s, borderRadius: radius.m, ...smooth, backgroundColor: subjectColor(c, p.type), borderWidth: 2, borderColor: c.wkLine }}
          >
            {p.characters ? (
              <Text accessibilityLanguage="ja-JP" style={{ ...JA, ...type.title, fontWeight: '500', color: c.onWk }}>{p.characters}</Text>
            ) : p.image ? (
              <RadicalImage image={p.image} size={26} />
            ) : null}
            <Text style={p.characters || p.image ? { ...type.caption, color: c.onWkSoft } : { ...type.callout, fontWeight: '600', color: c.onWk }}>{p.meaning}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** A mnemonic with WaniKani's marked words in bold. */
function Mnemonic({ title, markup }: { title: string; markup: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.xs, padding: space.m, borderRadius: radius.m, ...smooth, backgroundColor: c.wkWell }}>
      <Text style={{ ...type.footnote, fontWeight: '600', color: c.onWk }}>{title}</Text>
      <Text style={{ ...type.subhead, color: c.onWkSoft, lineHeight: 21 }}>
        {mnemonicParts(markup).map((p, i) => (
          p.mark
            ? <Text key={i} style={{ fontWeight: '600', color: c.onWk, ...(p.mark === 'ja' || p.mark === 'reading' ? JA : {}) }}>{p.text}</Text>
            : <Text key={i}>{p.text}</Text>
        ))}
      </Text>
    </View>
  );
}

/**
 * The answer side: what it's made of and the meaning, then the reading (each only when this
 * question asked for it, so the meaning's answer never shows the reading and the reverse), the recording,
 * mnemonics behind a tap unless it's a lesson, and example sentences. The parts go with the
 * meaning, since their meanings hint at it.
 */
export function SubjectDetails({ subject, parts, showMeaning, showReading, synonyms, lesson, onPlay }: {
  subject: Subject;
  /** What it's made of (`madeOf`); empty for a radical, or when the parts couldn't be read. */
  parts: Part[];
  showMeaning: boolean;
  showReading: boolean;
  synonyms: string[];
  lesson: boolean;
  /** Plays WaniKani's recording; absent when the word has none (or it isn't a word). */
  onPlay?: () => void;
}) {
  const c = useTheme();
  const [mnemonics, setMnemonics] = useState(lesson);
  const others = otherMeanings(subject);
  const groups = readingGroups(subject);
  const hasMnemonics = (showMeaning && subject.meaningMnemonic) || (showReading && subject.readingMnemonic);
  return (
    <View style={{ gap: space.l }}>
      {showMeaning && parts.length ? <MadeOf parts={parts} /> : null}
      {showMeaning ? (
        <View style={{ alignItems: 'center', gap: 2 }}>
          <FieldLabel>Meaning</FieldLabel>
          <Text style={{ ...type.cardBack, color: c.onWk, textAlign: 'center' }}>{primaryMeaning(subject)}</Text>
          {others.length ? <Text style={{ ...type.subhead, color: c.onWkSoft, textAlign: 'center' }}>{others.join(', ')}</Text> : null}
          {synonyms.length ? <Text style={{ ...type.footnote, color: c.onWkSoft, textAlign: 'center' }}>{`Your synonyms: ${synonyms.join(', ')}`}</Text> : null}
        </View>
      ) : null}
      {showReading ? groups.map((g) => (
        <View key={g.type ?? 'reading'} style={{ alignItems: 'center', gap: 2 }}>
          <FieldLabel>{g.type ? READING_TYPE_NAMES[g.type] : 'Reading'}</FieldLabel>
          <Text accessibilityLanguage="ja-JP" style={{ ...JA, ...(g.primary ? type.cardBack : type.callout), color: g.primary ? c.onWk : c.onWkSoft, textAlign: 'center' }}>
            {g.readings.join('、')}
          </Text>
        </View>
      )) : null}
      {showReading && onPlay ? (
        <Tappable
          onPress={onPlay}
          accessibilityRole="button"
          accessibilityLabel="Play the word"
          scaleTo={0.94}
          style={{ alignSelf: 'center', minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.l, borderRadius: radius.pill, backgroundColor: c.wkWell }}
        >
          <Icon name="speaker.wave.2.fill" size={18} color={c.onWk} />
          <Text style={{ ...type.callout, color: c.onWk, fontWeight: '600' }}>Play</Text>
        </Tappable>
      ) : null}
      {hasMnemonics && !mnemonics ? (
        <Tappable
          onPress={() => { haptic.tap(); setMnemonics(true); }}
          accessibilityRole="button"
          scaleTo={0.94}
          style={{ alignSelf: 'center', minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.l, borderRadius: radius.pill, backgroundColor: c.wkWell }}
        >
          <Icon name="lightbulb" size={18} color={c.onWk} />
          <Text style={{ ...type.callout, color: c.onWk, fontWeight: '600' }}>Show mnemonics</Text>
        </Tappable>
      ) : null}
      {mnemonics && showMeaning && subject.meaningMnemonic ? <Mnemonic title="Meaning mnemonic" markup={subject.meaningMnemonic} /> : null}
      {mnemonics && showMeaning && subject.meaningHint ? <Mnemonic title="Hint" markup={subject.meaningHint} /> : null}
      {mnemonics && showReading && subject.readingMnemonic ? <Mnemonic title="Reading mnemonic" markup={subject.readingMnemonic} /> : null}
      {mnemonics && showReading && subject.readingHint ? <Mnemonic title="Hint" markup={subject.readingHint} /> : null}
      {showMeaning && showReading && subject.contextSentences.length ? (
        <View style={{ gap: space.m, paddingTop: space.m, borderTopWidth: hairline, borderTopColor: c.wkLine }}>
          {subject.contextSentences.slice(0, 2).map((s, i) => (
            <View key={i} style={{ gap: 2 }}>
              <Text accessibilityLanguage="ja-JP" style={{ ...JA, ...type.callout, color: c.onWk }}>{s.ja}</Text>
              <Text style={{ ...type.footnote, color: c.onWkSoft }}>{s.en}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
