import { SymbolView, type SFSymbol } from 'expo-symbols';
import React, { useRef } from 'react';
import {
  ActivityIndicator, Animated, LayoutAnimation, Pressable, Switch, Text, TextInput, useColorScheme, View,
  type PressableProps, type StyleProp, type TextInputInstance, type TextInputProps, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from './haptics';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

/**
 * The shared pieces every screen is built from, so a header, a button or a card looks the same
 * everywhere. Reach for these before styling a Pressable or a box by hand.
 */

/** An SF Symbol, the icon set iOS itself uses. Decorative: whatever holds it carries the label. */
export function Icon({ name, size = 20, color, weight = 'medium' }: { name: SFSymbol; size?: number; color: string; weight?: 'regular' | 'medium' | 'semibold' | 'bold' }) {
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={color}
      weight={weight}
      resizeMode="scaleAspectFit"
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/**
 * A Pressable that gives under the finger: it shrinks a touch and dims while held, springing back
 * on release, as a native control does. For buttons, chips and tiles. A list row highlights
 * instead (it's a plain Pressable with a pressed background).
 */
export function Tappable({ style, scaleTo = 0.97, dimTo = 1, restOpacity = 1, onPressIn, onPressOut, ...rest }: Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** The scale while held. */
  scaleTo?: number;
  /** What the opacity is multiplied by while held. */
  dimTo?: number;
  /** The opacity when not held, e.g. a disabled button's. */
  restOpacity?: number;
}) {
  const down = useRef(new Animated.Value(0)).current;
  const to = (toValue: number) => Animated.spring(down, { toValue, useNativeDriver: true, speed: 60, bounciness: 0 }).start();
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => { to(1); onPressIn?.(e); }}
      onPressOut={(e) => { to(0); onPressOut?.(e); }}
      style={[
        style,
        {
          opacity: down.interpolate({ inputRange: [0, 1], outputRange: [restOpacity, restOpacity * dimTo] }),
          transform: [{ scale: down.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] }) }],
        },
      ]}
    />
  );
}
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
  /** Leave the chevron off the back button: for a sheet's Cancel, which closes rather than goes back. */
  noBackChevron?: boolean;
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
              accessibilityLabel={props.noBackChevron ? (props.backLabel ?? 'Back') : `Back to ${props.backLabel ?? 'Decks'}`}
              hitSlop={space.s}
              style={({ pressed }) => ({
                minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', gap: space.xs,
                paddingLeft: props.noBackChevron ? space.s : 0, paddingRight: space.s, opacity: pressed ? 0.4 : 1,
              })}
            >
              {props.noBackChevron ? null : <Icon name="chevron.left" size={19} color={c.accent} weight="semibold" />}
              <Text style={{ ...type.body, color: c.accent }}>{props.backLabel ?? 'Decks'}</Text>
            </Pressable>
          ) : <View />}
          {props.right ?? <View />}
        </View>
      ) : null}
      {props.title ? (
        <Text accessibilityRole="header" style={{ ...type.largeTitle, color: c.text, paddingHorizontal: space.l, paddingTop: space.xs, paddingBottom: space.m }}>
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

/**
 * A grouped block of rows, the way iOS Settings groups them: one rounded surface with the rows
 * inside it, divided by hairlines. Rows (`NavRow`, `CheckRow`) draw their own divider; pass
 * `first` on the first.
 */
export function Group({ children, style, accessibilityRole }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; accessibilityRole?: 'radiogroup' | 'list' }) {
  const c = useTheme();
  return (
    <View accessibilityRole={accessibilityRole} style={[{ backgroundColor: c.surface, borderColor: c.border, borderWidth: hairline, borderRadius: radius.l, overflow: 'hidden', ...smooth }, style]}>
      {children}
    </View>
  );
}

/** The hairline between two rows in a `Group`, starting `inset` in from the left like iOS's. */
function Divider({ inset }: { inset: number }) {
  const c = useTheme();
  return <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: inset, right: 0, height: hairline, backgroundColor: c.border }} />;
}

/**
 * A row in a `Group` that opens another screen: its name, a line about it, and a chevron. With
 * `icon`, a colored tile holds the symbol, as in iOS Settings; `icon.color` should be a theme
 * color that white reads on (the rating colors are).
 */
