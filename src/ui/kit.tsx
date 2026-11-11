import React from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View, type StyleProp, type TextInputInstance, type TextInputProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TAP, radius, space, type, useTheme } from './theme';

/**
 * The shared pieces every screen is built from, so a header, a button or a card looks the same
 * everywhere. Reach for these before styling a Pressable or a box by hand.
 */

/**
 * A full screen: the background, the safe-area insets (the status bar and Dynamic Island above,
 * the home indicator below), and a header with a back button and an optional action on the right.
 * Never pad a screen's top by a fixed amount; the inset differs from one iPhone to the next.
 */
export function Screen(props: {
  /** Large title under the header. */
  title?: string;
  /** Shows "‹ <backLabel>" at the top left. */
  onBack?: () => void;
  backLabel?: string;
  /** A small action at the top right, e.g. Undo. */
  right?: React.ReactNode;
  /** Pinned to the bottom, above the home indicator: the screen's main buttons. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      {props.onBack || props.right ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.s, minHeight: MIN_TAP }}>
          {props.onBack ? (
            <Pressable
              onPress={props.onBack}
              accessibilityRole="button"
              accessibilityLabel={`Back to ${props.backLabel ?? 'Decks'}`}
              style={({ pressed }) => ({ minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: space.s, opacity: pressed ? 0.5 : 1 })}
            >
              <Text style={{ ...type.body, color: c.accent }}>‹ {props.backLabel ?? 'Decks'}</Text>
            </Pressable>
          ) : <View />}
          {props.right ?? <View />}
        </View>
      ) : null}
      {props.title ? (
        <Text accessibilityRole="header" style={{ ...type.largeTitle, color: c.text, paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.m }}>
          {props.title}
        </Text>
      ) : null}
      <View style={{ flex: 1 }}>{props.children}</View>
      {props.footer ? (
        <View style={{ paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: Math.max(insets.bottom, space.l), gap: space.s }}>
          {props.footer}
        </View>
      ) : (
        <View style={{ height: insets.bottom }} />
      )}
    </View>
  );
}

/** A row in a list that opens another screen: its name, a line about it, and a chevron. */
export function NavRow({ label, detail, onPress, first }: { label: string; detail?: string; onPress: () => void; first?: boolean }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      style={({ pressed }) => ({
        minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m,
        borderTopWidth: first ? 0 : 1, borderTopColor: c.border, opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, color: c.text }}>{label}</Text>
        {detail ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{detail}</Text> : null}
      </View>
      <Text style={{ ...type.body, color: c.textTertiary }}>›</Text>
    </Pressable>
  );
}

/** A small text action for a header or a row, at least a full tap target tall. */
export function HeaderAction({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel?: string }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={space.s}
      style={({ pressed }) => ({ minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: space.s, opacity: pressed ? 0.5 : 1 })}
    >
      <Text style={{ ...type.body, color: c.accent }}>{label}</Text>
    </Pressable>
  );
}

export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  /** Shows a spinner in place of the label, and can't be pressed. */
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const primary = (props.variant ?? 'primary') === 'primary';
  const off = props.disabled || props.busy;
  const fg = primary ? c.onAccent : c.text;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!off, busy: !!props.busy }}
      style={({ pressed }) => [
        {
          minHeight: 50, borderRadius: radius.m, paddingHorizontal: space.l, paddingVertical: space.m,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: primary ? c.accent : c.surface,
          borderWidth: primary ? 0 : 1, borderColor: c.border,
          opacity: off ? 0.5 : pressed ? 0.75 : 1,
        },
        props.style,
      ]}
    >
      {props.busy ? <ActivityIndicator color={fg} /> : <Text style={{ ...type.headline, color: fg }}>{props.label}</Text>}
    </Pressable>
  );
}

/** A grouped block of content on a screen, the way iOS Settings groups its rows. */
export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  return (
    <View style={[{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.l, padding: space.l, gap: space.m }, style]}>
      {children}
    </View>
  );
}

/** A line explaining a control or a screen, in the quieter color. */
export function Help({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return <Text style={{ ...type.subhead, color: c.textSecondary, lineHeight: 21 }}>{children}</Text>;
}

/** A count with its label, e.g. "12 due": dimmed when zero so the decks with work stand out. */
export function Count({ value, label, color }: { value: number; label: string; color: string }) {
  const c = useTheme();
  return (
    <Text style={{ ...type.subhead, color: value ? color : c.textTertiary }}>
      <Text style={{ fontWeight: '700' }}>{value}</Text> {label}
    </Text>
  );
}

/** What an import or a backup just did, newest first. */
export function MessageList({ lines }: { lines: string[] }) {
  const c = useTheme();
  if (!lines.length) return null;
  return (
    <Card style={{ gap: space.s }}>
      {lines.map((l, i) => (
        <Text key={i} style={{ ...type.subhead, color: i === 0 ? c.text : c.textSecondary }}>{l}</Text>
      ))}
    </Card>
  );
}

/** A labelled text field, for a form on a Card. The label is also what VoiceOver reads for it. `ref` reaches the TextInput (React 19 passes it as a prop). */
export function Field({ label, error, ref, ...input }: TextInputProps & { label: string; error?: boolean; ref?: React.Ref<TextInputInstance> }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={c.textTertiary}
        {...input}
        style={{
          ...type.body, color: c.text, backgroundColor: c.fill,
          borderColor: error ? c.danger : 'transparent', borderWidth: 1, borderRadius: radius.s,
          paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP,
        }}
      />
    </View>
  );
}

/**
 * A choice among many (every deck, every note type): one row showing the choice, which opens a
 * list of the options. A name with `::` in it is a subdeck, shown by its last part, indented. Use
 * `Chip`s only for a handful of choices.
 */
export function Select({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  const c = useTheme();
  const [open, setOpen] = React.useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>{label}</Text>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || 'none'}`}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: MIN_TAP, paddingHorizontal: space.m, paddingVertical: space.s,
          backgroundColor: c.fill, borderRadius: radius.s, opacity: pressed ? 0.75 : 1,
        })}
      >
        <Text style={{ ...type.body, color: c.text, flex: 1 }}>{value || 'Choose'}</Text>
        <Text style={{ ...type.body, color: c.textSecondary }}>{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open ? (
        <View style={{ backgroundColor: c.fill, borderRadius: radius.s, overflow: 'hidden' }}>
          {options.map((o) => {
            const parts = o.split('::');
            const selected = o === value;
            return (
              <Pressable
                key={o}
                onPress={() => { onChange(o); setOpen(false); }}
                accessibilityRole="button"
                accessibilityLabel={o}
                accessibilityState={{ selected }}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: MIN_TAP, paddingVertical: space.s,
                  paddingLeft: space.m + (parts.length - 1) * space.l, paddingRight: space.m, opacity: pressed ? 0.75 : 1,
                })}
              >
                <Text style={{ ...type.body, color: selected ? c.accent : c.text, flex: 1, fontWeight: selected ? '600' : undefined }}>{parts[parts.length - 1]}</Text>
                {selected ? <Text style={{ ...type.body, color: c.accent }}>✓</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** A choice among a few (a deck, a note type): pill-shaped, filled when chosen. */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        minHeight: 36, justifyContent: 'center', paddingHorizontal: space.m, borderRadius: radius.pill,
        backgroundColor: selected ? c.accent : c.surface, borderWidth: 1, borderColor: selected ? c.accent : c.border,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ ...type.subhead, color: selected ? c.onAccent : c.text }}>{label}</Text>
    </Pressable>
  );
}
