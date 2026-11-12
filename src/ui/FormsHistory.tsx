import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { CONFUSION_MISSES, CONFUSION_WORDS, FORM_CLEARED_AFTER } from '../core/forms';
import { practiceStats, type PracticeStats, type WeakFormStat } from '../core/formsStats';
import type { Repo } from '../db/repo';
import { Card, Help, Screen, SectionTitle } from './kit';
import { hairline, radius, space, type, useTheme } from './theme';

/** How many forms "Still needs work" lists before "and N more". */
const LISTED_FORMS = 10;

/**
 * What a deck's forms practice has shown so far: totals, the forms still owed right answers, the
 * same wrong answer given again and again, and the right rate by kind of form. Read-only; it
 * changes nothing, least of all when a card is due.
 */
export function FormsHistory({ repo, deck }: { repo: Repo; deck: string }) {
  const [stats, setStats] = useState<PracticeStats>();

  useEffect(() => {
    let live = true;
    (async () => {
      const [notes, practice] = await Promise.all([repo.listNotes(), repo.listPractice()]);
      if (live) setStats(practiceStats(deck, notes, practice, new Date()));
    })();
    return () => { live = false; };
  }, [repo, deck]);

  return (
    <Screen title="Practice history">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        {!stats ? null : !stats.answers ? <Empty /> : <Content stats={stats} />}
      </ScrollView>
    </Screen>
  );
}

function Empty() {
  const c = useTheme();
  return (
    <Card>
      <Text style={{ ...type.headline, color: c.text }}>No practice yet</Text>
      <Help>Practice a word's forms or a pattern, and the results show here.</Help>
    </Card>
  );
}

function Content({ stats }: { stats: PracticeStats }) {
  const c = useTheme();
  const percent = (right: number, answers: number) => Math.round((right / answers) * 100);
  const shown = stats.weak.slice(0, LISTED_FORMS);
  const hidden = stats.weak.length - shown.length;
  return (
    <>
      <View style={{ flexDirection: 'row', gap: space.m }}>
        <Total value={String(stats.answers)} label={`answers in ${stats.days === 1 ? '1 day' : `${stats.days} days`}`} />
        <Total value={`${percent(stats.right, stats.answers)}%`} label="right" />
      </View>

      <SectionTitle>Still needs work</SectionTitle>
      {shown.length ? (
        <Card style={{ gap: 0, paddingVertical: space.xs }}>
          {shown.map((w, i) => <WeakRow key={`${w.noteId}:${w.key}`} form={w} first={!i} />)}
        </Card>
      ) : (
        <Card><Help>Nothing right now. Every form you missed has been put right.</Help></Card>
      )}
      {hidden > 0 ? <Help>{hidden === 1 ? 'And 1 more form.' : `And ${hidden} more forms.`}</Help> : null}
      <Help>{`Each miss needs ${FORM_CLEARED_AFTER} right answers to clear. These are asked first in practice.`}</Help>

      <SectionTitle>Mixed up</SectionTitle>
      {stats.mixedUp.length ? (
        <Card style={{ gap: 0, paddingVertical: space.xs }}>
          {stats.mixedUp.map((m, i) => (
            <Row key={`${m.expected}:${m.given}`} first={!i} label={`“${m.given}” for “${m.expected}”`} detail={`${m.misses} times, across ${m.words} words`} />
          ))}
        </Card>
      ) : null}
      <Help>
        {`A mix-up is the same wrong answer given ${CONFUSION_MISSES} times across ${CONFUSION_WORDS} or more words. Only answers kept from now on can show one. Forms with these answers come up sooner in practice.`}
      </Help>

      <SectionTitle>By kind of form</SectionTitle>
      <Card style={{ gap: 0, paddingVertical: space.xs }}>
        {stats.byGroup.map((g, i) => {
          const p = percent(g.right, g.answers);
          return (
            <View
              key={g.group}
              accessible
              accessibilityLabel={`${g.group}: ${p} percent right, ${g.answers} answers`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 52, paddingVertical: space.s, borderTopWidth: i ? hairline : 0, borderTopColor: c.border }}
            >
              <View style={{ flex: 1, gap: space.xs }}>
                <Text style={{ ...type.headline, color: c.text }}>{g.group}</Text>
                <View style={{ height: 8, borderRadius: radius.s, backgroundColor: c.fill, overflow: 'hidden' }}>
                  <View style={{ width: `${p}%`, height: '100%', backgroundColor: c.chart }} />
                </View>
              </View>
              <Text style={{ ...type.subhead, fontWeight: '600', color: c.text, width: 48, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{`${p}%`}</Text>
            </View>
          );
        })}
      </Card>
    </>
  );
}

function Total({ value, label }: { value: string; label: string }) {
  const c = useTheme();
  return (
    <Card style={{ flex: 1, gap: 0 }}>
      <Text style={{ ...type.title, color: c.text, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{label}</Text>
    </Card>
  );
}

function WeakRow({ form, first }: { form: WeakFormStat; first: boolean }) {
  const since = form.rightSince === 0 ? '' : form.rightSince === 1 ? ' Right once since the last miss.' : ` Right ${form.rightSince} times since the last miss.`;
  return <Row first={first} label={form.name} detail={`Missed ${form.misses} of ${form.attempts}.${since}`} trailing={form.answer} />;
}

function Row({ label, detail, trailing, first }: { label: string; detail: string; trailing?: string; first: boolean }) {
  const c = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}. ${detail}${trailing ? ` Answer: ${trailing}` : ''}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 52, paddingVertical: space.s, borderTopWidth: first ? 0 : hairline, borderTopColor: c.border }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.headline, color: c.text }}>{label}</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>{detail}</Text>
      </View>
      {trailing ? <Text style={{ ...type.subhead, fontWeight: '600', color: c.text }}>{trailing}</Text> : null}
    </View>
  );
}
