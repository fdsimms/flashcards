import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { GAP_SHOWN, type ContrastSet, type ShownSentence } from '../../tools/contrasts';
import type { Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { hasThai } from '../../core/script';
import { haptic } from '../haptics';
import { Icon, Tappable } from '../kit';
import { hairline, radius, smooth, space, type, useTheme } from '../theme';
import { RuleLine, Status } from './ToolScreen';

/**
 * Which word fits' pieces (src/tools/contrasts.ts), shared by its skill card in Review (SkillDrill.tsx)
 * and the Practice tool (ContrastTool.tsx): the sentence with its gap, and the set's words to pick from.
 */

/** The verdict after a pick: Right, or which word it was. A pick from a few words is right or it isn't, so never "Not quite". */
export function ContrastVerdict({ right, answer }: { right: boolean; answer: string }) {
  return right ? <Status tone="good">Right.</Status> : <Status tone="bad">{`Incorrect. It's ${answer}.`}</Status>;
}

/**
 * The sentence: with its gap until a word is picked, then filled in, romanized, and with the rule for
 * the word that fits. The English stays hidden behind Show English until then, so the Thai has to be
 * read; once answered it always shows.
 */
export function ContrastSentenceView({ shown, answered, verdict, speech }: { shown: ShownSentence; answered: boolean; verdict?: React.ReactNode; /** The sentence's language as a speech tag, so it draws in that language's font. */ speech?: string }) {
  const c = useTheme();
  const [peek, setPeek] = useState(false);
  const thai = hasThai(shown.filled);
  const sentenceStyle = { ...(thai ? { fontSize: 26, lineHeight: 40 } : { fontSize: 24, lineHeight: 34 }), fontWeight: '500' as const, color: c.text, textAlign: 'center' as const };
  return (
    <View style={{ alignSelf: 'stretch', gap: space.l, alignItems: 'center' }}>
      {verdict}
      <Text selectable accessibilityLanguage={speech} maxFontSizeMultiplier={1.5} style={sentenceStyle}>
        {shown.before}
        {answered
          ? <Text style={{ fontWeight: '700', color: c.goodInk }}>{shown.fill}</Text>
          : <Text accessibilityLabel="blank" style={{ color: c.textTertiary }}>{GAP_SHOWN}</Text>}
        {shown.after}
      </Text>
      {answered && shown.roman ? <Text selectable accessibilityLanguage={speech} style={{ ...type.subhead, color: c.textBody, textAlign: 'center' }}>{shown.roman}</Text> : null}
      {answered || peek ? (
        <Text selectable style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{shown.english}</Text>
      ) : (
        <Tappable
          onPress={() => { haptic.select(); setPeek(true); }}
          accessibilityRole="button"
          accessibilityLabel="Show English"
          scaleTo={0.96}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, paddingHorizontal: space.m + 2, paddingVertical: space.xs + 2, borderRadius: radius.pill, backgroundColor: c.fill }}
        >
          <Icon name="eye" size={14} color={c.textSecondary} />
          <Text style={{ ...type.subhead, fontWeight: '500', color: c.textSecondary }}>Show English</Text>
        </Tappable>
      )}
      {answered ? (
        <View style={{ alignSelf: 'stretch', gap: space.xs, backgroundColor: c.fill, borderRadius: radius.m, ...smooth, padding: space.m }}>
          <Text accessibilityLanguage={speech} style={{ ...type.overline, color: c.textSecondary }}>{shown.answer.word}</Text>
          <RuleLine rule={shown.answer.rule} />
        </View>
      ) : null}
    </View>
  );
}

/** The set's words as buttons: open until one is picked, then the right one marked, and a wrong pick too. */
export function ContrastChoices({ set, language, answer, picked, onPick }: { set: ContrastSet; language: Language; answer: number; picked: number | undefined; onPick: (index: number) => void }) {
  const c = useTheme();
  const speech = LANGUAGES[language].speech;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
      {set.words.map((w, i) => {
        const isRight = picked !== undefined && i === answer;
        const isWrong = picked === i && i !== answer;
        const thai = hasThai(w.word);
        return (
          <Tappable
            key={w.word}
            onPress={() => onPick(i)}
            disabled={picked !== undefined}
            accessibilityRole="button"
            accessibilityLanguage={speech}
            accessibilityLabel={`${w.word}${isRight ? ', right' : isWrong ? ', your pick, incorrect' : ''}`}
            accessibilityState={{ selected: picked === i, disabled: picked !== undefined }}
            scaleTo={0.97}
            style={{
              flexGrow: 1, flexBasis: 60, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs,
              paddingHorizontal: space.s, backgroundColor: c.surface, borderRadius: radius.m, ...smooth,
              borderWidth: isRight || isWrong ? 1.5 : hairline, borderColor: isRight ? c.countDue : isWrong ? c.danger : c.border,
            }}
          >
            <Text accessibilityLanguage={speech} style={{ ...(thai ? { fontSize: 20, lineHeight: 30 } : type.headline), color: c.text, fontWeight: isRight ? '600' : '400' }}>{w.word}</Text>
            {isRight ? <Icon name="checkmark.circle.fill" size={16} color={c.countDue} /> : null}
            {isWrong ? <Icon name="xmark.circle.fill" size={16} color={c.danger} /> : null}
          </Tappable>
        );
      })}
    </View>
  );
}
