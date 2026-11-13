import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { recordNotes, type RecordDeps } from '../anki/recordService';
import { isOmnilanguage } from '../core/cards';
import { failureText } from '../core/failure';
import { isInDeck } from '../core/deckTree';
import { planRecordings, type RecordingPlan } from '../core/recording';
import type { Note } from '../core/types';
import { languageName } from '../core/voices';
import type { Repo } from '../db/repo';
import { Button, Card, ErrorNote, Help } from './kit';
import { type, useTheme } from './theme';

const notes = (n: number) => (n === 1 ? '1 note' : `${n} notes`);

/**
 * Deck options' Recordings: records every Omnilanguage note in the deck and its subdecks that has
 * no recording, each in its language's Azure voice (Settings, Voices), one at a time. Leaving the
 * screen stops it after the note being recorded; the ones done are kept.
 */
export function DeckRecordings({ repo, deck, recorder }: { repo: Repo; deck: string; recorder: RecordDeps | null }) {
  const c = useTheme();
  const [plan, setPlan] = useState<RecordingPlan>();
  const [omni, setOmni] = useState(0);
  const [done, setDone] = useState<number>();
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();
  const left = useRef(false);
  useEffect(() => () => { left.current = true; }, []);

  const load = async () => {
    const [all, settings] = await Promise.all([repo.listNotes(), repo.voiceSettings()]);
    const here = all.filter((n: Note) => isInDeck(n.deck, deck) && isOmnilanguage(n));
    setOmni(here.length);
    setPlan(planRecordings(here, settings));
  };
  useEffect(() => { load(); }, [repo, deck]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plan || !omni) return null;
  const waiting = [...plan.noVoice].map(([key, n]) => `${notes(n)} in ${languageName(key)}`);

  const record = async () => {
    if (!recorder || done !== undefined) return;
    setError(undefined);
    setResult(undefined);
    setDone(0);
    const r = await recordNotes(recorder, plan.ready, setDone, () => left.current);
    if (left.current) return;
    setDone(undefined);
    if (r.recorded) setResult(`Recorded ${notes(r.recorded)}. ${r.recorded === 1 ? 'It goes' : 'They go'} to Anki at the next sync.`);
    if (r.stopped) setError(failureText(r.stopped, { what: r.recorded ? "Couldn't record the rest." : "Couldn't record them.", next: 'Try again.' }));
    await load();
  };

  return (
    <Card>
      <Text style={{ ...type.headline, color: c.text }}>Recordings</Text>
      {!plan.ready.length && !waiting.length ? (
        <Help>Every Omnilanguage note here has a recording.</Help>
      ) : null}
      {plan.ready.length ? (
        !recorder ? (
          <Help>{`${notes(plan.ready.length)} here could be recorded with an Azure voice. Turn on Read & Listen (Settings, Read & Listen) to record them.`}</Help>
        ) : (
          <>
            <Help>{`${notes(plan.ready.length)} here ${plan.ready.length === 1 ? 'has' : 'have'} no recording. Each is recorded from its Entry in the voice chosen for its language, and goes to Anki with the note at the next sync.`}</Help>
            <Button
              label={done !== undefined ? `Recording ${Math.min(done + 1, plan.ready.length)} of ${plan.ready.length}…` : `Record audio for ${notes(plan.ready.length)}`}
              variant="secondary"
              onPress={record}
              disabled={done !== undefined}
            />
          </>
        )
      ) : null}
      {waiting.length ? (
        <Help>{`${waiting.join(', ')} can't be recorded until ${plan.noVoice.size === 1 ? 'its language has' : 'their languages have'} a voice for recordings. Choose one in Settings, Voices.`}</Help>
      ) : null}
      {result ? <Help>{result}</Help> : null}
      {error ? <ErrorNote message={error} onRetry={record} /> : null}
    </Card>
  );
}
