import React, { useEffect, useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { problemText } from '../wanikani/api';
import { answerSummary, comingUp, STAGE_GROUPS, startedTotal, type LevelProgress } from '../wanikani/stats';
import { Card, Group, Help, Loading, Meter, NavRow, Screen } from './kit';
import type { WaniKaniState } from './useWaniKani';
import { stageColors } from './WaniKaniStageBar';
import { space, type, useTheme, readable } from './theme';
import { Figure } from './Figure';

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const CHART_HEIGHT = 64;

/**
 * WaniKani's progress, opened from its row's menu: the level and how far the next one is, items by
 * stage, the reviews coming up over the next day, and the answers given in Franki. The numbers come
 * from src/wanikani/stats.ts; the screen shows what was last read (kept offline) and reads again
 * when it opens. Answers over time are on Stats, under WaniKani.
 */
export function WaniKaniStats({ wanikani, onStats }: { wanikani: WaniKaniState; onStats: () => void }) {
  const c = useTheme();
  const { stats, user, refreshStats } = wanikani;
  useEffect(() => { refreshStats(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const answers = useMemo(() => answerSummary(wanikani.log, new Date(), wanikani.dayStartsAtHour), [wanikani.log, wanikani.dayStartsAtHour]);

  if (!stats) {
    return (
      <Screen title="WaniKani">
        <Loading error={wanikani.problem ? problemText(wanikani.problem) : null} onRetry={refreshStats} />
      </Screen>
    );
  }
  const colors = stageColors(c);
  const biggest = Math.max(1, ...STAGE_GROUPS.map((g) => stats.stages[g.key]));
  const peak = Math.max(1, ...stats.forecast);
  const tomorrow = comingUp(stats.forecast);
  const level = user?.level ?? stats.level;

  return (
    <Screen title="WaniKani">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        <Card>
          <Text style={{ ...type.title, color: c.text }}>Level {level}</Text>
          {stats.progress && stats.progress.level === level ? (
            <>
              <Meter value={stats.progress.kanjiPassed / stats.progress.needed} color={colors.guru} label={`${stats.progress.kanjiPassed} of ${stats.progress.needed} kanji needed at Guru`} />
              <Help>{levelHelp(stats.progress)}</Help>
            </>
          ) : level >= 60 ? <Help>This is WaniKani's last level.</Help> : null}
        </Card>

        <Card>
          <Text style={{ ...type.headline, color: c.text }}>Items by stage</Text>
          {STAGE_GROUPS.map((g) => (
            <View key={g.key} accessible accessibilityLabel={`${g.label}: ${stats.stages[g.key]}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
              <Text style={{ ...type.callout, color: c.text, width: 100 }}>{g.label}</Text>
              <View style={{ flex: 1 }}>
                <Meter value={stats.stages[g.key] / biggest} color={colors[g.key]} />
              </View>
              <Text style={{ ...type.callout, fontWeight: '600', color: c.text, width: 48, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{stats.stages[g.key].toLocaleString()}</Text>
            </View>
          ))}
          <Help>{plural(startedTotal(stats.stages), 'item', 'items')} started.</Help>
        </Card>

        <Card>
          <Text style={{ ...type.headline, color: c.text }}>Reviews coming up</Text>
          <View accessible accessibilityLabel={`Reviews per hour over the next day: ${stats.forecast.join(', ')}`} style={{ flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT, gap: 2 }}>
            {stats.forecast.map((n, i) => (
              <View key={i} style={{ flex: 1, height: n ? Math.max(2, (n / peak) * CHART_HEIGHT) : 0, backgroundColor: c.chart, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ ...type.footnote, color: c.textSecondary }}>Now</Text>
            <Text style={{ ...type.footnote, color: c.textSecondary }}>In 24 hours</Text>
          </View>
          <Help>
            {plural(stats.forecast[0], 'review is', 'reviews are')} up now. {plural(tomorrow, 'more comes', 'more come')} in the next 24 hours.
          </Help>
        </Card>

        <Card>
          <Text style={{ ...type.headline, color: c.text }}>Answered in Franki</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.m }}>
            <Figure style={{ width: '50%' }} value={answers.reviewsToday.toLocaleString()} label={answers.reviewsToday === 1 ? 'review today' : 'reviews today'} />
            <Figure style={{ width: '50%' }} value={answers.lessonsToday.toLocaleString()} label={answers.lessonsToday === 1 ? 'lesson today' : 'lessons today'} />
            <Figure style={{ width: '50%' }} value={answers.rightFirstTimeWeek === null ? 'None yet' : `${answers.rightFirstTimeWeek}%`} label="right first time, 7 days" />
            <Figure style={{ width: '50%' }} value={answers.reviewsWeek.toLocaleString()} label="reviews, 7 days" />
          </View>
          <Help>Answers given on wanikani.com aren't counted here.</Help>
        </Card>

        <Group>
          <NavRow first label="More in Stats" detail="Answers by day, a year's calendar" onPress={onStats} />
        </Group>
        <Help>Read {new Date(stats.savedAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}{wanikani.offline ? '. Offline, so this may be out of date.' : '.'}</Help>
      </ScrollView>
    </Screen>
  );
}

function levelHelp(p: LevelProgress): string {
  const have = `${p.kanjiPassed} of ${p.kanjiTotal} kanji are at Guru.`;
  return p.remaining === 0 ? `${have} That's enough for level ${p.level + 1}.` : `${have} ${p.remaining} more to reach level ${p.level + 1}.`;
}

