import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { failureText } from '../../core/failure';
import { ApiError, type Api, type GlossLanguage, type Level } from '../../reader/api';
import { glossInfo } from '../../reader/languages';
import { bandLabel, bandShare, CHART_DAYS, chartPoints, levelSummary, speechPercent } from '../../reader/level';
import { Card, ErrorNote, Help, Loading, Screen, Section, SECTION_GAP, Tappable } from '../kit';
import { haptic } from '../haptics';
import { radius, readable, space, type, useTheme } from '../theme';

const count = (n: number) => n.toLocaleString('en-US');

/** Loads the language's level; null while loading, `none` for a language or deck with no level to show. */
function useLevel(api: Api, language: GlossLanguage) {
  const [level, setLevel] = useState<Level | 'none' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setLevel(await api.level(language));
    } catch (e) {
      // Toki Pona has no list of common words, and a deck not read yet has nothing to count.
      if (e instanceof ApiError && (e.status === 404 || e.status === 409)) setLevel('none');
      else setError(failureText(e, { what: "Couldn't load your level.", next: 'Try again.' }));
    }
  }, [api, language]);
  useEffect(() => { void load(); }, [load]);
  return { level, error, load };
}

/**
 * The card at the top of a language's Read & Listen settings (docs/read-and-listen/architecture.md,
 * "Your level"): how many of the most common words are studied, the share of speech, the change.
 * Shows nothing for a language with no level (Toki Pona) or while it can't load.
 */
export function LevelCard({ api, language, onOpen }: { api: Api; language: GlossLanguage; onOpen: () => void }) {
  const c = useTheme();
  const { level } = useLevel(api, language);
  if (!level || level === 'none') return null;
  const summary = levelSummary(level);
  return (
    <Tappable onPress={() => { haptic.select(); onOpen(); }} accessibilityRole="button" accessibilityHint="Opens your level" scaleTo={0.99}>
      <Card style={{ gap: space.xs }}>
        <Text style={{ ...type.overline, color: c.textTertiary }}>Where you are</Text>
        <Text style={{ ...type.body, color: c.text }}>
          <Text style={{ fontWeight: '700' }}>{count(level.known_top)}</Text>
          {` of the ${count(level.top)} most common words`}
        </Text>
        {summary ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{summary}</Text> : null}
        <Text style={{ ...type.callout, fontWeight: '600', color: c.accentInk }}>See your level</Text>
      </Card>
    </Tappable>
  );
}