export function NavRow({ label, detail, onPress, first, icon }: {
  label: string;
  detail?: string;
  onPress: () => void;
  first?: boolean;
  icon?: { name: SFSymbol; color: string };
}) {
  const c = useTheme();
  const tile = 30;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      style={({ pressed }) => ({
        minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m,
        paddingVertical: space.m, paddingHorizontal: space.l, backgroundColor: pressed ? c.fill : 'transparent',
      })}
    >
      {first ? null : <Divider inset={space.l + (icon ? tile + space.m : 0)} />}
      {icon ? (
        <View style={{ width: tile, height: tile, borderRadius: 7, ...smooth, backgroundColor: icon.color, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon.name} size={17} color={c.onRating} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, color: c.text }}>{label}</Text>
        {detail ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{detail}</Text> : null}
      </View>
      <Icon name="chevron.right" size={14} color={c.textTertiary} weight="semibold" />
    </Pressable>
  );
}

/** A row in a `Group` choosing one of several: a checkmark on the chosen one, as in an iOS picker. */
export function CheckRow({ label, hint, selected, onPress, first }: { label: string; hint?: string; selected: boolean; onPress: () => void; first?: boolean }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={() => { if (!selected) haptic.select(); onPress(); }}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      style={({ pressed }) => ({
        minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m,
        paddingVertical: space.m, paddingHorizontal: space.l, backgroundColor: pressed ? c.fill : 'transparent',
      })}
    >
      {first ? null : <Divider inset={space.l} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, color: c.text }}>{label}</Text>
        {hint ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{hint}</Text> : null}
      </View>
      {selected ? <Icon name="checkmark" size={17} color={c.accent} weight="semibold" /> : null}
    </Pressable>
  );
}

/** A row in a `Group` with an on/off switch. The whole row is labelled for VoiceOver, which flips it. */
export function SwitchRow({ label, hint, value, onValueChange, first }: { label: string; hint?: string; value: boolean; onValueChange: (on: boolean) => void; first?: boolean }) {
  const c = useTheme();
  return (
    <View
      accessible
      accessibilityRole="switch"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      accessibilityState={{ checked: value }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={() => { haptic.select(); onValueChange(!value); }}
      style={{ minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, paddingHorizontal: space.l }}
    >
      {first ? null : <Divider inset={space.l} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, color: c.text }}>{label}</Text>
        {hint ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={(on) => { haptic.select(); onValueChange(on); }} trackColor={{ true: c.accent, false: c.border }} ios_backgroundColor={c.border} />
    </View>
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
      style={({ pressed }) => ({ minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: space.s, opacity: pressed ? 0.4 : 1 })}
    >
      <Text style={{ ...type.body, color: c.accent }}>{label}</Text>
    </Pressable>
  );
}

/** A header action drawn as an icon, a full tap target square. `label` is what VoiceOver says. */
export function IconAction({ name, label, onPress, busy, color }: { name: SFSymbol; label: string; onPress: () => void; busy?: boolean; color?: string }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!busy }}
      scaleTo={0.88}
      dimTo={0.6}
      style={{ width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
    >
      {busy ? <ActivityIndicator color={c.accent} /> : <Icon name={name} size={21} color={color ?? c.accent} />}
    </Tappable>
  );
}

export function Button(props: {
  label: string;
  onPress: () => void;
  /** `destructive` is for what deletes or switches something off: quiet until pressed, red text. */
  variant?: 'primary' | 'secondary' | 'destructive';
  disabled?: boolean;
  /** Shows a spinner in place of the label, and can't be pressed. */
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const variant = props.variant ?? 'primary';
  const off = props.disabled || props.busy;
  const fg = variant === 'primary' ? c.onAccent : variant === 'destructive' ? c.danger : c.text;
  return (
    <Tappable
      onPress={() => { haptic.tap(); props.onPress(); }}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!off, busy: !!props.busy }}
      scaleTo={0.98}
      dimTo={0.85}
      restOpacity={off ? 0.45 : 1}
      style={[
        {
          minHeight: 52, borderRadius: radius.m + 2, ...smooth, paddingHorizontal: space.l, paddingVertical: space.m,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: variant === 'primary' ? c.accent : c.fill,
        },
        props.style,
      ]}
    >
      {props.busy ? <ActivityIndicator color={fg} /> : <Text style={{ ...type.headline, color: fg }}>{props.label}</Text>}
    </Tappable>
  );
}

