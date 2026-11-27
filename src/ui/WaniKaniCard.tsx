import React, { useState } from 'react';
import { Image, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { JAPANESE_FONT } from '../core/script';
import { chooseTier, fitShape, TIER_LAYOUT, type FitTier, type TierLayout } from '../wanikani/cardFit';
import { mnemonicParts, mnemonicSections, otherMeanings, primaryMeaning, READING_TYPE_NAMES, readingGroups, shownSentences, SUBJECT_TYPE_NAMES, type Part, type Subject, type SubjectType } from '../wanikani/subjects';
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

/** The card's corner buttons (Play, Mnemonics) cover this much of its top right, which a header line keeps clear of. */
const CORNER_TOOLS = MIN_TAP * 2 + space.s;

/** What a card asks by: the characters, large, or a radical's picture. */
export function SubjectFront({ subject, label, tier }: { subject: Subject; label: string; tier: FitTier }) {
  const c = useTheme();
  const t = TIER_LAYOUT[tier];
  const size = (subject.characters?.length ?? 1) > 3 ? t.frontLong : t.frontShort;
  const characters = subject.characters ? (
    <Text accessibilityLanguage="ja-JP" style={{ ...JA, fontSize: size, lineHeight: size * 1.25, fontWeight: '500', color: c.onWk, textAlign: 'center', flexShrink: 0 }}>{subject.characters}</Text>
  ) : subject.image ? (
    <RadicalImage image={subject.image} size={t.frontImage} />
  ) : (
    <Text style={{ ...type.body, color: c.onWkSoft }}>No picture for this radical.</Text>
  );
  // A header line when the card is short: the characters, then what kind of card, left-aligned.
  if (t.headerFront) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingRight: CORNER_TOOLS }}>
        {characters}
        <Text numberOfLines={1} style={{ ...type.overline, color: c.onWkSoft, flexShrink: 1 }}>{label}</Text>
      </View>
    );
  }
  return (
    <View style={{ alignItems: 'center', gap: t.frontGap }}>
      <Text style={{ ...type.overline, color: c.onWkSoft }}>{label}</Text>
      {characters}
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
 * characters, or a radical's picture, over its meaning (beside it, in a short layout). A radical
 * with neither shows its name.
 */
function MadeOf({ parts, layout: t }: { parts: Part[]; layout: TierLayout }) {
  const c = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: t.fieldGap }}>
      <FieldLabel>Made up of</FieldLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: t.partGap }}>
        {parts.map((p) => {
          const hasFace = !!(p.characters || p.image);
          return (
            <View
              key={p.id}
              accessible
              accessibilityLabel={`${SUBJECT_TYPE_NAMES[p.type]}${p.characters ? ` ${p.characters}` : ''}, ${p.meaning}`}
              style={{
                alignItems: 'center', justifyContent: 'center', borderRadius: radius.m, ...smooth, backgroundColor: subjectColor(c, p.type), borderWidth: 2, borderColor: c.wkLine,
                ...(t.inlineParts
                  ? { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: space.xs }
                  : { gap: 2, minWidth: 64, minHeight: MIN_TAP, paddingHorizontal: space.m, paddingVertical: space.s }),
              }}
            >
              {p.characters ? (
                <Text accessibilityLanguage="ja-JP" style={{ ...JA, ...type.title, fontSize: t.partChar, fontWeight: '500', color: c.onWk }}>{p.characters}</Text>
              ) : p.image ? (
                <RadicalImage image={p.image} size={t.inlineParts ? 22 : 26} />
              ) : null}
              <Text style={hasFace ? { ...type.caption, color: c.onWkSoft } : { ...type.callout, fontWeight: '600', color: c.onWk }}>{p.meaning}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** A mnemonic with WaniKani's marked words in bold, on the subject's color (`onCard`) or on a surface. */
function Mnemonic({ title, markup, onCard }: { title: string; markup: string; onCard: boolean }) {
  const c = useTheme();
  const strong = onCard ? c.onWk : c.text;
  return (
    <View style={{ gap: space.xs, padding: space.m, borderRadius: radius.m, ...smooth, backgroundColor: onCard ? c.wkWell : c.fill }}>
      <Text style={{ ...type.footnote, fontWeight: '600', color: strong }}>{title}</Text>
      <Text style={{ ...type.subhead, color: onCard ? c.onWkSoft : c.textBody, lineHeight: 21 }}>
        {mnemonicParts(markup).map((p, i) => (
          p.mark
            ? <Text key={i} style={{ fontWeight: '600', color: strong, ...(p.mark === 'ja' || p.mark === 'reading' ? JA : {}) }}>{p.text}</Text>
            : <Text key={i}>{p.text}</Text>
        ))}
      </Text>
    </View>
  );
}

/** Example sentences, Japanese over English. */
function Sentences({ subject, showMeaning, showReading, onCard }: { subject: Subject; showMeaning: boolean; showReading: boolean; onCard: boolean }) {
  const c = useTheme();
  const sentences = shownSentences(subject, showMeaning, showReading);
  if (!sentences.length) return null;
  return (
    <View style={{ gap: space.m }}>
      {sentences.map((s, i) => (
        <View key={i} style={{ gap: 2 }}>
          <Text accessibilityLanguage="ja-JP" style={{ ...JA, ...type.callout, color: onCard ? c.onWk : c.text }}>{s.ja}</Text>
          <Text style={{ ...type.footnote, color: onCard ? c.onWkSoft : c.textSecondary }}>{s.en}</Text>
        </View>
      ))}
    </View>
  );
}

/** Whether a review's answer has mnemonics or sentences to open in `MnemonicsPanel`. */
export function hasMnemonicPanel(subject: Subject, showMeaning: boolean, showReading: boolean): boolean {
  return mnemonicSections(subject, showMeaning, showReading).length > 0 || shownSentences(subject, showMeaning, showReading).length > 0;
}

function ToolButton({ icon, label, onPress }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      scaleTo={0.9}
      style={{ width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ width: 30, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: c.wkWell }}>
        <Icon name={icon} size={15} color={c.onWkSoft} />
      </View>
    </Tappable>
  );
}

/**
 * Play and Mnemonics as small round icon buttons in the card's top corner, out of the way of the
 * answer, so a card read above the keyboard keeps its height for the answer. Each is absent when it
 * has nothing to do (no recording, no mnemonic).
 */
export function CardTools({ onPlay, onMnemonics }: { onPlay?: () => void; onMnemonics?: () => void }) {
  if (!onPlay && !onMnemonics) return null;
  return (
    <View style={{ position: 'absolute', top: 0, right: 0, flexDirection: 'row' }}>
      {onPlay ? <ToolButton icon="speaker.wave.2.fill" label="Play the word" onPress={onPlay} /> : null}
      {onMnemonics ? <ToolButton icon="lightbulb" label="Show mnemonics" onPress={onMnemonics} /> : null}
    </View>
  );
}

/**
 * The mnemonics, hints and example sentences over the card, in a scroll of their own. It is part of
 * the card rather than a sheet, so the keyboard under a typed answer keeps its focus and stays up.
 */
export function MnemonicsPanel({ subject, showMeaning, showReading, onClose }: { subject: Subject; showMeaning: boolean; showReading: boolean; onClose: () => void }) {
  const c = useTheme();
  return (
    <View
      accessibilityViewIsModal
      style={{ position: 'absolute', top: space.s, left: space.s, right: space.s, bottom: space.s, borderRadius: radius.l, ...smooth, backgroundColor: c.surface, borderWidth: hairline, borderColor: c.border, paddingHorizontal: space.m, paddingTop: space.xs }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TAP }}>
        <Text style={{ ...type.headline, color: c.text }}>Mnemonics</Text>
        <Tappable onPress={() => { haptic.tap(); onClose(); }} accessibilityRole="button" accessibilityLabel="Close mnemonics" scaleTo={0.94} style={{ minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: space.s }}>
          <Text style={{ ...type.callout, fontWeight: '600', color: c.accentInk }}>Close</Text>
        </Tappable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.s, paddingBottom: space.m }}>
        {mnemonicSections(subject, showMeaning, showReading).map((m, i) => <Mnemonic key={i} title={m.title} markup={m.markup} onCard={false} />)}
        <Sentences subject={subject} showMeaning={showMeaning} showReading={showReading} onCard={false} />
      </ScrollView>
    </View>
  );
}

