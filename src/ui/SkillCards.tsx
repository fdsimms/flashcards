import React, { useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { addSkillCards } from '../anki/skillCards';
import { refreshFromKeptCollection } from '../anki/transfer';
import { failureText } from '../core/failure';
import { DRILL_STEPS, languageOfDeck, SKILLS_SUBDECK, skillGroups, type SkillGroup } from '../tools/skills';
import { useApp } from './AppContext';
import { haptic } from './haptics';
import { Button, Card, Group, Help, Screen, SwitchRow } from './kit';
import { readable, space, type, useTheme } from './theme';

/**
 * Add skill cards (src/tools/skills.ts, src/anki/skillCards.ts), from a deck's options: what adding
 * them puts in the deck, group by group, and a sample of how a drill card reads in Anki on the
 * computer. Nothing is written until Add, which is the approval.
 */
export function SkillCards({ deck, onDone }: { deck: string; onDone: () => void }) {
  const c = useTheme();
  const { repo, refresh } = useApp();
  const found = useMemo(() => languageOfDeck(deck), [deck]);
  const groups = useMemo(() => (found ? skillGroups(found.language) : []), [found]);
  const [picked, setPicked] = useState<Set<SkillGroup>>(() => new Set(groups.map((g) => g.id)));
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = useRef(false);
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
      title="Add skill cards"
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
