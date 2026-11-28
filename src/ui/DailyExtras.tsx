import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { LANGUAGES } from '../reader/languages';
import { saveToolPrefs } from '../tools/storage';
import { toolById } from '../tools/tools';
import { haptic } from './haptics';
import { Button, Card, Divider, ErrorNote, Help, Icon, Meter, Tag, Tappable } from './kit';
import { radius, smooth, space, type, useTheme } from './theme';
import { TOOL_SCREENS } from './tools';
import type { GrammarDue } from './useGrammarDue';
import type { ExtraItem, useDailyExtras } from './useDailyExtras';

type Extras = ReturnType<typeof useDailyExtras>;

/**
 * Today's extras on the Today tab (src/tools/extras.ts): one row per extra with a progress bar under
 * the count, checked off once it's done. A tap opens the drill or the text. Grammar due today
 * (`grammarDue`, from the same schedule as the Grammar screen) is its own group of rows, one per
 * language that has some; it isn't one of the day's planned extras, so it isn't counted in "done".
 * Nothing shows when there is nothing, so the list is as it was.
 */
export function ExtrasStrip({ extras, grammarDue, inPlan = false }: { extras: Extras; grammarDue?: GrammarDue | null; /** Today's plan is showing, with the drills as its items: only Grammar due is listed here. */ inPlan?: boolean }) {
  const c = useTheme();
  const router = useRouter();
  const [problem, setProblem] = useState<string>();
  const listed = inPlan ? [] : extras.items;
  if (!listed.length && !grammarDue?.total) return null;
  const tap = async (item: ExtraItem) => {
    haptic.tap();
    setProblem(await extras.open(item.extra));
  };
  const planned = listed.length;
  return (
    <Card style={{ gap: space.m }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text accessibilityRole="header" style={{ ...type.headline, color: c.text }}>{inPlan ? 'Grammar' : "Today's extras"}</Text>
        {planned ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{`${extras.done} of ${planned} done`}</Text> : null}
      </View>
      {planned ? (
        <>
          <Meter value={extras.done / planned} color={c.countDue} label={`${extras.done} of ${planned} done`} />
          <ExtraRows>
            {listed.map((item, i) => (
              <ExtraRow
                key={`${item.extra.language}|${item.extra.kind}`}
                first={i === 0}
                icon={item.done ? 'checkmark.circle.fill' : extraIcon(item)}
                iconColor={item.done ? c.countDue : c.textSecondary}
                tileFill={item.done ? c.goodFill : c.surface}
                title={extraWhat(item.extra.kind)}
                done={item.done}
                detail={item.done ? `${LANGUAGES[item.extra.language].name}, done` : LANGUAGES[item.extra.language].name}
                accessibilityLabel={`${item.title}. ${item.detail}`}
                onPress={() => tap(item)}
              />
            ))}
          </ExtraRows>
        </>
      ) : null}
      {grammarDue?.languages.length ? (
        <>
          <Text style={{ ...type.footnote, color: c.textSecondary, marginTop: planned ? space.xs : 0 }}>Grammar due</Text>
          <ExtraRows>
            {grammarDue.languages.map(({ language, count }, i) => (
              <ExtraRow
                key={`grammar|${language}`}
                first={i === 0}
                icon={TOOL_SCREENS.grammar.icon}
                iconColor={c.violetInk}
                tileFill={c.violetFill}
                title={LANGUAGES[language].name}
                badge={{ text: String(count), color: c.violetInk, fill: c.violetFill }}
                accessibilityLabel={`${LANGUAGES[language].name} grammar: ${count} due today`}
                onPress={() => { haptic.tap(); saveToolPrefs({ language }); router.push({ pathname: '/tool', params: { id: 'grammar' } }); }}
              />
            ))}
          </ExtraRows>
        </>
      ) : null}
      {problem ? <ErrorNote message={problem} /> : null}
    </Card>
  );
}

const TILE = 30;

/** A quiet well holding `ExtraRow`s, set inside the card. */
function ExtraRows({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return <View style={{ backgroundColor: c.fill, borderRadius: radius.m, overflow: 'hidden', ...smooth }}>{children}</View>;
}

function ExtraRow({ icon, iconColor, tileFill, title, detail, badge, done, first, accessibilityLabel, onPress }: {
  icon: React.ComponentProps<typeof Icon>['name'];
  iconColor: string;
  tileFill: string;
  title: string;
  detail?: string;
  badge?: React.ComponentProps<typeof Tag>;
  done?: boolean;
  first?: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const c = useTheme();
  return (
    <Tappable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 48, paddingVertical: space.s, paddingHorizontal: space.m }}
    >
      {first ? null : <Divider inset={space.m + TILE + space.m} />}
      <View style={{ width: TILE, height: TILE, borderRadius: radius.s, ...smooth, backgroundColor: tileFill, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={16} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.subhead, fontWeight: '500', color: done ? c.textSecondary : c.text, textDecorationLine: done ? 'line-through' : 'none' }}>{title}</Text>
        {detail ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{detail}</Text> : null}
      </View>
      {badge ? <Tag {...badge} /> : null}
      <Icon name="chevron.right" size={14} color={c.textTertiary} weight="semibold" />
    </Tappable>
  );
}

const extraIcon = (item: ExtraItem) => (item.extra.kind === 'read' ? 'book' as const : TOOL_SCREENS[item.extra.kind].icon);

/** What an extra asks for, without its language ("Read a text", "Counting things"). */
const extraWhat = (kind: ExtraItem['extra']['kind']) => (kind === 'read' ? 'Read a text' : toolById(kind)?.title ?? '');

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
  const what = extraWhat(kind);
  const about = kind === 'read' ? `Opens Read & Listen in ${name}.` : toolById(kind)?.summary ?? '';
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
      {problem ? <ErrorNote message={problem} /> : null}
    </Card>
  );
}
