import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { decodeForPitch, PITCH_SAMPLE_RATE } from '../../modules/audio-samples';
import { htmlToText } from '../core/html';
import { pitchLine, pitchPath, pitchRange, showsPitch, toneCaption, trackPitch, type PitchLine as Line_ } from '../core/pitch';
import { thaiSyllables, toneCheck } from '../core/toneCheck';
import type { Note } from '../core/types';
import { pitchEveryLanguage } from './pitchPrefs';
import type { SelfRecording } from './useSelfRecording';
import { hairline, radius, smooth, space, type, useTheme } from './theme';
import { ToneCheck } from './ToneCheck';

const WIDTH = 300;
const HEIGHT = 120;

/** The card recordings' lines, by file: a recording doesn't change, so it's measured once. */
const recordings = new Map<string, Line_ | null>();

async function lineOf(uri: string): Promise<Line_ | null | undefined> {
  const samples = await decodeForPitch(uri);
  // A build made before the module was added: no line at all, rather than one that says it can't hear.
  if (samples === null) return undefined;
  return pitchLine(trackPitch(samples, PITCH_SAMPLE_RATE));
}

type Lines = { take: string; recording: Line_ | null; yours: Line_ | null } | { take: string; failed: true };

/**
 * Record yourself's pitch line (src/core/pitch.ts): once a take is made, its pitch drawn over the
 * card recording's, each around its own speaker's middle pitch. Worked out on the phone; the take
 * isn't sent anywhere, and nothing scores it. `caption` is a Thai word's tones from its romanization,
 * and `syllables` its syllables for the tone check under the chart (src/core/toneCheck.ts).
 * Nothing shows in a build without modules/audio-samples, or while a take is being measured.
 */
export function PitchLine({ takeUri, recordingUri, caption, syllables }: { takeUri: string; recordingUri: string; caption?: string | null; syllables?: readonly string[] }) {
  const c = useTheme();
  const [lines, setLines] = useState<Lines | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const cached = recordings.get(recordingUri);
        const recording = cached !== undefined ? cached : await lineOf(recordingUri);
        const yours = await lineOf(takeUri);
        if (recording === undefined || yours === undefined) return;
        recordings.set(recordingUri, recording);
        // The take or the card can change while these were measured: only this take's lines are kept.
        if (live) setLines({ take: takeUri, recording, yours });
      } catch {
        if (live) setLines({ take: takeUri, failed: true });
      }
    })();
    return () => { live = false; };
  }, [takeUri, recordingUri]);

  if (!lines || lines.take !== takeUri) return null;
  const box = { alignSelf: 'stretch' as const, gap: space.s, padding: space.m, borderRadius: radius.l, ...smooth, backgroundColor: c.surface, borderWidth: hairline, borderColor: c.border };

  if ('failed' in lines || !lines.yours) {
    return (
      <View style={{ ...box, alignItems: 'center' }} accessible accessibilityLabel="Couldn't hear a pitch in your take. Record it again a little louder, or closer to the phone.">
        <Text style={{ ...type.subhead, color: c.text, textAlign: 'center' }}>{"Couldn't hear a pitch in your take."}</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>Record it again a little louder, or closer to the phone.</Text>
      </View>
    );
  }

  const range = pitchRange(lines.recording, lines.yours);
  const grid = [HEIGHT / 4, HEIGHT / 2, (HEIGHT * 3) / 4];
  return (
    <View style={box} accessible accessibilityLabel={`Pitch line: your pitch drawn over the recording's${caption ? `. ${caption}` : ''}.`}>
      <View style={{ height: HEIGHT }}>
        <Svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
          {grid.map((y) => <Line key={y} x1={0} x2={WIDTH} y1={y} y2={y} stroke={c.border} strokeWidth={1} />)}
          {lines.recording ? <Path d={pitchPath(lines.recording, WIDTH, HEIGHT, range)} fill="none" stroke={c.accent} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" /> : null}
          <Path d={pitchPath(lines.yours, WIDTH, HEIGHT, range)} fill="none" stroke={c.countNew} strokeWidth={3} strokeDasharray="7 5" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
        <Text style={{ ...type.caption, color: c.textTertiary, position: 'absolute', top: 0, left: space.xs }}>higher</Text>
        <Text style={{ ...type.caption, color: c.textTertiary, position: 'absolute', bottom: 0, left: space.xs }}>lower</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.m }}>
        {lines.recording ? <Key color={c.accent} label="Recording" /> : <Text style={{ ...type.footnote, color: c.textSecondary }}>{"The recording's pitch couldn't be read."}</Text>}
        <Key color={c.countNew} label="Yours" dashed />
        {caption ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{caption}</Text> : null}
      </View>
      {lines.recording && syllables?.length ? <ToneCheck checks={toneCheck(lines.recording, lines.yours, syllables)} /> : null}
    </View>
  );
}

function Key({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 }}>
      <View style={{ width: 18, borderTopWidth: 3, borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }} />
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{label}</Text>
    </View>
  );
}

/**
 * Review's pitch line, under Record yourself: shown once a take is made, on a card with a recording,
 * in a language whose words pitch tells apart, or any language with Settings, Speaking's setting on
 * (`showsPitch`). A Thai card's caption names its tones from its Transliteration, which also gives
 * the syllables its tone check compares.
 */
export function ReviewPitchLine({ rec, recordingUri, speechLang, note }: {
  rec: Pick<SelfRecording, 'recording' | 'takeUri'>;
  recordingUri: string | undefined;
  speechLang: string | undefined;
  note: Note | undefined;
}) {
  const everyLanguage = pitchEveryLanguage.use();
  if (!rec.takeUri || rec.recording || !recordingUri || !showsPitch(speechLang, everyLanguage)) return null;
  const thai = speechLang?.toLowerCase().startsWith('th');
  const roman = thai && note ? htmlToText(note.fields.Transliteration ?? '') : '';
  const caption = roman ? toneCaption(roman) : null;
  return <PitchLine takeUri={rec.takeUri} recordingUri={recordingUri} caption={caption} syllables={roman ? thaiSyllables(roman) : undefined} />;
}
