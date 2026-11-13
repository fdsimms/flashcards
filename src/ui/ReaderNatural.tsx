import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { failureText } from '../core/failure';
import type { Api, NaturalCheck } from '../reader/api';
import { isOff, registerLabel, verdictLabel } from '../reader/register';
import { ErrorNote, Icon, Tappable } from './kit';
import { haptic } from './haptics';
import { radius, space, type, useTheme } from './theme';

/**
 * How a line is said, and whether a native speaker would say it. The chip is the register Claude
 * wrote the line in, kept with the line; the check is Claude's answer to "Does this sound natural?",
 * asked only on the tap and kept per line on the server. Both only show text: nothing here grades
 * a word or touches a card.
 */

/** The register a line was written in, at the end of its buttons. Nothing for a text from before registers. */
export function RegisterChip({ register }: { register: string | undefined }) {
  const c = useTheme();
  const label = registerLabel(register);
  if (!label) return null;
  return (
    <View
      accessible
      accessibilityLabel={`Register: ${label}`}
      style={{ marginLeft: 'auto', alignSelf: 'center', backgroundColor: c.fill, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: space.xs }}
    >
      <Text style={{ ...type.footnote, fontWeight: '600', color: c.textSecondary }}>{label}</Text>
    </View>
  );
}

type CheckState =
  | { status: 'idle' }
  | { status: 'asking' }
  | { status: 'done'; check: NaturalCheck }
  | { status: 'error'; message: string };

/** Asking Claude about one line: idle until the tap, then asking, then the answer or what went wrong. */
export function useNaturalCheck(api: Api, textId: number, line: number) {
  const [state, setState] = useState<CheckState>({ status: 'idle' });
  // Counts requests, so an answer that arrives after the explanation was closed is dropped.
  const latest = useRef(0);
  const busy = useRef(false);
  useEffect(() => () => { latest.current++; }, []);

  const ask = async () => {
    if (busy.current) return;
    busy.current = true;
    const mine = ++latest.current;
    setState({ status: 'asking' });
    try {
      const check = await api.checkNatural(textId, line);
      if (latest.current === mine) setState({ status: 'done', check });
    } catch (e) {
      if (latest.current === mine) setState({ status: 'error', message: failureText(e, { what: "Couldn't check this line.", next: 'Try again.' }) });
    } finally {
      busy.current = false;
    }
  };
  return { state, ask };
}

/** The pill beside "Explain more simply". Gone once there is an answer to show. */
export function NaturalPill({ state, ask }: ReturnType<typeof useNaturalCheck>) {
  const c = useTheme();
  if (state.status === 'done') return null;
  const asking = state.status === 'asking';
  return (
    <Tappable
      disabled={asking}
      onPress={() => { haptic.tap(); ask(); }}
      accessibilityRole="button"
      accessibilityLabel="Does this sound natural?"
      accessibilityState={{ busy: asking }}
      restOpacity={asking ? 0.6 : 1}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', backgroundColor: c.fill, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: space.s }}
    >
      {asking ? <ActivityIndicator size="small" /> : <Icon name="questionmark.circle" size={14} color={c.text} weight="semibold" />}
      <Text style={{ ...type.footnote, color: c.text }}>Does this sound natural?</Text>
    </Tappable>
  );
}

/** Under the points: the verdict with its reason, and what a native speaker would more likely say. */
export function NaturalResult({ state, ask }: ReturnType<typeof useNaturalCheck>) {
  const c = useTheme();
  if (state.status === 'error') return <ErrorNote message={state.message} onRetry={ask} />;
  if (state.status !== 'done') return null;
  const { verdict, reason, alternative } = state.check;
  const off = isOff(verdict);
  return (
    <View style={{ gap: space.s, paddingTop: space.s, borderTopWidth: 1, borderTopColor: c.border }} accessibilityLabel={`Does this sound natural? ${verdictLabel(verdict)}. ${reason}`}>
      <Text accessibilityRole="header" style={{ ...type.overline, color: c.textSecondary }}>Does this sound natural?</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', backgroundColor: off ? c.warningFill : c.goodFill, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: space.xs }}>
        <Icon name={off ? 'exclamationmark.triangle' : 'checkmark'} size={14} color={off ? c.warning : c.good} weight="bold" />
        <Text style={{ ...type.footnote, fontWeight: '600', color: c.text }}>{verdictLabel(verdict)}</Text>
      </View>
      <Text style={{ ...type.subhead, color: c.text }}>{reason}</Text>
      {alternative ? (
        <View style={{ backgroundColor: c.accentFill, borderRadius: radius.s, paddingHorizontal: space.m, paddingVertical: space.s, gap: 2 }}>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>A native speaker would more likely say</Text>
          <Text style={{ ...type.body, fontWeight: '600', color: c.accent }} selectable>{alternative}</Text>
        </View>
      ) : null}
    </View>
  );
}
