import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { addSkillCards, deleteSkillCards, missingDrafts, SkillsRefused, setSkillsPaused } from '../anki/skillCards';
import { DEFAULT_SKILL_SETTINGS, type SkillSettings } from '../anki/skillSettings';
import { refreshFromKeptCollection } from '../anki/transfer';
import { studyDayStart } from '../core/day';
import { failureText } from '../core/failure';
import { retrievability } from '../core/order';
import { isInProgress } from '../core/progress';
import { paramsForDeck } from '../core/scheduler';
import type { Note } from '../core/types';
import { DRILL_STEPS, languageOfDeck, missingByCard, SKILL_TAG, studiedHeadwords, SKILLS_SUBDECK, skillGroups, skillSections, type SkillSection } from '../tools/skills';
import { useApp } from './AppContext';
import { haptic } from './haptics';
import { Button, Card, Group, Help, Icon, Screen, SwitchRow } from './kit';
import { hairline, radius, readable, space, type, useTheme } from './theme';

/**
 * Skill cards (src/tools/skills.ts, src/anki/skillCards.ts), from a deck's options: how the deck's
 * skills are doing (each drill step's next review and FSRS's chance of recall, what's still locked),
 * then what adding them puts in the deck, group by group, with a sample of how a drill card reads in
 * Anki on the computer. Three separate controls, saved in the collection so the server reads them
 * (src/anki/skillSettings.ts): the master switch (off suspends the deck's skill cards), which skills
 * are on, and whether the server adds the cards of those by itself. Nothing is written to the deck
 * until Add now or the server's job; a switch is the approval for the server's.
 */
