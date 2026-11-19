import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Text, View } from 'react-native';
import type { StageStep } from '../reader/making';
import { Card, Icon } from './kit';
import { Pop, useReduceMotion } from './motion';
import { space, type, useTheme } from './theme';

/**
 * Something Claude or the server is making in the background (a text, an episode, a grammar page,
 * an audio lesson): its name, the steps it goes through with the finished ones checked and the
 * current one marked by a turning arc (a spinner at the end only when there are no steps). A thing with no stages of its own passes `detail`,
 * one line saying what is happening, instead of `steps`. Without a Group around it, use
 * `MakingCard`; a row inside a Group uses `MakingBody` (the lessons list).
 */
export function MakingBody({ title, steps, detail }: { title: string; steps?: StageStep[]; detail?: string }) {
  const c = useTheme();
  const at = steps ? steps.findIndex((s) => s.status === 'now') : -1;
  const now = steps && at >= 0 ? `${steps[at].label}, step ${at + 1} of ${steps.length}` : detail;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={now ? `${title}. ${now}` : title}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}
    >
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={{ ...type.body, color: c.text }}>{title}</Text>
        {steps?.map((s) => (
          <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <StepMark status={s.status} />
            <StepLabel status={s.status} label={s.label} />
          </View>
        ))}
        {detail && !steps ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{detail}</Text> : null}
      </View>
      {steps ? null : <ActivityIndicator color={c.accent} />}
    </View>
  );
}

/** Just the checklist, for a row or banner that already has its own title. */
export function MakingSteps({ steps }: { steps: StageStep[] }) {
  const at = steps.findIndex((s) => s.status === 'now');
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={at >= 0 ? `${steps[at].label}, step ${at + 1} of ${steps.length}` : undefined}
      style={{ gap: space.xs, paddingTop: space.xs }}
    >
      {steps.map((s) => (
        <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <StepMark status={s.status} />
          <StepLabel status={s.status} label={s.label} />
        </View>
      ))}
    </View>
  );
}

const MARK = 18;

/**
 * A step's marker: a gold arc turns around the current step, and a step that has just finished
 * springs its check in. A step already done when the card first shows is drawn without the spring.
 */
function StepMark({ status }: { status: StageStep['status'] }) {
  const c = useTheme();
  const reduce = useReduceMotion();
  const turn = useRef(new Animated.Value(0)).current;
  const first = useRef(status);
  useEffect(() => {
    if (status !== 'now' || reduce) return undefined;
    turn.setValue(0);
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [status, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{ width: MARK, height: MARK, alignItems: 'center', justifyContent: 'center' }}>
      {status === 'done' ? (
        first.current === 'done' ? <Icon name="checkmark.circle.fill" size={14} color={c.accent} /> : <Pop from={0.4} bounciness={12}><Icon name="checkmark.circle.fill" size={14} color={c.accent} /></Pop>
      ) : (
        <Icon name={status === 'now' ? 'circle.inset.filled' : 'circle'} size={status === 'now' ? 10 : 14} color={status === 'todo' ? c.textTertiary : c.accent} />
      )}
      {status === 'now' ? (
        <Animated.View
          style={{
            position: 'absolute', width: MARK, height: MARK, borderRadius: MARK / 2, borderWidth: 2,
            borderColor: 'transparent', borderTopColor: c.accent, borderRightColor: c.accent,
            transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
          }}
        />
      ) : null}
    </View>
  );
}

/** A step's label; it slides in from the left when its step becomes the current one. */
function StepLabel({ status, label }: { status: StageStep['status']; label: string }) {
  const c = useTheme();
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(1)).current;
  const prev = useRef(status);
  useEffect(() => {
    if (status === 'now' && prev.current !== 'now' && !reduce) {
      v.setValue(0);
      Animated.timing(v, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
    prev.current = status;
  }, [status, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.Text
      style={{
        ...type.footnote,
        color: status === 'now' ? c.text : status === 'done' ? c.textSecondary : c.textTertiary,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
        transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
      }}
    >
      {label}
    </Animated.Text>
  );
}

/** `MakingBody` as a card of its own. */
export function MakingCard(props: { title: string; steps?: StageStep[]; detail?: string }) {
  return (
    <Card>
      <MakingBody {...props} />
    </Card>
  );
}