/** A grouped block of content on a screen, the way iOS Settings groups its rows. */
export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  return (
    <View style={[{ backgroundColor: c.surface, borderColor: c.border, borderWidth: hairline, borderRadius: radius.l, ...smooth, padding: space.l, gap: space.m }, style]}>
      {children}
    </View>
  );
}

/** A small all-caps label over a group of rows. */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return <Text accessibilityRole="header" style={{ ...type.overline, color: c.textSecondary, paddingHorizontal: space.l, paddingTop: space.s }}>{children}</Text>;
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
    <Text style={{ ...type.subhead, color: value ? color : c.textTertiary, fontVariant: ['tabular-nums'] }}>
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

/**
 * A labelled text field, for a form on a Card. The label is also what VoiceOver reads for it. The
 * field outlines in the accent while it's being typed in. `ref` reaches the TextInput (React 19
 * passes it as a prop).
 */
export function Field({ label, error, ref, onFocus, onBlur, ...input }: TextInputProps & { label: string; error?: boolean; ref?: React.Ref<TextInputInstance> }) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={c.textTertiary}
        selectionColor={c.accent}
        keyboardAppearance={dark ? 'dark' : 'light'}
        {...input}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        style={{
          ...type.body, color: c.text, backgroundColor: c.fill, ...smooth,
          borderColor: error ? c.danger : focused ? c.accent : 'transparent', borderWidth: 1.5, borderRadius: radius.m,
          paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP,
        }}
      />
    </View>
  );
}

/** A search box, as iOS draws one: a magnifier in a rounded gray field, with no label above it. */
export function SearchField({ label, ...input }: TextInputProps & { label: string }) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, backgroundColor: c.border, borderRadius: radius.m, ...smooth, paddingHorizontal: space.m, minHeight: 40 }}>
      <Icon name="magnifyingglass" size={16} color={c.textTertiary} weight="semibold" />
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.textSecondary}
        selectionColor={c.accent}
        keyboardAppearance={dark ? 'dark' : 'light'}
        clearButtonMode="while-editing"
        {...input}
        style={{ ...type.body, color: c.text, flex: 1, paddingVertical: space.s }}
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
  const toggle = (next: boolean) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(next);
  };
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>{label}</Text>
      <Pressable
        onPress={() => toggle(!open)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || 'none'}`}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: MIN_TAP, paddingHorizontal: space.m, paddingVertical: space.s,
          backgroundColor: c.fill, borderRadius: radius.m, ...smooth, opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ ...type.body, color: c.text, flex: 1 }}>{value || 'Choose'}</Text>
        <Icon name="chevron.up.chevron.down" size={14} color={c.textSecondary} weight="semibold" />
      </Pressable>
      {open ? (
        <View style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, overflow: 'hidden' }}>
          {options.map((o, i) => {
            const parts = o.split('::');
            const selected = o === value;
            return (
              <Pressable
                key={o}
                onPress={() => { haptic.select(); onChange(o); toggle(false); }}
                accessibilityRole="button"
                accessibilityLabel={o}
                accessibilityState={{ selected }}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: MIN_TAP, paddingVertical: space.s,
                  paddingLeft: space.m + (parts.length - 1) * space.l, paddingRight: space.m, backgroundColor: pressed ? c.border : 'transparent',
                })}
              >
                {i === 0 ? null : <Divider inset={space.m} />}
                <Text style={{ ...type.body, color: selected ? c.accent : c.text, flex: 1, fontWeight: selected ? '600' : undefined }}>{parts[parts.length - 1]}</Text>
                {selected ? <Icon name="checkmark" size={16} color={c.accent} weight="semibold" /> : null}
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
    <Tappable
      onPress={() => { if (!selected) haptic.select(); onPress(); }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      scaleTo={0.95}
      style={{
        minHeight: 36, justifyContent: 'center', paddingHorizontal: space.m + 2, borderRadius: radius.pill,
        backgroundColor: selected ? c.accent : c.surface, borderWidth: hairline, borderColor: selected ? c.accent : c.border,
      }}
    >
      <Text style={{ ...type.subhead, color: selected ? c.onAccent : c.text, fontWeight: selected ? '600' : '400' }}>{label}</Text>
    </Tappable>
  );
}
