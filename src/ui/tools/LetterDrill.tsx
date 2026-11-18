import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { Language } from '../../reader/api';
import type { Phrase } from '../../tools/phrase';
import { randomWord } from '../../tools/script';
import { CLASS_NAMES, CLASSES, CONSONANTS, consonantPatterns, consonantSteps, VOWELS, vowelPatterns, vowelSteps, vowelSyllable } from '../../tools/thai/letters';
import { haptic } from '../haptics';
import { Card } from '../kit';
import { Reveal } from '../motion';
import { hairline, radius, space, type, useTheme } from '../theme';
import type { ToolScreenProps } from './index';
import { OptionChoices } from './OptionChoices';
import { nextOnly, PlayButton, Status, ToolScreen, useAnswer, type ToolActions } from './ToolScreen';
import { useMarks } from './useMarks';
import { useRetries } from './useRetries';

export type LetterMode = 'consonants' | 'vowels';

const LENGTHS = [{ value: 'short', label: 'Short' }, { value: 'long', label: 'Long' }] as const;
const CLASS_OPTIONS = CLASSES.map((cls) => ({ value: cls, label: CLASS_NAMES[cls] }));

/**
 * Thai's letters in Reading the script: a consonant to place in its class (middle, high or low),
 * or a vowel to call short or long. Those two decide a syllable's tone (thai/script.ts), so a miss
 * leans the next letter toward what was missed lately (useMarks), and one missed comes back a few
 * letters later. Picking shows the letter's name and sound, or the vowel's sound and an example.
 * Nothing is scheduled or saved; `practice` is the mode chips, kept in ScriptTool.
 */
