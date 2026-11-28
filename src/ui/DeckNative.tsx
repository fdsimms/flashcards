import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { nativeWanted } from '../anki/nativeRecordings';
import { replaceWithNative, type RecordDeps } from '../anki/recordService';
import { isInDeck } from '../core/deckTree';
import { failureText } from '../core/failure';
import { nativeCandidates, nativeName, type NativeCandidate } from '../core/nativeRecording';
import { mediaFileUri } from '../media/mediaFiles';
import type { Api, NativeRecordingFound } from '../reader/api';
import { useApp } from './AppContext';
import { Button, ErrorNote, Group, Help, Icon, Loading, Screen, SwitchRow, Tappable } from './kit';
import { haptic } from './haptics';
import { radius, readable, space, type, useTheme } from './theme';
import { useOutputWake } from './useOutputWake';

/** Words asked about at once (the server's `MAX_WORDS`). */
const BATCH = 50;
/** How long to wait before asking again about words the server is still looking up. */
const POLL_MS = 4000;

type Row = NativeCandidate & { found: NativeRecordingFound };

/**
 * Deck options' Native recordings (src/core/nativeRecording.ts): the deck's words with no native recording
 * yet, looked up on Wikimedia Commons through Read & Listen's server, each found one to play and untick,
 * then Use these to put them in place of the Azure recordings, one at a time. Nothing changes until then.
 */
export function DeckNative({ deck, api, recorder }: { deck: string; api: Api; recorder: RecordDeps }) {
  const c = useTheme();
  const { repo } = useApp();
  const wake = useOutputWake();
  const [state, setState] = useState<{ rows: Row[]; looked: number; total: number; noField: number; off: string[] } | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const left = useRef(false);
  const player = useRef<AudioPlayer | null>(null);
  useEffect(() => () => { left.current = true; player.current?.remove(); player.current = null; }, []);

  const look = useCallback(async () => {
    setError(null);
    try {
      const config = await repo.ankiNativeRecordings();
      const notes = (await repo.listNotes()).filter((n) => isInDeck(n.deck, deck));
      const plan = nativeCandidates(notes, (l) => nativeWanted(config, l));
      const rows: Row[] = [];
      setState({ rows, looked: 0, total: plan.candidates.length, noField: plan.noField, off: plan.off });
      // Asked a language and a batch at a time; words beyond the first few are looked up in the background,
      // so a batch is asked again until none is pending.
      const groups = new Map<string, NativeCandidate[]>();
      for (const cand of plan.candidates) groups.set(cand.language, [...(groups.get(cand.language) ?? []), cand]);
      let looked = 0;
      for (const group of groups.values()) {
        for (let i = 0; i < group.length && !left.current; i += BATCH) {
          const batch = group.slice(i, i + BATCH);
          let words = batch.map((g) => g.word);
          while (words.length && !left.current) {
            const got = await api.nativeFind(batch[0].language, words);
            for (const r of got.results) {
              const cand = batch.find((g) => g.word === r.word);
              if (cand && r.recordings[0]) rows.push({ ...cand, found: r.recordings[0] });
            }
            looked += words.length - got.pending.length;
            words = got.pending;
            const seen = looked;
            setState((s) => (s ? { ...s, rows: [...rows], looked: seen } : s));
            if (words.length) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          }
        }
      }
      setState((s) => (s ? { ...s, rows: [...rows], looked: s.total } : s));
    } catch (e) {
      if (!left.current) setError(failureText(e, { what: "Couldn't look up native recordings.", next: 'Try again.' }));
    }
  }, [api, deck, repo]);
  useEffect(() => { void look(); }, [look]);

  const play = async (row: Row) => {
    const name = nativeName(row.found.title);
    try {
      if (!recorder.media.exists(name)) await recorder.media.write(name, await api.nativeAudio(row.found.title));
      const uri = mediaFileUri(name);
      if (!uri) return;
      await wake();
      player.current ??= createAudioPlayer();
      player.current.replace({ uri });
      player.current.play();
    } catch (e) {
      setError(failureText(e, { what: "Couldn't play the recording.", next: 'Try again.' }));
    }
  };

  const use = async () => {
    if (!state || saving !== null) return;
    const chosen = state.rows.filter((r) => !skip.has(r.noteId));
    setSaving(0);
    let kept = 0;
    try {
      for (const [i, row] of chosen.entries()) {
        if (left.current) break;
        const bytes = await api.nativeAudio(row.found.title);
        if (await replaceWithNative(recorder, row.noteId, { audio: row.audio, credit: row.credit }, { title: row.found.title, credit: row.found.credit, bytes })) kept++;
        setSaving(i + 1);
      }
      setDone(kept);
    } catch (e) {
      setError(failureText(e, { what: `Kept ${kept} before it stopped.`, next: 'Try again to keep the rest.' }));
    } finally {
      setSaving(null);
    }
  };

  const chosen = state ? state.rows.filter((r) => !skip.has(r.noteId)).length : 0;
  return (
    <Screen title="Native recordings" largeTitle={false} footer={state && state.rows.length && done === null ? (
      <Button
        label={saving !== null ? `Keeping ${saving} of ${chosen}` : `Use these ${chosen}`}
        busy={saving !== null}
        disabled={!chosen || state.looked < state.total}
        onPress={() => void use()}
      />
    ) : undefined}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.xl, gap: space.m }}>
        {error ? <ErrorNote message={error} onRetry={() => void look()} /> : null}
        {!state ? <Loading /> : done !== null ? (
          <Help>{done === 1 ? 'Kept 1 native recording.' : `Kept ${done} native recordings.`} They go to Anki with the next sync.</Help>
        ) : (
          <>
            <Help>
              {state.looked < state.total
                ? `Looking up ${state.total} words on Wikimedia Commons: ${state.looked} so far.`
                : `Found for ${state.rows.length} of ${state.total} words without one. Each replaces the word's Azure recording, and its credit goes in AudioCredit.`}
            </Help>
            {state.noField ? <Help>{`${state.noField} ${state.noField === 1 ? "word's note type has" : "words' note type has"} no AudioCredit field, so they're left out. Ask Claude to add it with the MCP's add_field, after syncing every device.`}</Help> : null}
            {state.off.length ? <Help>Native recordings are off for some of this deck's languages in Settings, Voices.</Help> : null}
            {state.rows.length ? (
              <Group>
                {state.rows.map((row, i) => (
                  <View key={row.noteId} style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: space.l }}>
                    <Tappable
                      onPress={() => { haptic.tap(); void play(row); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Play ${row.word}`}
                      hitSlop={space.xs}
                      style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Icon name="play.fill" size={13} color={c.accent} />
                    </Tappable>
                    <View style={{ flex: 1 }}>
                      <SwitchRow
                        first={i === 0}
                        label={row.word}
                        hint={`${row.found.speaker}, ${row.found.source === 'lingualibre' ? 'Lingua Libre' : 'Wiktionary'}`}
                        value={!skip.has(row.noteId)}
                        onValueChange={(on) => setSkip((s) => { const next = new Set(s); if (on) next.delete(row.noteId); else next.add(row.noteId); return next; })}
                      />
                    </View>
                  </View>
                ))}
              </Group>
            ) : state.looked >= state.total ? <Text style={{ ...type.body, color: c.textSecondary }}>Nothing to change.</Text> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
