import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import type { Api, GrammarRotation } from '../../reader/api';
import { rotationCopy, undoneLine } from '../../reader/rotation';
import { useApp } from '../AppContext';
import { haptic } from '../haptics';
import { CloseButton, ErrorNote, HeaderAction, Help } from '../kit';
import { Reveal } from '../motion';
import { radius, smooth, space, type, useTheme } from '../theme';
import { useGrammarRotations } from './useGrammarRotation';

/** How long the line after Undo stays before it goes. */
const UNDONE_MS = 5000;

/**
 * The shelf's notice when a practiced grammar point was learned and the next one started in its
 * place (the server's rotation.py; the card the owner picked from the mock, 25 November 2026): what
 * is practiced now and why the last point moved on, with the new point's lesson and Undo. Close keeps
 * the swap and drops the notice. Undo puts both points back, and is refused, saying why, once
 * either was changed on the Grammar screen.
 */
export function ReadGrammarRotation({ api, onOpenLesson }: { api: Api; onOpenLesson: (id: string) => void }) {
  const c = useTheme();
  const { repo } = useApp();
  const { rotations, drop } = useGrammarRotations(api, repo);
  const [undone, setUndone] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: number; text: string } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    if (!undone) return;
    const id = setTimeout(() => setUndone(null), UNDONE_MS);
    return () => clearTimeout(id);
  }, [undone]);

  const close = (r: GrammarRotation) => {
    haptic.tap();
    drop(r.id);
    // Shown again next time when this doesn't reach the server, which is the safe way round.
    api.dismissRotation(r.id).catch(() => undefined);
  };

  const undo = async (r: GrammarRotation) => {
    setBusy(r.id);
    setFailed(null);
    try {
      await api.undoRotation(r.id);
      drop(r.id);
      setUndone(undoneLine(r));
    } catch (e) {
      setFailed({ id: r.id, text: failureText(e, { what: "Couldn't undo this.", next: 'Try again, or set the points on the Grammar screen.' }) });
    } finally {
      setBusy(null);
    }
  };

  const shown = rotations.map((r) => ({ r, copy: rotationCopy(r) })).filter((x) => x.copy !== null);
  if (!shown.length && !undone) return null;
  return (
    <View style={{ gap: space.m }}>
      {shown.map(({ r, copy }) => (
        <Reveal key={r.id}>
          <View
            style={{ backgroundColor: c.accentFill, borderRadius: radius.l, ...smooth, padding: space.l, gap: space.s }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
              <View style={{ flex: 1, gap: space.xs }}>
                <Text style={{ ...type.headline, color: c.text }}>{copy!.title}</Text>
                <Text style={{ ...type.subhead, color: c.text }}>{copy!.body}</Text>
              </View>
              <CloseButton label="Close this notice" onPress={() => close(r)} style={{ marginTop: -space.m, marginRight: -space.m }} />
            </View>
            <View style={{ flexDirection: 'row', gap: space.m, flexWrap: 'wrap' }}>
              {copy!.open && r.started ? (
                <HeaderAction label={copy!.open} accessibilityLabel={`Open the lesson on ${r.started.name}`} onPress={() => onOpenLesson(r.started!.id)} />
              ) : null}
              <HeaderAction
                label="Undo"
                accessibilityLabel={`Undo: practice ${r.graduated?.name ?? ''} again`}
                busy={busy === r.id}
                onPress={() => { void undo(r); }}
              />
            </View>
            {failed?.id === r.id ? <ErrorNote message={failed.text} /> : null}
          </View>
        </Reveal>
      ))}
      {undone ? (
        <Reveal>
          <Help>{`${undone} Applies to texts written from now on.`}</Help>
        </Reveal>
      ) : null}
    </View>
  );
}