export function LetterDrill({ tool, repo, language, onLanguage, mode, practice }: Pick<ToolScreenProps, 'tool' | 'repo'> & {
  language: Language;
  onLanguage: (l: Language) => void;
  mode: LetterMode;
  practice: React.ReactNode;
}) {
  const c = useTheme();
  const answer = useAnswer(repo, language);
  const marks = useMarks(tool.id, language);
  const retries = useRetries<number>();
  const consonants = mode === 'consonants';
  const count = consonants ? CONSONANTS.length : VOWELS.length;
  const patternsOf = (i: number) => (consonants ? consonantPatterns(CONSONANTS[i]) : vowelPatterns(VOWELS[i]));
  const scope = `${language}|${mode}`;

  const [held, setHeld] = useState(() => ({ mode, index: randomWord(count) }));
  // The mode changed under this screen: a letter of the new one.
  const index = held.mode === mode ? held.index : undefined;
  useEffect(() => {
    if (held.mode !== mode) setHeld({ mode, index: randomWord(count) });
  }, [held.mode, mode, count]);

  const consonant = consonants && index !== undefined ? CONSONANTS[index] : undefined;
  const vowel = !consonants && index !== undefined ? VOWELS[index] : undefined;
  const key = `${mode}|${index}`;
  const right: string | undefined = consonant ? consonant.cls : vowel ? (vowel.long ? 'long' : 'short') : undefined;
  /** What a voice can say: a consonant's name, or a word with the vowel (a vowel alone isn't a word). */
  const spoken: Phrase | undefined = consonant ? { text: consonant.say } : vowel ? { text: vowel.example.text } : undefined;

  const [picked, setPicked] = useState<{ key: string; choice: string | null } | null>(null);
  const pick = picked?.key === key ? picked : null;
  const [marked, setMarked] = useState<string | null>(null);
  const mark = (isRight: boolean) => {
    if (index === undefined || marked === key) return;
    setMarked(key);
    marks.mark(patternsOf(index), isRight);
    if (!isRight) retries.missed(scope, String(index), index);
  };
  const next = () => {
    answer.hide();
    setPicked(null);
    setMarked(null);
    const draw = () => marks.pick(() => randomWord(count, index), patternsOf);
    setHeld({ mode, index: retries.next(scope, index === undefined ? undefined : String(index), draw) });
  };
  /** A pick, or null for Show answer, which counts as a miss. */
  const choose = (choice: string | null) => {
    if (pick || right === undefined) return;
    setPicked({ key, choice });
    mark(choice === right);
    if (choice) haptic.answer();
    if (spoken) answer.speak(spoken);
  };

  const actions: ToolActions = pick ? nextOnly(next) : { secondary: { label: 'Another one', onPress: next }, primary: { label: 'Show answer', onPress: () => choose(null) } };
  const shown = consonant?.letter ?? vowel?.shown;

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l) => { onLanguage(l); answer.hide(); }}
      shown={answer.shown}
      onRandomize={next}
      onShow={() => choose(null)}
      onMark={(isRight) => { mark(isRight); next(); }}
      actions={actions}
    >
      <Card style={{ minHeight: 140, alignItems: 'center', justifyContent: 'center', gap: space.xs }}>
        <Text selectable maxFontSizeMultiplier={1.5} style={{ ...type.cardFront, fontSize: 64, lineHeight: 88, color: c.text }}>{shown}</Text>
        <Text style={{ ...type.subhead, color: c.textSecondary }}>{consonants ? 'Which class?' : 'Short or long?'}</Text>
      </Card>

      {right !== undefined ? (
        consonants
          ? <OptionChoices options={CLASS_OPTIONS} right={right as typeof CLASSES[number]} picked={pick as { choice: typeof CLASSES[number] | null } | null} onChoose={choose} />
          : <OptionChoices options={[...LENGTHS]} right={right as 'short' | 'long'} picked={pick as { choice: 'short' | 'long' | null } | null} onChoose={choose} />
      ) : null}

      {pick && right !== undefined && (consonant || vowel) ? (
        <Reveal>
          <Card>
            {pick.choice === null ? null : pick.choice === right
              ? <Status tone="good">{consonant ? `Right. ${CLASS_NAMES[consonant.cls]} class.` : `Right. ${vowel!.long ? 'Long' : 'Short'}.`}</Status>
              : <Status tone="bad">{consonant ? `Not quite. It's ${CLASS_NAMES[consonant.cls].toLowerCase()} class.` : `Not quite. It's ${vowel!.long ? 'long' : 'short'}.`}</Status>}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
              <View style={{ flex: 1, gap: space.xs }}>
                <Text style={{ ...type.cardBack, color: c.text }}>{consonant ? consonant.name : vowelSyllable(vowel!)}</Text>
                <Text style={{ ...type.subhead, color: c.textSecondary }}>{consonant ? `${consonant.word}, ${consonant.meaning}` : vowelSteps(vowel!)[0]}</Text>
              </View>
              <PlayButton label={consonant ? `Play ${consonant.letter}` : `Play ${vowel!.example.text}`} onPress={() => spoken && answer.speak(spoken)} />
            </View>
            {consonant?.rarity ? (
              <View style={{ alignSelf: 'flex-start', backgroundColor: c.fill, borderRadius: radius.pill, paddingHorizontal: space.s, paddingVertical: space.xs }}>
                <Text style={{ ...type.caption, fontWeight: '600', color: c.textSecondary }}>{consonant.rarity === 'obsolete' ? 'No longer used' : 'Rare'}</Text>
              </View>
            ) : null}
            <View style={{ gap: space.s, borderTopWidth: hairline, borderTopColor: c.border, paddingTop: space.m }}>
              <Text style={{ ...type.overline, color: c.textSecondary }}>{consonant ? 'How to remember' : 'Why it matters'}</Text>
              {(consonant ? consonantSteps(consonant) : vowelSteps(vowel!).slice(1)).map((step) => <Text key={step} style={{ ...type.subhead, color: c.text }}>{step}</Text>)}
            </View>
          </Card>
        </Reveal>
      ) : null}

      {practice}
    </ToolScreen>
  );
}
