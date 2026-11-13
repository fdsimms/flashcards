import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { LANGUAGES } from '../../reader/languages';
import type { Phrase } from '../../tools/phrase';
import { randomWord, type ScriptMode } from '../../tools/script';
import { toolPrefs } from '../../tools/storage';
import { SYLLABLES, TONE_NAMES, TONES, toneOf, toneSteps, type Tone } from '../../tools/thai/script';
import { SCRIPTS, toolLanguage } from '../../tools/tools';
import { haptic } from '../haptics';
import { Card, Icon, Tappable } from '../kit';
import { Reveal } from '../motion';
import { hairline, radius, smooth, space, type, useTheme } from '../theme';
import type { ToolScreenProps } from './index';
import { AnswerCard, ChipChoice, nextOnly, PlayButton, Status, ToolScreen, useAnswer, useToolLanguage, useToolPref, type ToolActions } from './ToolScreen';
import { useMarks } from './useMarks';
import { useRetries } from './useRetries';

const MODES: { value: ScriptMode; label: string }[] = [{ value: 'tone', label: 'Name the tone' }, { value: 'read', label: 'Read it aloud' }];

/**
 * Reading the script: a word in the language's own letters. Read it aloud, then show the answer
 * (with its stress, or tone, and a romanization) and mark it Missed it or Got it; a miss shows
 * what's worth knowing to read it. In Thai, Name the tone asks for the syllable's tone, worked
 * out from how it's written (thai/script.ts), and shows the steps. A new word leans toward the
 * letters and tone rules missed lately (useMarks), and one missed comes back a few words later.
 */
