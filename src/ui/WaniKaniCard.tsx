import React, { useState } from 'react';
import { Image, Text, useColorScheme, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { mnemonicParts, otherMeanings, primaryMeaning, READING_TYPE_NAMES, readingGroups, type Subject } from '../wanikani/subjects';
import { Icon, Tappable } from './kit';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

/** Japanese on a card: the system's Japanese face, so kanji don't fall back to Chinese forms. */
const JA = { fontFamily: 'Hiragino Sans' } as const;

/**
 * A radical with no character of its own, from WaniKani's picture. A PNG draws as an image tinted
 * to the text color; an SVG needs a WebView, and is inverted in dark mode since WaniKani draws it
 * in black (an assumption from how its radicals look on wanikani.com; the files weren't checked).
 */
function RadicalImage({ image, size }: { image: NonNullable<Subject['image']>; size: number }) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  if (!image.svg) return <Image source={{ uri: image.url }} style={{ width: size, height: size, tintColor: c.text }} accessibilityIgnoresInvertColors />;
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:transparent}img{width:100%;height:100%;object-fit:contain;filter:${dark ? 'invert(1)' : 'none'}}</style><img src="${image.url.replace(/"/g, '&quot;')}">`;
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
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
      <Text style={{ ...type.overline, color: c.textSecondary }}>{label}</Text>
      {subject.characters ? (
        <Text accessibilityLanguage="ja-JP" style={{ ...JA, fontSize: size, lineHeight: size * 1.25, fontWeight: '500', color: c.text, textAlign: 'center' }}>{subject.characters}</Text>
      ) : subject.image ? (
        <RadicalImage image={subject.image} size={72} />
      ) : (
        <Text style={{ ...type.body, color: c.textSecondary }}>No picture for this radical.</Text>
      )}
    </View>
  );
}

function FieldLabel({ children }: { children: string }) {
  const c = useTheme();
  return <Text style={{ ...type.overline, color: c.textTertiary, textAlign: 'center' }}>{children}</Text>;
}

/** A mnemonic with WaniKani's marked words in bold. */
function Mnemonic({ title, markup }: { title: string; markup: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.xs, padding: space.m, borderRadius: radius.m, ...smooth, backgroundColor: c.fill }}>
      <Text style={{ ...type.footnote, fontWeight: '600', color: c.text }}>{title}</Text>
      <Text style={{ ...type.subhead, color: c.textSecondary, lineHeight: 21 }}>
        {mnemonicParts(markup).map((p, i) => (
          p.mark
            ? <Text key={i} style={{ fontWeight: '600', color: c.text, ...(p.mark === 'ja' || p.mark === 'reading' ? JA : {}) }}>{p.text}</Text>
            : <Text key={i}>{p.text}</Text>
        ))}
      </Text>
    </View>
  );
}

/**
 * The answer side: the meaning and reading (each only once it's no longer being asked, so the
 * meaning's answer never gives the reading away), the recording, mnemonics behind a tap unless
 * it's a lesson, and example sentences.
 */
export function SubjectDetails({ subject, showMeaning, showReading, synonyms, lesson, onPlay }: {
  subject: Subject;
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
      {showMeaning ? (
        <View style={{ alignItems: 'center', gap: 2 }}>
          <FieldLabel>Meaning</FieldLabel>
          <Text style={{ ...type.cardBack, color: c.text, textAlign: 'center' }}>{primaryMeaning(subject)}</Text>
          {others.length ? <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{others.join(', ')}</Text> : null}
          {synonyms.length ? <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>{`Your synonyms: ${synonyms.join(', ')}`}</Text> : null}
        </View>
      ) : null}
      {showReading ? groups.map((g) => (
        <View key={g.type ?? 'reading'} style={{ alignItems: 'center', gap: 2 }}>
          <FieldLabel>{g.type ? READING_TYPE_NAMES[g.type] : 'Reading'}</FieldLabel>
          <Text accessibilityLanguage="ja-JP" style={{ ...JA, ...(g.primary ? type.cardBack : type.callout), color: g.primary ? c.text : c.textSecondary, textAlign: 'center' }}>
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
          style={{ alignSelf: 'center', minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.l, borderRadius: radius.pill, backgroundColor: c.fill }}
        >
          <Icon name="speaker.wave.2.fill" size={18} color={c.accent} />
          <Text style={{ ...type.callout, color: c.accent, fontWeight: '600' }}>Play</Text>
        </Tappable>
      ) : null}
      {hasMnemonics && !mnemonics ? (
        <Tappable onPress={() => setMnemonics(true)} accessibilityRole="button" style={{ alignSelf: 'center', minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: space.m }}>
          <Text style={{ ...type.callout, color: c.accent, fontWeight: '600' }}>Show mnemonics</Text>
        </Tappable>
      ) : null}
      {mnemonics && showMeaning && subject.meaningMnemonic ? <Mnemonic title="Meaning mnemonic" markup={subject.meaningMnemonic} /> : null}
      {mnemonics && showMeaning && subject.meaningHint ? <Mnemonic title="Hint" markup={subject.meaningHint} /> : null}
      {mnemonics && showReading && subject.readingMnemonic ? <Mnemonic title="Reading mnemonic" markup={subject.readingMnemonic} /> : null}
      {mnemonics && showReading && subject.readingHint ? <Mnemonic title="Hint" markup={subject.readingHint} /> : null}
      {showMeaning && showReading && subject.contextSentences.length ? (
        <View style={{ gap: space.m, paddingTop: space.m, borderTopWidth: hairline, borderTopColor: c.border }}>
          {subject.contextSentences.slice(0, 2).map((s, i) => (
            <View key={i} style={{ gap: 2 }}>
              <Text accessibilityLanguage="ja-JP" style={{ ...JA, ...type.callout, color: c.text }}>{s.ja}</Text>
              <Text style={{ ...type.footnote, color: c.textSecondary }}>{s.en}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
