import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { cardHistory } from '../anki/cardHistory';
import { addSkillCards, canWriteWords, deleteSkillCards, missingDrafts, missingWordDrafts, SkillsRefused, setSkillsPaused, setStepStopped } from '../anki/skillCards';
import { DEFAULT_SKILL_SETTINGS, type SkillSettings } from '../anki/skillSettings';
import { refreshFromKeptCollection } from '../anki/transfer';
import { studyDayStart } from '../core/day';
import { failureText } from '../core/failure';
import { retrievability } from '../core/order';
import { isInProgress } from '../core/progress';
import { paramsForDeck } from '../core/scheduler';
import { isDrillNote } from '../core/skillTag';
import type { Note } from '../core/types';
import { SKILL_WORD_NOTE_TYPE } from '../tools/skillWords';
import { cleanWeeks, DRILL_STEPS, languageOfDeck, knownIn, missingByCard, SKILL_TAG, SKILLS_SUBDECK, skillGroups, skillSections, type SkillSection } from '../tools/skills';
import { useApp } from './AppContext';
import { haptic } from './haptics';
import { Button, Card, Group, HeaderAction, Help, Icon, Screen, SECTION_GAP, Section, SwitchRow } from './kit';
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
  // Whether the collection has the note type the words are written in; without it the cards are added and the words aren't.
  const [canWords, setCanWords] = useState(true);
  // The deck's skill cards, read again after an Add.
  useEffect(() => {
    let live = true;
    (async () => {
      const [notes, cards, params, settings, saved, noteTypes] = await Promise.all([repo.listNotes(), repo.listCards(), repo.listDeckParams(), repo.collectionSettings(), repo.ankiSkillSettings(), repo.listNoteTypes()]);
      const now = new Date();
      const H = settings.dayStartsAtHour;
      const today = studyDayStart(now, H).getTime();
      const missing = missingByCard(cards, new Map(notes.map((n) => [n.id, n])), knownIn(notes, cards));
      const skillNotes = new Map(notes.filter((n) => n.tags.includes(SKILL_TAG) && (n.deck === deck || n.deck.startsWith(`${deck}::`))).map((n) => [n.id, n]));
      const info = await Promise.all(cards.filter((cd) => skillNotes.has(cd.noteId) && !cd.retired).map(async (cd) => {
        const n = skillNotes.get(cd.noteId)!;
        const r = retrievability(cd, now, paramsForDeck(n.deck, params)?.weights ?? []);
        // A drill card's run of clean weeks, from every device's answers: six or more offers Stop practicing.
        const weeks = isDrillNote(n) && cd.sched.state === 2 ? cleanWeeks(await cardHistory(repo, cd).catch(() => [])) : undefined;
        return {
          noteId: n.id, weeks,
          tags: n.tags, suspended: !!cd.suspended, started: cd.sched.state !== 0, settled: cd.sched.state !== 0 && !isInProgress(cd),
          dueInDays: Math.round((studyDayStart(new Date(cd.sched.due), H).getTime() - today) / 86_400_000),
          percent: r === undefined ? undefined : Math.round(r * 100),
          missing: missing.get(cd.id),
        };
      }));
      if (live) { setSections(skillSections(info)); setNotes(notes); setCanWords(canWriteWords(noteTypes.get(SKILL_WORD_NOTE_TYPE))); setSettings(saved.get(deck) ?? DEFAULT_SKILL_SETTINGS); }
    })().catch(() => { if (live) setSections([]); });
    return () => { live = false; };
  }, [repo, deck, loads]);
  const onGroups = groups.filter((g) => !settings.off.includes(g.id)).map((g) => g.id);
  const missing = useMemo(() => (found ? missingDrafts(notes, found.language, found.name, onGroups).length : 0), [notes, found, settings.off]);
  // The words the skills that are on need (the months and weekdays for dates) that the deck doesn't have: added with the cards.
  const missingWords = useMemo(() => (found && canWords ? missingWordDrafts(notes, deck, found.language, onGroups).length : 0), [notes, found, deck, settings.off, canWords]);
  const unwritable = useMemo(() => (found && !canWords ? missingWordDrafts(notes, deck, found.language, onGroups).length : 0), [notes, found, deck, settings.off, canWords]);
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

  // Stop practicing or Start again on one step's row: its note's tag and its card's suspension (`setStepStopped`).
  const setStopped = async (noteId: string, stop: boolean) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const { dayStartsAtHour } = await repo.collectionSettings();
      await setStepStopped(repo, noteId, stop, !settings.on, new Date(), dayStartsAtHour);
      haptic.success();
      await refresh();
      setLoads((n) => n + 1);
    } catch (e) {
      Alert.alert(stop ? "Couldn't stop practicing this step" : "Couldn't start this step again", failureText(e, { next: 'Try again.' }));
    } finally {
      busy.current = false;
    }
  };

  const confirmDelete = () => Alert.alert(
    `Delete ${skillCount} skill ${skillCount === 1 ? 'card' : 'cards'}?`,
    "They're removed from Anki too, with their review history, and automatic adding turns off. The words added for them stay in your deck.",
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
    if (!found || busy.current || !(missing || missingWords)) return;
    busy.current = true;
    setProgress({ done: 0, total: missing + missingWords });
    try {
      const { dayStartsAtHour } = await repo.collectionSettings();
      const got = await addSkillCards(repo, {
        deck, language: found.language, languageName: found.name, groups: onGroups,
        dayStartsAtHour, refresh: () => refreshFromKeptCollection(repo), onProgress: (done, total) => setProgress({ done, total }),
      });
      await refresh();
      haptic.success();
      const parts = [`${got.added} ${got.added === 1 ? 'card is' : 'cards are'} in ${got.deck}.`];
      if (got.words) parts.push(`${got.words} ${got.words === 1 ? 'word' : 'words'} the drills need ${got.words === 1 ? 'was' : 'were'} added there too, and some come up in your new cards every day until you know them.`);
      if (got.wordsSkipped) parts.push(`${got.wordsSkipped} ${got.wordsSkipped === 1 ? 'word' : 'words'} couldn't be added because your collection has no ${SKILL_WORD_NOTE_TYPE} note type. The steps that use them start once you've added those words and know them well.`);
      if (got.skipped) parts.push(`${got.skipped} ${got.skipped === 1 ? 'was' : 'were'} there already.`);
      parts.push('Later steps start once you know the earlier ones.');
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
      footer={found && groups.length && settings.on && (missing || missingWords || progress) ? (
        <Button
          label={progress ? `Adding ${progress.done} of ${progress.total}` : addLabel(missing, missingWords)}
          busy={false}
          disabled={!(missing || missingWords) || !!progress}
          onPress={() => void add()}
        />
      ) : undefined}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: SECTION_GAP }}>
        {!found ? (
          <Card><Help>{"This deck's name doesn't say which language it's in. Skill cards need a deck named after its language, e.g. Thai or Polski."}</Help></Card>
        ) : !groups.length ? (
          <Card><Help>{`There are no skill cards for ${found.name} yet.`}</Help></Card>
        ) : (
          <>
            {sections.map((sec, si) => (
              <Section key={sec.title} title={sec.title} footer={si === sections.length - 1 ? <Help>{"The bar shows how well you know each skill. A drill card comes back at least once a week. When a step asks everything the steps before it did, those are set aside once it's going well."}</Help> : undefined}>
                <Card style={{ gap: 0, paddingVertical: space.xs }}>
                  {sec.rows.map((row, i) => (
                    <View key={row.title} accessible={!row.action} accessibilityLabel={`${row.title}. ${row.detail}${row.meter !== undefined ? `. ${row.meter} percent` : ''}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, borderTopWidth: i ? hairline : 0, borderTopColor: c.border }}>
                      <View style={{ flex: 1, gap: space.xs }}>
                        <Text style={{ ...type.body, color: row.locked || row.covered || row.action?.kind === 'start' ? c.textSecondary : c.text }}>{row.title}</Text>
                        <Text style={{ ...type.footnote, color: row.clean ? c.goodInk : c.textSecondary }}>{row.detail}</Text>
                      </View>
                      {row.action ? (
                        <HeaderAction
                          label={row.action.kind === 'stop' ? 'Stop practicing' : 'Start again'}
                          accessibilityLabel={`${row.action.kind === 'stop' ? 'Stop practicing' : 'Start again'}: ${row.title}`}
                          onPress={() => void setStopped(row.action!.noteId, row.action!.kind === 'stop')}
                        />
                      ) : row.covered ? <Icon name="checkmark" size={14} color={c.textTertiary} /> : row.locked ? <Icon name="lock" size={14} color={c.textTertiary} /> : row.meter !== undefined ? (
                        <View style={{ width: 64, height: 6, borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden' }}>
                          <View style={{ width: `${row.meter}%`, height: '100%', borderRadius: radius.pill, backgroundColor: row.meter >= 80 ? c.good : c.warning }} />
                        </View>
                      ) : null}
                    </View>
                  ))}
                </Card>
              </Section>
            ))}
            <Section title="Skill cards">
              <Group>
                <SwitchRow
                  first
                  label="Skill cards"
                  hint={`Turn off to suspend every skill card in ${subdeck} and stop adding more. Turning it back on resumes them.`}
                  value={settings.on}
                  onValueChange={(on) => void setOn(on)}
                />
              </Group>
            </Section>
            <Section
              title="Skills in this deck"
              footer={(
                <>
                  <Help>{`Skill cards go into ${subdeck} and come up in your reviews like any other card. A drill card asks a few questions, then you rate it. Each step starts once you know the one before. Turning a skill off stops new cards. Ones already added stay.`}</Help>
                  {groups.some((g) => ['time', 'numbers', 'dates', 'money'].includes(g.id) && !settings.off.includes(g.id)) ? (
                    <Help>{canWords
                      ? `These skills also add the words their drills use (months, day numbers, currency) to ${subdeck}${missingWords ? ` (${missingWords} now)` : ''}, and a few come up as new cards each day. A drill waits until you know its words well, with each one's next review a week or more away.`
                      : `Your collection has no ${SKILL_WORD_NOTE_TYPE} note type, so the words these drills use can't be added${unwritable ? ` (${unwritable} words)` : ''}. A drill waits until you've added its words and know them well.`}</Help>
                  ) : null}
                  {groups.some((g) => g.id === 'contrast' && !settings.off.includes(g.id)) ? (
                    <Help>A Which word fits card starts once you know each of its words well.</Help>
                  ) : null}
                </>
              )}
            >
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
            </Section>
            <Section
              footer={(
                <>
                  {!settings.on ? (
                    <Help>Skill cards are paused. Nothing is added until you turn them back on.</Help>
                  ) : settings.auto && (missing || missingWords) ? (
                    <Help>{`${addNouns(missing, missingWords)} will be added by your server after your next sync.`}</Help>
                  ) : null}
                </>
              )}
            >
              <Group>
                <SwitchRow
                  first
                  label="Add new skill cards automatically"
                  hint="After each sync, your server adds new cards for the skills that are on. When this is off, add them with the button below."
                  value={settings.auto}
                  onValueChange={(auto) => void save({ ...settings, auto })}
                />
              </Group>
            </Section>
            <Section footer={<Help>{`${subdeck} uses Anki's Default options preset, as any new deck does. To give it its own limits, change its preset in Anki on your computer.`}</Help>}>
              {sample ? (
                <Card style={{ gap: space.xs }}>
                  <Text style={{ ...type.overline, color: c.textSecondary }}>In Anki on your computer, a drill card reads</Text>
                  <Text style={{ ...type.headline, color: c.text }}>{`${found.name} · ${sample.title}`}</Text>
                  <Text style={{ ...type.subhead, color: c.textSecondary }}>{`${sample.selfCheck} Then you rate it yourself.`}</Text>
                </Card>
              ) : null}
            </Section>
            {skillCount ? <Button label="Delete skill cards…" variant="destructive" onPress={confirmDelete} /> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** "3 cards and 19 words", for the button and the line under it. */
function addNouns(cards: number, words: number): string {
  const parts = [cards ? `${cards} ${cards === 1 ? 'card' : 'cards'}` : '', words ? `${words} ${words === 1 ? 'word' : 'words'}` : ''].filter(Boolean);
  return parts.join(' and ');
}

const addLabel = (cards: number, words: number) => `Add ${addNouns(cards, words)} now`;
