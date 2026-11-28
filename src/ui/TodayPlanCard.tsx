import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { PlanItem } from '../tools/plan';
import { haptic } from './haptics';
import { Card, Divider, ErrorNote, Icon, Tappable } from './kit';
import { radius, smooth, space, type, useTheme } from './theme';
import type { useTodayPlan } from './useTodayPlan';

type Plan = ReturnType<typeof useTodayPlan>;

const ICONS: Record<PlanItem['kind'], React.ComponentProps<typeof Icon>['name']> = {
  reviews: 'arrow.triangle.2.circlepath',
  new: 'sparkles',
  read: 'book',
  watch: 'play.rectangle',
  listen: 'headphones',
  drill: 'checklist',
  speak: 'bubble.left.and.bubble.right',
  write: 'square.and.pencil',
};

/**
 * Today's plan at the top of Today (src/tools/plan.ts): the day's items in one language, each ticked
 * off as it's done wherever it's done, the minutes done of those planned, and the week's dots. A tap
 * opens the item; the gear opens its settings. In place of Daily extras' strip, whose drills are one
 * kind of item here.
 */
export function TodayPlanCard({ plan }: { plan: Plan }) {
  const c = useTheme();
  const router = useRouter();
  const [problem, setProblem] = useState<string>();
  if (!plan.on) return null;
  const tap = async (item: PlanItem) => {
    haptic.tap();
    setProblem(await plan.open(item));
  };
  return (
    <Card style={{ gap: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Text accessibilityRole="header" style={{ ...type.headline, color: c.text, flex: 1 }}>{`Today's plan · ${plan.languageName}`}</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{`${plan.doneMinutes} of ${plan.planned} min`}</Text>
        <Tappable onPress={() => router.push('/today-plan')} accessibilityRole="button" accessibilityLabel="Today's plan settings" style={{ padding: space.xs }}>
          <Icon name="gearshape" size={16} color={c.textSecondary} />
        </Tappable>
      </View>
      {plan.items.length ? (
        <View style={{ backgroundColor: c.fill, borderRadius: radius.m, overflow: 'hidden', ...smooth }}>
          {plan.items.map((item, i) => (
            <Tappable
              key={item.kind}
              onPress={() => void tap(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${item.detail}. About ${item.minutes} minutes${item.done ? '. Done' : ''}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 52, paddingVertical: space.s, paddingHorizontal: space.m }}
            >
              {i === 0 ? null : <Divider inset={space.m + 26 + space.m} />}
              <View style={{ width: 26, height: 26, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: item.done ? c.good : 'transparent', borderWidth: 2, borderColor: item.done ? c.good : c.border }}>
                {item.done ? <Icon name="checkmark" size={12} color={c.onRating} weight="bold" /> : <Icon name={ICONS[item.kind]} size={11} color={c.textSecondary} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={2} style={{ ...type.subhead, fontWeight: '500', color: item.done ? c.textSecondary : c.text, textDecorationLine: item.done ? 'line-through' : 'none' }}>{item.title}</Text>
                <Text style={{ ...type.footnote, color: c.textSecondary }}>{item.done ? 'Done' : item.detail}</Text>
              </View>
              <Text style={{ ...type.footnote, color: c.textTertiary, fontVariant: ['tabular-nums'] }}>{`${item.minutes} min`}</Text>
            </Tappable>
          ))}
        </View>
      ) : (
        <Text style={{ ...type.subhead, color: c.textSecondary }}>{`Nothing to do in ${plan.languageName} today.`}</Text>
      )}
      <View accessible accessibilityLabel={`This week: ${plan.week.filter((d) => d.outcome === 'all').length} days done, ${plan.week.filter((d) => d.outcome === 'part').length} partly`} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {plan.week.map((d) => (
          <View key={d.day} style={{ alignItems: 'center', gap: 3 }}>
            <View style={{ width: 9, height: 9, borderRadius: radius.pill, backgroundColor: d.outcome === 'all' ? c.good : d.outcome === 'part' ? c.accent : c.fill }} />
            <Text style={{ ...type.caption, color: c.textTertiary }}>{d.letter}</Text>
          </View>
        ))}
      </View>
      {problem ? <ErrorNote message={problem} /> : null}
    </Card>
  );
}
