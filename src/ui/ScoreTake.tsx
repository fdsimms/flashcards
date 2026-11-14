import { File } from 'expo-file-system';
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { failureText } from '../core/failure';
import type { Language, ScoreBand, TakeScore } from '../reader/api';
import { scoreHeadline, weakestLine, weakestWord } from '../reader/pronunciation';
import { LANGUAGES } from '../reader/languages';
import { useApp } from './AppContext';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { MIN_TAP, radius, smooth, space, type, useTheme, type Colors } from './theme';
import type { SelfRecording } from './useSelfRecording';
import { useSpeakingOn } from './useSpokenAnswer';

/** A word's look by its band: green, amber dotted, red underlined, so the bands differ by more than hue. */
function bandStyle(band: ScoreBand, c: Colors) {
  if (band === 'good') return { color: c.good, backgroundColor: c.goodFill };
  if (band === 'close') return { color: c.warning, backgroundColor: c.warningFill, textDecorationLine: 'underline' as const, textDecorationStyle: 'dotted' as const };
  return { color: c.danger, backgroundColor: c.dangerFill, textDecorationLine: 'underline' as const };
}

/**
 * Score it (server/reader pronunciation.py): the chip beside Record yourself once there's a take, and
 * the take's score under it, word by word. Only while Answer by speaking is on and Read & Listen's
 * server is reachable. The take is sent to Azure through the server and isn't kept; the score goes
 * when the take does.
 */
export function ScoreTake({ rec, reference, language }: { rec: SelfRecording; reference: string; language: Language | undefined }) {
  const c = useTheme();
  const { reader } = useApp();
  const on = useSpeakingOn();
  const [score, setScore] = useState<{ uri: string; score: TakeScore } | null>(null);
  const [scoring, setScoring] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [opened, setOpened] = useState<number | null>(null);
  // Which take a score was asked for: an answer for one since replaced is dropped.
  const asked = useRef<string | null>(null);
  useEffect(() => { setProblem(null); setOpened(null); }, [rec.takeUri]);

  if (!on || !reader.api || !language || !reference.trim()) return null;
  const api = reader.api;
  const shown = score && score.uri === rec.takeUri ? score.score : null;

  const ask = async () => {
    const uri = rec.takeUri;
    if (!uri || scoring) return;
    if (!uri.endsWith('.wav')) {
      setProblem('This take was recorded before Answer by speaking was on. Record it again to score it.');
      return;
    }
    asked.current = uri;
    setScoring(true);
    setProblem(null);
    try {
      const audio = await new File(uri).base64();
      const got = await api.scoreTake(language, reference.trim(), audio);
      if (asked.current !== uri) return;
      haptic.success();
      setScore({ uri, score: got });
    } catch (e) {
      if (asked.current === uri) setProblem(failureText(e, { what: "Couldn't score this take.", next: 'Try again.' }));
    } finally {
      if (asked.current === uri) setScoring(false);
    }
  };

  const chip = rec.hasTake && !rec.recording && !shown ? (
    <Tappable
      onPress={() => void ask()}
      disabled={scoring}
      accessibilityRole="button"
      accessibilityLabel="Score it"
      accessibilityHint="Sends your take to Azure to score how each word sounded"
      accessibilityState={{ busy: scoring }}
      scaleTo={0.95}
      restOpacity={scoring ? 0.6 : 1}
      style={{ minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.m, borderRadius: radius.pill, backgroundColor: c.accent }}
    >
      <Icon name="gauge.with.dots.needle.67percent" size={14} color={c.onAccent} weight="semibold" />
      <Text style={{ ...type.footnote, fontWeight: '600', color: c.onAccent }}>{scoring ? 'Scoring...' : 'Score it'}</Text>
    </Tappable>
  ) : null;

  const weakest = shown ? weakestWord(shown) : undefined;
  const word = shown && opened !== null ? shown.words[opened] : null;
  return (
    <>
      {chip}
      {problem ? <Text style={{ ...type.footnote, color: c.danger, width: '100%' }}>{problem}</Text> : null}
      {shown ? (
        <View style={{ width: '100%', backgroundColor: c.surface, borderRadius: radius.m, ...smooth, padding: space.m, gap: space.s }}>
          <Text style={{ ...type.headline, color: c.text }}>{scoreHeadline(shown)}</Text>
          <Text accessibilityLanguage={LANGUAGES[language].speech} style={{ ...type.body, fontSize: 20, lineHeight: 30 }}>
            {shown.words.map((w, i) => (
              <Text key={i}>
                {i ? ' ' : ''}
                <Text
                  onPress={() => { haptic.select(); setOpened(opened === i ? null : i); }}
                  accessibilityRole="button"
                  accessibilityLabel={`${w.word}, ${w.accuracy} of 100`}
                  style={bandStyle(w.band, c)}
                >
                  {w.word}
                </Text>
              </Text>
            ))}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.s }}>
            {([['sounds', shown.accuracy], ['flow', shown.fluency], ['words said', shown.completeness]] as const).map(([label, value]) => (
              <View key={label} accessible accessibilityLabel={`${label}: ${value} of 100`} style={{ flex: 1, alignItems: 'center', paddingVertical: space.s, borderRadius: radius.m, backgroundColor: c.fill }}>
                <Text style={{ ...type.title, color: c.text, fontVariant: ['tabular-nums'] }}>{value}</Text>
                <Text style={{ ...type.caption, color: c.textSecondary }}>{label}</Text>
              </View>
            ))}
          </View>
          {word ? (
            <Text style={{ ...type.subhead, color: c.text }}>
              {word.syllables.length > 1 ? `${word.word}: ${word.syllables.map((s) => `${s.text} ${s.accuracy}`).join(' · ')}` : weakestLine(word)}
            </Text>
          ) : weakest ? <Text style={{ ...type.subhead, color: c.text }}>{weakestLine(weakest)}</Text> : null}
          <Text style={{ ...type.caption, color: c.textSecondary }}>
            Green: as a native speaker says it. Amber, dotted: close. Red, underlined: worth another try. Tap a word for its syllables. Record again for a new score.
          </Text>
        </View>
      ) : null}
    </>
  );
}