export function SkillCards({ deck, onDone }: { deck: string; onDone: () => void }) {
  const c = useTheme();
  const { repo, refresh } = useApp();
  const found = useMemo(() => languageOfDeck(deck), [deck]);
  const groups = useMemo(() => (found ? skillGroups(found.language) : []), [found]);
  const [settings, setSettings] = useState<SkillSettings>(DEFAULT_SKILL_SETTINGS);
  const [notes, setNotes] = useState<Note[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = useRef(false);
  const [sections, setSections] = useState<SkillSection[]>([]);
  const [loads, setLoads] = useState(0);
  // The deck's skill cards, read again after an Add.
  useEffect(() => {
    let live = true;
    (async () => {
      const [notes, cards, params, settings, saved] = await Promise.all([repo.listNotes(), repo.listCards(), repo.listDeckParams(), repo.collectionSettings(), repo.ankiSkillSettings()]);
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
      if (live) { setSections(skillSections(info)); setNotes(notes); setSettings(saved.get(deck) ?? DEFAULT_SKILL_SETTINGS); }
    })().catch(() => { if (live) setSections([]); });
    return () => { live = false; };
  }, [repo, deck, loads]);
  const onGroups = groups.filter((g) => !settings.off.includes(g.id)).map((g) => g.id);
  const missing = useMemo(() => (found ? missingDrafts(notes, found.language, found.name, onGroups).length : 0), [notes, found, settings.off]);
  const skillCount = useMemo(() => notes.filter((n) => n.tags.includes(SKILL_TAG) && (n.deck === deck || n.deck.startsWith(`${deck}::`))).length, [notes, deck]);
  const sample = DRILL_STEPS.find((s) => !settings.off.includes(s.group));
  const subdeck = `${deck.split('::').pop()}::${SKILLS_SUBDECK}`;

  // Saves the deck's settings in the collection first, then shows them; a failed save puts the old ones back.
  const save = async (next: SkillSettings) => {
    const before = settings;
    setSettings(next);
    try {
      if (!(await repo.setAnkiSkillSettings(deck, next))) throw new SkillsRefused(`Anki doesn't have a deck called ${deck} yet. Sync with your Anki server, then try again.`);
    } catch (e) {
      setSettings(before);
      Alert.alert("Couldn't save skill card settings", failureText(e, { next: 'Try again.' }));
      return false;
    }
    return true;
  };

  const setOn = async (on: boolean) => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!(await save({ ...settings, on }))) return;
      const { dayStartsAtHour } = await repo.collectionSettings();
      await setSkillsPaused(repo, deck, !on, new Date(), dayStartsAtHour);
      await refresh();
      setLoads((n) => n + 1);
    } catch (e) {
      Alert.alert(on ? "Couldn't resume skill cards" : "Couldn't pause skill cards", failureText(e, { next: 'Try again.' }));
    } finally {
      busy.current = false;
    }
  };

  const confirmDelete = () => Alert.alert(
    `Delete ${skillCount} skill ${skillCount === 1 ? 'card' : 'cards'}?`,
    'They are removed from Anki too, with their review history. Adding automatically turns off so they do not come back. Add now brings them back as new cards.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => void (async () => {
          if (busy.current) return;
          busy.current = true;
          try {
            await deleteSkillCards(repo, deck);
            await save({ ...settings, auto: false });
            await refresh();
            haptic.success();
            setLoads((n) => n + 1);
          } catch (e) {
            Alert.alert("Couldn't delete skill cards", failureText(e, { next: 'Try again.' }));
          } finally {
            busy.current = false;
          }
        })(),
      },
    ],
  );

  const add = async () => {
    if (!found || busy.current || !missing) return;
    busy.current = true;
    setProgress({ done: 0, total: missing });
    try {
      const { dayStartsAtHour } = await repo.collectionSettings();
      const got = await addSkillCards(repo, {
        deck, language: found.language, languageName: found.name, groups: onGroups,
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
      footer={found && groups.length && settings.on && (missing || progress) ? (
        <Button
          label={progress ? `Adding ${progress.done} of ${progress.total}` : `Add ${missing} ${missing === 1 ? 'card' : 'cards'} now`}
          busy={false}
          disabled={!missing || !!progress}
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
            <Text style={{ ...type.overline, color: c.textSecondary, paddingHorizontal: space.xs, marginTop: sections.length ? space.m : 0 }}>Skill cards</Text>
            <Group>
              <SwitchRow
                first
                label="Skill cards"
                hint={`Off suspends every skill card in ${subdeck} and stops adding more. On resumes them, with later drill steps still waiting on the step before.`}
                value={settings.on}
                onValueChange={(on) => void setOn(on)}
              />
            </Group>
            <Text style={{ ...type.overline, color: c.textSecondary, paddingHorizontal: space.xs, marginTop: space.m }}>Skills in this deck</Text>
            <Help>{`Skills that are on go into ${subdeck}, made if it isn't there. They come up in your reviews like any card, and FSRS spaces them. A drill card asks a few questions, then you rate it. Later steps are added suspended and come in as the step before settles. Turning a skill off stops adding its cards. Cards already added stay.`}</Help>
            <Group>
              {groups.map((g, i) => (
                <SwitchRow
                  key={g.id}
                  first={i === 0}
                  label={g.title}
                  hint={g.detail}
                  value={!settings.off.includes(g.id)}
                  onValueChange={(on) => void save({ ...settings, off: on ? settings.off.filter((o) => o !== g.id) : [...settings.off, g.id].sort() })}
                />
              ))}
            </Group>
            <Group>
              <SwitchRow
                first
                label="Add new skill cards automatically"
                hint="Your server adds the cards of the skills that are on, including ones from later app updates, after your next sync. Off: only Add now adds them."
                value={settings.auto}
                onValueChange={(auto) => void save({ ...settings, auto })}
              />
            </Group>
            {!settings.on ? (
              <Help>Skill cards are paused. Nothing is added until you turn them back on.</Help>
            ) : settings.auto && missing ? (
              <Help>{`${missing} ${missing === 1 ? 'card' : 'cards'} will be added by your server after your next sync.`}</Help>
            ) : null}
            {sample ? (
              <Card style={{ gap: space.xs }}>
                <Text style={{ ...type.overline, color: c.textSecondary }}>In Anki on your computer, a drill card reads</Text>
                <Text style={{ ...type.headline, color: c.text }}>{`${found.name} · ${sample.title}`}</Text>
                <Text style={{ ...type.subhead, color: c.textSecondary }}>{`${sample.selfCheck} Then you rate it yourself.`}</Text>
              </Card>
            ) : null}
            <Help>{`${subdeck} uses Anki's Default options preset, as any new deck does. To give it its own limits, change its preset in Anki on your computer.`}</Help>
            {skillCount ? <Button label="Delete skill cards…" variant="destructive" onPress={confirmDelete} /> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