export function ScriptTool({ tool, repo }: ToolScreenProps) {
  const c = useTheme();
  const [language, setLanguage] = useToolLanguage(tool);
  const answer = useAnswer(repo, language);
  const marks = useMarks(tool.id, language);
  const retries = useRetries<number>();
  const [savedMode, setMode] = useToolPref('scriptMode');
  // Only Thai's tones can be named; the other languages are read aloud.
  const mode: ScriptMode = language === 'th' ? savedMode : 'read';
  const script = SCRIPTS[language];
  const [held, setHeld] = useState(() => {
    const l = toolLanguage(tool, toolPrefs().language);
    return { language: l, word: randomWord(SCRIPTS[l]?.words.length ?? 1) };
  });
  const index = held.language === language ? held.word : undefined;
  useEffect(() => {
    if (held.language !== language && script) setHeld({ language, word: randomWord(script.words.length) });
  }, [held.language, language, script]);

  const word = index !== undefined ? script?.words[index] : undefined;
  const rule = index !== undefined ? script?.rule(index) : undefined;
  const key = `${language}|${index}`;
  /** Read aloud as written: a stress mark isn't something a voice reads. */
  const spoken: Phrase | undefined = word && { text: word.shown };

  const [picked, setPicked] = useState<{ key: string; tone: Tone | null } | null>(null);
  const pick = picked?.key === key ? picked : null;
  const [marked, setMarked] = useState<string | null>(null);
  const mark = (right: boolean) => {
    if (index === undefined || !script || marked === key) return;
    setMarked(key);
    marks.mark(script.patterns(index), right);
    if (!right) retries.missed(language, String(index), index);
  };
  const next = () => {
    if (!script) return;
    answer.hide();
    setPicked(null);
    setMarked(null);
    const draw = () => marks.pick(() => randomWord(script.words.length, index), (i) => script.patterns(i));
    setHeld({ language, word: retries.next(language, index === undefined ? undefined : String(index), draw) });
  };

  const syllable = language === 'th' && index !== undefined ? SYLLABLES[index] : undefined;
  const tone = useMemo(() => (syllable ? toneOf(syllable) : undefined), [syllable]);
  const chooseTone = (t: Tone | null) => {
    if (pick || !tone) return;
    setPicked({ key, tone: t });
    mark(t === tone);
    if (t) haptic.answer();
    if (spoken) answer.speak(spoken);
  };

  let actions: ToolActions | undefined;
  if (mode === 'tone') actions = pick ? { primary: { label: 'Next', onPress: next } } : { secondary: { label: 'Randomize', onPress: next }, primary: { label: 'Show answer', onPress: () => chooseTone(null) } };
  else if (answer.missed) actions = nextOnly(next);

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l) => { setLanguage(l); answer.hide(); }}
      shown={answer.shown}
      onRandomize={next}
      onShow={() => answer.show(spoken)}
      onMark={(right) => {
        mark(right);
        if (!right && rule) answer.miss();
        else next();
      }}
      actions={actions}
    >
      <Card style={{ minHeight: 140, alignItems: 'center', justifyContent: 'center', gap: space.xs }}>
        <Text selectable maxFontSizeMultiplier={1.5} style={{ ...type.cardFront, fontSize: language === 'th' ? 56 : 40, lineHeight: language === 'th' ? 80 : 52, color: c.text }}>{word?.shown}</Text>
        <Text style={{ ...type.subhead, color: c.textSecondary }}>{mode === 'tone' ? 'Which tone?' : word?.meaning}</Text>
      </Card>

      {mode === 'tone' && syllable && tone && word ? (
        <>
          <ToneChoices tone={tone} picked={pick} onChoose={chooseTone} />
          {pick ? (
            <Reveal>
              <Card>
                {pick.tone === null ? null : pick.tone === tone
                  ? <Status tone="good">{`Right. ${TONE_NAMES[tone]} tone.`}</Status>
                  : <Status tone="bad">{`Not quite. It's ${TONE_NAMES[tone].toLowerCase()}.`}</Status>}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
                  <View style={{ flex: 1, gap: space.xs }}>
                    <Text style={{ ...type.cardBack, color: c.text }}>{word.answer.roman}</Text>
                    <Text style={{ ...type.subhead, color: c.textSecondary }}>{word.meaning}</Text>
                  </View>
                  <PlayButton label={`Play ${word.shown}`} onPress={() => spoken && answer.speak(spoken)} />
                </View>
                <View style={{ gap: space.s, borderTopWidth: 0.5, borderTopColor: c.border, paddingTop: space.m }}>
                  <Text style={{ ...type.overline, color: c.textSecondary }}>How to tell</Text>
                  {toneSteps(syllable).map((step) => <Text key={step} style={{ ...type.subhead, color: c.text }}>{step}</Text>)}
                </View>
              </Card>
            </Reveal>
          ) : null}
        </>
      ) : (
        <AnswerCard
          shown={answer.shown}
          prompt={`Read it aloud in ${LANGUAGES[language].name}, then show the answer.`}
          answer={word && { everyday: word.answer, also: [] }}
          rule={answer.missed ? rule : undefined}
          onPlay={() => spoken && answer.speak(spoken)}
        />
      )}

      {language === 'th' ? <ChipChoice label="Practice" options={MODES} value={mode} onChange={(m) => { setMode(m); answer.hide(); }} /> : null}
    </ToolScreen>
  );
}

/** The five tones to choose from, the right one and a wrong pick marked once chosen. */
function ToneChoices({ tone, picked, onChoose }: { tone: Tone; picked: { tone: Tone | null } | null; onChoose: (t: Tone) => void }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
      {TONES.map((t) => {
        const isRight = !!picked && t === tone;
        const isWrong = picked?.tone === t && t !== tone;
        return (
          <Tappable
            key={t}
            onPress={() => onChoose(t)}
            disabled={!!picked}
            accessibilityRole="button"
            accessibilityLabel={`${TONE_NAMES[t]}${isRight ? ', right' : isWrong ? ', wrong' : ''}`}
            accessibilityState={{ selected: picked?.tone === t, disabled: !!picked }}
            scaleTo={0.97}
            style={{
              flexGrow: 1, flexBasis: 60, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs,
              paddingHorizontal: space.s, backgroundColor: c.surface, borderRadius: radius.m, ...smooth,
              borderWidth: isRight || isWrong ? 1.5 : hairline, borderColor: isRight ? c.countDue : isWrong ? c.danger : c.border,
            }}
          >
            <Text style={{ ...type.subhead, color: c.text, fontWeight: isRight ? '600' : '400' }}>{TONE_NAMES[t]}</Text>
            {isRight ? <Icon name="checkmark.circle.fill" size={16} color={c.countDue} /> : null}
            {isWrong ? <Icon name="xmark.circle.fill" size={16} color={c.danger} /> : null}
          </Tappable>
        );
      })}
    </View>
  );
}