/** Your level, in full: the bands, the share of everyday speech, and the trend. */
export function ReadLevel({ api, language }: { api: Api; language: GlossLanguage }) {
  const c = useTheme();
  const { level, error, load } = useLevel(api, language);
  const name = glossInfo(language).name;
  return (
    <Screen title="Your level">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: SECTION_GAP }}>
        {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}
        {!level && !error ? <Loading /> : null}
        {level === 'none' ? <Help>{`There's nothing to count yet. Your level shows once your ${name} deck has been read, after its next sync.`}</Help> : null}
        {level && level !== 'none' ? (
          <>
            <Section footer={<Help>{language === 'ja'
              ? 'Counts the words you are studying (cards seen at least once) and the ones learned in WaniKani. Words counted as known by the common words setting are left out.'
              : 'Counts the words you are studying (cards seen at least once). Words counted as known by the common words setting are left out.'}</Help>}
            >
              <Card style={{ gap: space.s }}>
                <Text style={{ ...type.largeTitle, color: c.text, fontVariant: ['tabular-nums'] }}>{count(level.known_top)}</Text>
                <Text style={{ ...type.subhead, color: c.textSecondary }}>{`of the ${count(level.top)} most common ${name} words are in your deck and studied`}</Text>
                <View style={{ gap: space.s, marginTop: space.xs }}>
                  {level.bands.map((b) => <BandRow key={b.start} band={b} />)}
                </View>
              </Card>
            </Section>
            {speechPercent(level) != null ? <SpeechCard percent={speechPercent(level)!} measured={language === 'th' ? 'Measured on film and TV subtitles' : 'Measured on subtitles, websites and books'} /> : null}
            <Section title={`Last ${CHART_DAYS / 7} weeks`}>
              <Card><Trend level={level} /></Card>
            </Section>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function BandRow({ band }: { band: Level['bands'][number] }) {
  const c = useTheme();
  const share = bandShare(band);
  return (
    <View accessible accessibilityLabel={`${bandLabel(band)}: ${count(band.known)} known`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
      <Text style={{ ...type.footnote, color: c.text, width: 92 }}>{bandLabel(band)}</Text>
      <View style={{ flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden' }}>
        <View style={{ width: `${Math.round(share * 100)}%`, height: 8, backgroundColor: c.accent }} />
      </View>
      <Text style={{ ...type.footnote, color: c.textSecondary, width: 48, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{count(band.known)}</Text>
    </View>
  );
}

/** The share of everyday speech, on a bar marked at 90% and 98%. */
function SpeechCard({ percent, measured }: { percent: number; /** Where the frequencies come from. */ measured: string }) {
  const c = useTheme();
  const ticks = [90, 98];
  return (
    <Section title="Everyday speech" footer={<Help>{`${measured}, word by word. At about 90%, most learners follow the gist of a conversation; at about 98%, a text reads without a dictionary.`}</Help>}>
      <Card style={{ gap: space.s }}>
        <Text style={{ ...type.body, color: c.text }}>
          <Text style={{ fontWeight: '700' }}>{`${percent}%`}</Text>
          {' of the words in it are ones you know'}
        </Text>
        <View accessible accessibilityLabel={`${percent} percent`}>
          <View style={{ height: 10, borderRadius: radius.pill, backgroundColor: c.fill }}>
            <View style={{ width: `${percent}%`, height: 10, borderRadius: radius.pill, backgroundColor: c.good }} />
            {ticks.map((t) => <View key={t} style={{ position: 'absolute', left: `${t}%`, top: -3, bottom: -3, width: 2, backgroundColor: c.textTertiary }} />)}
          </View>
          <View style={{ height: 16 }}>
            {ticks.map((t) => <Text key={t} style={{ ...type.caption, color: c.textTertiary, position: 'absolute', left: `${t}%`, transform: [{ translateX: -8 }] }}>{t}</Text>)}
          </View>
        </View>
      </Card>
    </Section>
  );
}

const W = 300;
const H = 90;
const PAD = { left: 4, right: 40, top: 14, bottom: 14 };

/** The headline figure over the last twelve weeks, one point a day the figure was kept. */
function Trend({ level }: { level: Level }) {
  const c = useTheme();
  const points = chartPoints(level.history);
  if (points.length < 2) {
    return <Help>The trend starts today. One figure is kept a day, so it fills in from here.</Help>;
  }
  const values = points.map((p) => p.known);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (daysAgo: number) => PAD.left + ((CHART_DAYS - daysAgo) / CHART_DAYS) * (W - PAD.left - PAD.right);
  const y = (v: number) => (hi === lo ? H / 2 : PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom));
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.daysAgo).toFixed(1)} ${y(p.known).toFixed(1)}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const area = `${line} L${x(last.daysAgo).toFixed(1)} ${H - PAD.bottom} L${x(first.daysAgo).toFixed(1)} ${H - PAD.bottom} Z`;
  return (
    <View accessible accessibilityLabel={`From ${count(first.known)} to ${count(last.known)} of the most common words`}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke={c.border} strokeWidth={1} />
        <Path d={area} fill={c.accentFill} />
        <Path d={line} fill="none" stroke={c.accent} strokeWidth={2} />
        <Circle cx={x(last.daysAgo)} cy={y(last.known)} r={3.5} fill={c.accent} />
        <SvgText x={x(last.daysAgo) + 6} y={y(last.known) + 4} fill={c.text} fontSize={11} fontWeight="600">{count(last.known)}</SvgText>
        {lo !== hi ? <SvgText x={W - PAD.right + 6} y={H - PAD.bottom + 4} fill={c.textTertiary} fontSize={10}>{count(lo)}</SvgText> : null}
      </Svg>
    </View>
  );
}
