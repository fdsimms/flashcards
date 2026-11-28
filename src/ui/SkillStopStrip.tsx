import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Text, View } from 'react-native';
import { cardHistory } from '../anki/cardHistory';
import type { NoteStore } from '../anki/noteService';
import { setStepStopped } from '../anki/skillCards';
import { failureText } from '../core/failure';
import { isDrillNote } from '../core/skillTag';
import type { Card, Note } from '../core/types';
import type { AnkiLink } from '../db/ankiLink';
import { cleanWeeks, drillOfTags, STOP_SUGGESTED_AFTER } from '../tools/skills';
import { haptic } from './haptics';
import { Tappable } from './kit';
import { useReduceMotion } from './motion';
import { lift, radius, smooth, space, type, useTheme } from './theme';

/**
 * After a drill card's answer makes `STOP_SUGGESTED_AFTER` clean weeks in a row (`cleanWeeks`), a strip
 * floats over the next card offering to stop practicing that step. It stays until Stop practicing or Not
 * now is tapped, since it comes once: the next clean week makes seven, not six. Skill cards keeps the same
 * offer on the step's row for as long as the run lasts, and Start again there undoes it. The answer itself
 * is Review's as usual; nothing here rates or schedules.
 */

export interface StopOffer {
  noteId: string;
  /** The step's title ("With the weekday"). */
  step: string;
}

type Store = NoteStore & Pick<AnkiLink, 'setAnkiCardStates'>;

/** The strip's state. `answered` is called with every answer Review writes; `onStopped` gets the note and cards as saved. */
export function useStopSuggestion(repo: Store, dayStartsAtHour: number, onStopped: (note: Note, cardIds: string[]) => void) {
  const [offer, setOffer] = useState<StopOffer | null>(null);
  const busy = useRef(false);
  // Bumped by each answer and each withdrawal, so an offer worked out for an answer since undone or changed never shows.
  const seq = useRef(0);

  const answered = useCallback((card: Card, note: Note, rating: number, when: Date) => {
    const mine = ++seq.current;
    // Only a review answered Good or Easy can be the sixth clean week.
    const drill = drillOfTags(note.tags);
    if (!drill || !isDrillNote(note) || rating < 3 || card.sched.state !== 2) return;
    void (async () => {
      // The answers before this one: this one's revlog row may or may not be written yet, so it's left out and added here.
      const history = (await cardHistory(repo, card).catch(() => [])).filter((h) => h.at.getTime() < when.getTime() - 60_000);
      const answer = { at: when, kind: 'Review', rating };
      if (mine === seq.current && cleanWeeks([answer, ...history], dayStartsAtHour) === STOP_SUGGESTED_AFTER) setOffer({ noteId: note.id, step: drill.step.title });
    })();
  }, [repo, dayStartsAtHour]);

  /** The answer behind an offer for this note was undone or its rating changed: the offer goes with it. */
  const withdraw = useCallback((noteId: string) => {
    seq.current++;
    setOffer((o) => (o?.noteId === noteId ? null : o));
  }, []);

  const stop = useCallback(async () => {
    if (!offer || busy.current) return;
    busy.current = true;
    try {
      const saved = await setStepStopped(repo, offer.noteId, true, false, new Date(), dayStartsAtHour);
      const cardIds = (await repo.listCards()).filter((c) => c.noteId === saved.id).map((c) => c.id);
      haptic.success();
      setOffer(null);
      onStopped(saved, cardIds);
    } catch (e) {
      Alert.alert("Couldn't stop practicing this step", failureText(e, { next: 'Try again, or stop it from Skill cards.' }));
    } finally {
      busy.current = false;
    }
  }, [offer, repo, dayStartsAtHour, onStopped]);

  return { offer, answered, withdraw, stop, dismiss: useCallback(() => setOffer(null), []) };
}

/** Passed to Screen's `floating`, as the hold strip is: over the card's lower edge, above the footer. */
export function SkillStopStrip({ offer, onStop, onDismiss }: { offer: StopOffer; onStop: () => void; onDismiss: () => void }) {
  const c = useTheme();
  const reduce = useReduceMotion();
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: reduce ? 0 : 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [offer.noteId, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = `You've had “${offer.step}” right ${STOP_SUGGESTED_AFTER} weeks in a row`;
  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        marginHorizontal: space.l + space.m + 2, marginBottom: space.s,
        opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
      }}
    >
      <View
        accessibilityLiveRegion="polite"
        style={{
          gap: space.xs, backgroundColor: c.raised, borderRadius: radius.l, ...smooth, borderWidth: 1, borderColor: c.raisedEdge,
          paddingHorizontal: space.m + 2, paddingTop: space.m + 2, paddingBottom: space.xs, ...lift(c, 'high'),
        }}
      >
        <Text style={{ ...type.subhead, fontWeight: '600', color: c.text }}>{title}</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>You can stop practicing it. Start it again any time in Skill cards.</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.xs }}>
          <StripButton label="Not now" color={c.textSecondary} onPress={onDismiss} />
          <StripButton label="Stop practicing" color={c.accentInk} onPress={onStop} accessibilityLabel={`Stop practicing ${offer.step}`} />
        </View>
      </View>
    </Animated.View>
  );
}

function StripButton({ label, color, onPress, accessibilityLabel }: { label: string; color: string; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      scaleTo={0.95}
      style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.m, borderRadius: radius.m, ...smooth }}
    >
      <Text style={{ ...type.subhead, fontWeight: '600', color }}>{label}</Text>
    </Tappable>
  );
}
