import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { LANGUAGES } from '../../reader/languages';
import type { MoneyMode } from '../../tools/prefs';
import { breakDown, CURRENCIES, MONEY_MAXES, randomAmount, type MoneyMax } from '../../tools/money';
import { moneyPatterns } from '../../tools/patterns';
import { toolPrefs } from '../../tools/storage';
import { CURRENCY_OF, MONEY_SAYERS, toolLanguage } from '../../tools/tools';
import { haptic } from '../haptics';
import { Card, Segments } from '../kit';
import { space, type, useTheme } from '../theme';
import { Cash } from './Cash';
import type { ToolScreenProps } from './index';
import { AnswerCard, ControlLabel, ToolScreen, useAnswer, useToolLanguage, useToolPref } from './ToolScreen';
import { useMarks } from './useMarks';

const MODES: { value: MoneyMode; label: string }[] = [{ value: 'count', label: 'Notes and coins' }, { value: 'price', label: 'A price' }];

/**
 * Counting money: an amount in the chosen language's own money, as notes and coins to add up or
 * as a price to read, then said in that language and marked Missed it or Got it. A new amount
 * comes with each Randomize or mark, leaning toward the kinds missed lately (useMarks), and with a
 * change of language, mode or size, since another currency is priced in other steps.
 */
export function MoneyTool({ tool, repo }: ToolScreenProps) {
  const c = useTheme();
  const [language, setLanguage] = useToolLanguage(tool);
  const answer = useAnswer(repo, language);
  const marks = useMarks(tool.id, language);
  const [mode, setMode] = useToolPref('moneyMode');
  const [max, setMax] = useToolPref('moneyMax');
  const currency = CURRENCIES[CURRENCY_OF[language]];
  /** The amount, with the currency it's in, so one from another language's money is never shown. */
  const [held, setHeld] = useState(() => {
    const code = CURRENCY_OF[toolLanguage(tool, toolPrefs().language)];
    return { code, amount: randomAmount(CURRENCIES[code], toolPrefs().moneyMax) };
  });
  const amount = held.code === currency.code ? held.amount : undefined;
  const next = (m: MoneyMax = max) => {
    answer.hide();
    setHeld({ code: currency.code, amount: marks.pick(() => randomAmount(currency, m, amount), (a) => moneyPatterns(a, currency)) });
  };
  // Another language's money (chosen, or the saved language once it's read): a new amount in it.
  useEffect(() => {
    if (held.code !== currency.code) setHeld({ code: currency.code, amount: randomAmount(currency, max) });
  }, [held.code, currency, max]);

  const saying = useMemo(() => (amount === undefined ? undefined : MONEY_SAYERS[language]?.(amount)), [language, amount]);
  const pieces = useMemo(() => (amount === undefined ? [] : breakDown(amount, currency)), [amount, currency]);

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l) => { setLanguage(l); answer.hide(); }}
      shown={answer.shown}
      onRandomize={() => next()}
      onShow={() => answer.show(saying?.everyday)}
      onMark={(right) => { if (amount !== undefined) marks.mark(moneyPatterns(amount, currency), right); next(); }}
    >
      <Segments options={MODES} value={mode} onChange={(m) => { haptic.select(); answer.hide(); setMode(m); }} />

      <Card style={{ minHeight: 150, justifyContent: 'center' }}>
        {mode === 'count' ? (
          <Cash pieces={pieces} currency={currency} />
        ) : (
          <View style={{ alignItems: 'center', gap: space.xs }}>
            <Text maxFontSizeMultiplier={1.5} style={{ ...type.largeTitle, fontSize: 44, fontVariant: ['tabular-nums'], color: c.text }}>{saying?.written.text}</Text>
            <Text style={{ ...type.footnote, color: c.textSecondary }}>Say the price</Text>
          </View>
        )}
      </Card>

      <View style={{ gap: space.s }}>
        <ControlLabel>Amounts up to</ControlLabel>
        <Segments
          options={MONEY_MAXES.map((m) => ({ value: m, label: m.toLocaleString('en-US') }))}
          value={max}
          onChange={(m) => { haptic.select(); setMax(m); next(m); }}
        />
      </View>

      <AnswerCard
        shown={answer.shown}
        prompt={mode === 'count'
          ? `Add up the notes and coins, say the total in ${LANGUAGES[language].name}, then show the answer.`
          : `Say the price in ${LANGUAGES[language].name} out loud, then show the answer.`}
        answer={saying && { everyday: saying.everyday, also: saying.also, last: mode === 'count' ? { title: 'As written', phrase: saying.written } : undefined }}
        onPlay={answer.speak}
      />
    </ToolScreen>
  );
}
