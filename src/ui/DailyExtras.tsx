import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { LANGUAGES } from '../reader/languages';
import { saveToolPrefs } from '../tools/storage';
import { toolById } from '../tools/tools';
import { haptic } from './haptics';
import { Button, Card, Help, Icon, Tappable } from './kit';
import { radius, smooth, space, type, useTheme } from './theme';
import { TOOL_SCREENS } from './tools';
import type { GrammarDue } from './useGrammarDue';
import type { ExtraItem, useDailyExtras } from './useDailyExtras';

type Extras = ReturnType<typeof useDailyExtras>;

/**
 * Today's extras on the Today tab (src/tools/extras.ts): a strip of chips under the day's count,
 * one per extra, checked off once it's done. A tap opens the drill or the text. Grammar due today
 * (`grammarDue`, from the same schedule as the Grammar screen) is a chip for each language that has
 * some; it isn't one of the day's planned extras, so it isn't counted in "done". Nothing shows when
 * there is nothing, so the list is as it was.
 */
export function ExtrasStrip({ extras, grammarDue }: { extras: Extras; grammarDue?: GrammarDue | null }) {
  const c = useTheme();
  const router = useRouter();
  const [problem, setProblem] = useState<string>();
  if (!extras.items.length && !grammarDue?.total) return null;
  const tap = async (item: ExtraItem) => {
    haptic.tap();
    setProblem(await extras.open(item.extra));
  };
  return (
    <Card style={{ gap: space.m }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text accessibilityRole="header" style={{ ...type.headline, color: c.text }}>Today's extras</Text>
        {extras.items.length ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{`${extras.done} of ${extras.items.length} done`}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {extras.items.map((item) => (
          <Tappable
            key={`${item.extra.language}|${item.extra.kind}`}
            onPress={() => tap(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.detail}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 36, paddingVertical: space.s, paddingLeft: space.m, paddingRight: space.m, borderRadius: radius.pill, ...smooth, backgroundColor: item.done ? c.goodFill : c.fill }}
          >
            <Icon name={item.done ? 'checkmark.circle.fill' : extraIcon(item)} size={16} color={item.done ? c.countDue : c.textSecondary} />
            <Text style={{ ...type.subhead, color: item.done ? c.textSecondary : c.text }}>{chipLabel(item)}</Text>
          </Tappable>
        ))}
        {grammarDue?.languages.map(({ language, count }) => (
          <Tappable
            key={`grammar|${language}`}
            onPress={() => { haptic.tap(); saveToolPrefs({ language }); router.push({ pathname: '/tool', params: { id: 'grammar' } }); }}
            accessibilityRole="button"
            accessibilityLabel={`${LANGUAGES[language].name} grammar: ${count} due today`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 36, paddingVertical: space.s, paddingLeft: space.m, paddingRight: space.m, borderRadius: radius.pill, ...smooth, backgroundColor: c.accentFill }}
          >
            <Icon name={TOOL_SCREENS.grammar.icon} size={16} color={c.accent} />
            <Text style={{ ...type.subhead, color: c.text }}>{`${LANGUAGES[language].name} grammar: ${count} due`}</Text>
          </Tappable>
        ))}
      </View>
      {problem ? <Text style={{ ...type.footnote, color: c.danger }}>{problem}</Text> : null}
    </Card>
  );
}

const extraIcon = (item: ExtraItem) => (item.extra.kind === 'read' ? 'book' as const : TOOL_SCREENS[item.extra.kind].icon);

/** "Thai Numbers": the language and what, without the colon the list rows use. */
const chipLabel = (item: ExtraItem) => item.title.replace(': ', ' ');

/**
 * The end of a deck's session: the next extra for that deck's language, if it has one today and
 * it isn't done, above the usual next steps. The same plan as Today's strip.
 */
export function ExtraCard({ extras, language }: { extras: Extras; language: keyof typeof LANGUAGES }) {
  const c = useTheme();
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const item = extras.items.find((i) => i.extra.language === language && !i.done);
  if (!item) return null;
  const { kind } = item.extra;
  const name = LANGUAGES[language].name;
  const what = kind === 'read' ? 'Read a text' : toolById(kind)?.title ?? '';
  const about = kind === 'read' ? `Opens your ${name} shelf in Read & Listen.` : toolById(kind)?.summary ?? '';
  const go = async () => {
    if (busy) return;
    haptic.tap();
    setBusy(true);
    setProblem(await extras.open(item.extra));
    setBusy(false);
  };
  return (
    <Card style={{ alignSelf: 'stretch', borderColor: c.accent, marginTop: space.m }}>
      <Text style={{ ...type.overline, color: c.accent }}>{`Today's extra for ${name}`}</Text>
      <View style={{ gap: space.xs }}>
        <Text style={{ ...type.headline, color: c.text }}>{what}</Text>
        <Help>{about}</Help>
      </View>
      <Button label={kind === 'read' ? 'Read a text' : 'Practice'} onPress={go} busy={busy} />
      {problem ? <Text style={{ ...type.footnote, color: c.danger }}>{problem}</Text> : null}
    </Card>
  );
}