/**
 * The answer side: what it's made of and the meaning, then the reading (each only when this
 * question asked for it, so the meaning's answer never shows the reading and the reverse). The parts
 * go with the meaning, since their meanings hint at it. A lesson also lays out the mnemonics and
 * example sentences; a review leaves them to `MnemonicsPanel`, opened from `CardTools`.
 */
export function SubjectDetails({ subject, parts, showMeaning, showReading, synonyms, lesson, tier }: {
  subject: Subject;
  /** What it's made of (`madeOf`); empty for a radical, or when the parts couldn't be read. */
  parts: Part[];
  showMeaning: boolean;
  showReading: boolean;
  synonyms: string[];
  lesson: boolean;
  tier: FitTier;
}) {
  const c = useTheme();
  const t = TIER_LAYOUT[tier];
  const others = otherMeanings(subject);
  const groups = readingGroups(subject);
  const readings = groups.map((g) => (
    <View key={g.type ?? 'reading'} style={{ alignItems: 'center', gap: 2 }}>
      <FieldLabel>{g.type ? READING_TYPE_NAMES[g.type] : 'Reading'}</FieldLabel>
      <Text accessibilityLanguage="ja-JP" style={{ ...JA, ...type.cardBack, fontSize: g.primary ? t.readingPrimary : t.readingOther, fontWeight: g.primary ? '600' : '400', color: g.primary ? c.onWk : c.onWkSoft, textAlign: 'center' }}>
        {g.readings.join('、')}
      </Text>
    </View>
  ));
  return (
    <View style={{ gap: t.blockGap }}>
      {showMeaning && parts.length ? <MadeOf parts={parts} layout={t} /> : null}
      {showMeaning ? (
        <View style={{ alignItems: 'center', gap: 2, paddingTop: parts.length ? t.meaningLead : 0 }}>
          <FieldLabel>Meaning</FieldLabel>
          <Text style={{ ...type.cardBack, fontSize: t.meaning, color: c.onWk, textAlign: 'center' }}>{primaryMeaning(subject)}</Text>
          {others.length ? <Text style={{ ...type.subhead, color: c.onWkSoft, textAlign: 'center' }}>{others.join(', ')}</Text> : null}
          {synonyms.length ? <Text style={{ ...type.footnote, color: c.onWkSoft, textAlign: 'center' }}>{`Your synonyms: ${synonyms.join(', ')}`}</Text> : null}
        </View>
      ) : null}
      {showReading && readings.length ? (
        t.readingsInRow
          ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: space.l, rowGap: space.s }}>{readings}</View>
          : readings
      ) : null}
      {lesson ? mnemonicSections(subject, showMeaning, showReading).map((m, i) => <Mnemonic key={i} title={m.title} markup={m.markup} onCard />) : null}
      {lesson && shownSentences(subject, showMeaning, showReading).length ? (
        <View style={{ paddingTop: space.m, borderTopWidth: hairline, borderTopColor: c.wkLine }}>
          <Sentences subject={subject} showMeaning={showMeaning} showReading={showReading} onCard />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The card's scrolling content: the front, then the answer side under it. It lays itself out at the
 * largest size that fits (`chooseTier`), measuring the room it has, and remembers that room from
 * card to card so a new card is drawn at the right size the first time. `compact` (the keyboard is
 * up) is only the guess before the first measurement. `contentKey` remounts the content for a new
 * question.
 */
export function CardContent({ subject, label, parts, showMeaning, showReading, synonyms, lesson, compact, contentKey }: {
  subject: Subject;
  label: string;
  parts: Part[];
  showMeaning: boolean;
  showReading: boolean;
  synonyms: string[];
  lesson: boolean;
  compact: boolean;
  contentKey: string;
}) {
  const c = useTheme();
  const { fontScale } = useWindowDimensions();
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null);
  const tier = chooseTier(fitShape(subject, parts, { showMeaning, showReading, synonyms }), room, { fontScale, lesson, compact });
  const t = TIER_LAYOUT[tier];
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setRoom((r) => (r && Math.abs(r.width - width) < 1 && Math.abs(r.height - height) < 1 ? r : { width, height }));
      }}
      contentContainerStyle={{ paddingTop: t.padTop, paddingBottom: t.padBottom, paddingHorizontal: t.padX, flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 640, alignSelf: 'center' }}
    >
      {/* No fade or rise on a new question: a native-driven fade started as the keyboard's layout animation runs can stay at invisible (the card came up blank), and a 240 ms fade on every card read as slow. The answer flash is the feedback. */}
      <View key={contentKey} style={{ gap: t.gap }}>
        <SubjectFront subject={subject} label={label} tier={tier} />
        {showMeaning || showReading ? (
          <>
            {t.divider ? <View style={{ height: hairline, backgroundColor: c.wkLine }} /> : null}
            <SubjectDetails subject={subject} parts={parts} showMeaning={showMeaning} showReading={showReading} synonyms={synonyms} lesson={lesson} tier={tier} />
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}
