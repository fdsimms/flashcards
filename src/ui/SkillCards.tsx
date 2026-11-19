import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { addSkillCards } from '../anki/skillCards';
import { refreshFromKeptCollection } from '../anki/transfer';
import { studyDayStart } from '../core/day';
import { failureText } from '../core/failure';
import { retrievability } from '../core/order';
import { isInProgress } from '../core/progress';
import { paramsForDeck } from '../core/scheduler';
import { DRILL_STEPS, languageOfDeck, missingByCard, SKILL_TAG, studiedHeadwords, SKILLS_SUBDECK, skillGroups, skillSections, type SkillGroup, type SkillSection } from '../tools/skills';
import { useApp } from './AppContext';
import { haptic } from './haptics';
import { Button, Card, Group, Help, Icon, Screen, SwitchRow } from './kit';
import { hairline, radius, readable, space, type, useTheme } from './theme';

/**
 * Skill cards (src/tools/skills.ts, src/anki/skillCards.ts), from a deck's options: how the deck's
 * skills are doing (each drill step's next review and FSRS's chance of recall, what's still locked),
 * then what adding them puts in the deck, group by group, with a sample of how a drill card reads in
 * Anki on the computer. Nothing is written until Add, which is the approval.
 */
export function SkillCards({ deck, onDone }: { deck: string; onDone: () => void }) {
  const c = useTheme();
  const { repo, refresh } = useApp();
  const found = useMemo(() => languageOfDeck(deck), [deck]);
  const groups = useMemo(() => (found ? skillGroups(found.language) : []), [found]);
  const [picked, setPicked] = useState<Set<SkillGroup>>(() => new Set(groups.map((g) => g.id)));
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = useRef(false);
  const [sections, setSections] = useState<SkillSection[]>([]);
  const [loads, setLoads] = useState(0);
  // The deck's skill cards, read again after an Add.
  useEffect(() => {
    let live = true;
    (async () => {
      const [notes, cards, params, settings] = await Promise.all([repo.listNotes(), repo.listCards(), repo.listDeckParams(), repo.collectionSettings()]);
      const now = new Date();
      const H = settings.dayStartsAtHour;
      const today = studyDayStart(now, H).getTime();
      const missing = missingByCard(cards, new Map(notes.map((n) => [n.id, n])), studiedHeadwords(notes, cards));
      const skillNotes = new Map(notes.filter((n) => n.tags.includes(SKILL_TAG) && (n.deck === deck || n.deck.startsWith(`${deck}::`))).map((n) => [n.id, n]));
      const info = cards.filter((cd) => skillNotes.has(cd.noteId) && !cd.retired).map((cd) => {
        const n = skillNotes.get(cd.noteId)!;
        const r = retrievability(cd, now, paramsForDeck(n.deck, params)?.weights ?? []);
        return {
          tags: n.tags, suspended: !!cd.suspended, started: cd.sched.state !== 0, settled: cd.sched.state !== 0 && !isInProgress(cd),
          dueInDays: Math.round((studyDayStart(new Date(cd.sched.due), H).getTime() - today) / 86_400_000),
          percent: r === undefined ? undefined : Math.round(r * 100),
          missing: missing.get(cd.id),
        };
      });
      if (live) setSections(skillSections(info));
    })().catch(() => { if (live) setSections([]); });
    return () => { live = false; };
  }, [repo, deck, loads]);
  const count = groups.filter((g) => picked.has(g.id)).reduce((n, g) => n + g.count, 0);
  const sample = DRILL_STEPS.find((s) => picked.has(s.group));
  const subdeck = `${deck.split('::').pop()}::${SKILLS_SUBDECK}`;

  const add = async () => {
    if (!found || busy.current || !count) return;
    busy.current = true;
    setProgress({ done: 0, total: count });
    try {
      const { dayStartsAtHour } = await repo.collectionSettings();
      const got = await addSkillCards(repo, {
        deck, language: found.language, languageName: found.name, groups: groups.filter((g) => picked.has(g.id)).map((g) => g.id),
        dayStartsAtHour, refresh: () => refreshFromKeptCollection(repo), onProgress: (done, total) => setProgress({ done, total }),
      });
      await refresh();
      haptic.success();
      const parts = [`${got.added} ${got.added === 1 ? 'card is' : 'cards are'} in ${got.deck}.`];
      if (got.skipped) parts.push(`${got.skipped} ${got.skipped === 1 ? 'was' : 'were'} there already.`);
      parts.push('Later drill steps wait, suspended, until the step before has a review a week or more out.');
      setLoads((n) => n + 1);
      Alert.alert('Skill cards added', parts.join(' '), [{ text: 'OK', onPress: onDone }]);
    } catch (e) {
      Alert.alert("Couldn't add skill cards", failureText(e, { next: 'Try again.' }));
    } finally {
      busy.current = false;
      setProgress(null);
    }
  };

  return (
    <Screen
      title="Skill cards"
      largeTitle={false}
      footer={found && groups.length ? (
        <Button
          label={progress ? `Adding ${progress.done} of ${progress.total}` : `Add ${count} ${count === 1 ? 'card' : 'cards'}`}
          busy={false}
          disabled={!count || !!progress}
          onPress={() => void add()}
        />
      ) : undefined}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
        {!found ? (
          <Card><Help>{"This deck's name doesn't say which language it's in, so there are no skill cards to offer. Skill cards come for a deck named after its language, such as Thai or Polski."}</Help></Card>
        ) : !groups.length ? (
          <Card><Help>{`There are no skill cards for ${found.name} yet.`}</Help></Card>
        ) : (
          <>
            {sections.map((sec) => (
              <View key={sec.title} style={{ gap: space.s }}>
                <Text style={{ ...type.overline, color: c.textSecondary, paddingHorizontal: space.xs }}>{sec.title}</Text>
                <Card style={{ gap: 0, paddingVertical: space.xs }}>
                  {sec.rows.map((row, i) => (
                    <View key={row.title} accessible accessibilityLabel={`${row.title}. ${row.detail}${row.meter !== undefined ? `. ${row.meter} percent` : ''}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, borderTopWidth: i ? hairline : 0, borderTopColor: c.border }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ ...type.body, color: row.locked ? c.textSecondary : c.text }}>{row.title}</Text>
                        <Text style={{ ...type.footnote, color: c.textSecondary }}>{row.detail}</Text>
                      </View>
                      {row.locked ? <Icon name="lock" size={14} color={c.textTertiary} /> : row.meter !== undefined ? (
                        <View style={{ width: 64, height: 6, borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden' }}>
                          <View style={{ width: `${row.meter}%`, height: '100%', borderRadius: radius.pill, backgroundColor: row.meter >= 80 ? c.good : c.warning }} />
                        </View>
                      ) : null}
                    </View>
                  ))}
                </Card>
              </View>
            ))}
            {sections.length ? <Help>The bar is FSRS's chance you'd get it right now. For a set of single cards, it's how many have a review a week or more out.</Help> : null}
            <Text style={{ ...type.overline, color: c.textSecondary, paddingHorizontal: space.xs, marginTop: sections.length ? space.m : 0 }}>Add skill cards</Text>
            <Help>{`Skill cards go into ${subdeck}, made if it isn't there. They come up in your reviews like any card, and FSRS spaces them. A drill card asks a few questions, then you rate it. Later steps are added suspended and come in as the step before settles.`}</Help>
            <Group>
              {groups.map((g, i) => (
                <SwitchRow
                  key={g.id}
                  first={i === 0}
                  label={g.title}
                  hint={g.detail}
                  value={picked.has(g.id)}
                  onValueChange={(on) => setPicked((p) => { const next = new Set(p); if (on) next.add(g.id); else next.delete(g.id); return next; })}
                />
              ))}
            </Group>
            {sample ? (
              <Card style={{ gap: space.xs }}>
                <Text style={{ ...type.overline, color: c.textSecondary }}>In Anki on your computer, a drill card reads</Text>
                <Text style={{ ...type.headline, color: c.text }}>{`${found.name} · ${sample.title}`}</Text>
                <Text style={{ ...type.subhead, color: c.textSecondary }}>{`${sample.selfCheck} Then you rate it yourself.`}</Text>
              </Card>
            ) : null}
            <Help>{`${subdeck} uses Anki's Default options preset, as any new deck does. To give it its own limits, change its preset in Anki on your computer.`}</Help>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
