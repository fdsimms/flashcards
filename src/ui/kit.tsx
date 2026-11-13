import { Stack } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator, Animated, LayoutAnimation, PanResponder, Pressable, Switch, Text, TextInput, useColorScheme, View,
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
 * A screen's content, with its native header: the title (large by default, collapsing as the list
 * under it scrolls), `toolbar` for the buttons (a `Stack.Toolbar`, or several), and `footer`
 * pinned to the bottom above the home indicator. The back button and its label come from the
 * stack, so a screen never draws its own. Without a footer the content is returned as is, so a
 * ScrollView in it is the screen's direct child, which is what the large title needs to collapse.
 * Give that ScrollView `contentInsetAdjustmentBehavior="automatic"`.
 */
export function Screen(props: {
  title?: string;
  /** False for an inline title: a sheet's, or a screen that's mostly its own content. */
  largeTitle?: boolean;
  /** `Stack.Toolbar` elements, e.g. `<Stack.Toolbar placement="right">` holding buttons. */
  toolbar?: React.ReactNode;
  /** Pinned to the bottom, above the home indicator: the screen's main buttons. */
  footer?: React.ReactNode;
  /** Turns off swiping the screen away: a sheet with changes that would be lost, or a screen with its own sideways swipe. */
  lockGesture?: boolean;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const head = (
    <>
      <Stack.Screen options={{ title: props.title ?? '', headerLargeTitleEnabled: !!props.title && props.largeTitle !== false, gestureEnabled: !props.lockGesture }} />
      {props.toolbar}
    </>
  );
  if (!props.footer) return <>{head}{props.children}</>;
  return (
    <View style={{ flex: 1 }}>
      {head}
      <View style={{ flex: 1 }}>{props.children}</View>
      <View style={{ paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: Math.max(insets.bottom, space.l), gap: space.s }}>
        {props.footer}
      </View>
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
export function NavRow({ label, detail, onPress, first, icon, disabled }: {
  label: string;
  detail?: string;
  onPress: () => void;
  first?: boolean;
  icon?: { name: SFSymbol; color: string };
  /** Dimmed and not tappable; the detail should say why. */
  disabled?: boolean;
}) {
  const c = useTheme();
  const tile = 30;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      style={({ pressed }) => ({
        minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m,
        paddingVertical: space.m, paddingHorizontal: space.l, backgroundColor: pressed ? c.fill : 'transparent',
        opacity: disabled ? 0.45 : 1,
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

/**
 * A row that slides left under the finger to show an action behind it, as a table row does in
 * iOS: dragged past halfway (or flicked) it stays open on `action`, which fills `width`. Whether
 * it's open is the parent's (`open`), so only one row in a list is open at a time. The action
 * must also be reachable another way (a visible button), since a swipe can't be found by
 * VoiceOver or by someone who never tries it.
 */
export function SwipeToReveal({ open, onOpenChange, action, width = 92, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: React.ReactNode;
  width?: number;
  children: React.ReactNode;
}) {
  const c = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  // The responder is made once, so it reads the latest props from here.
  const latest = useRef({ open, onOpenChange, width });
  latest.current = { open, onOpenChange, width };
  const settle = (to: boolean) => Animated.spring(x, { toValue: to ? -latest.current.width : 0, useNativeDriver: true, speed: 24, bounciness: 0 }).start();
  useEffect(() => { settle(open); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const responder = useRef(
    PanResponder.create({
      // Claim only a clearly horizontal drag, so the list still scrolls vertically.
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        const { open: isOpen, width: w } = latest.current;
        x.setValue(Math.max(-w * 1.15, Math.min(0, (isOpen ? -w : 0) + g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        const { open: isOpen, width: w, onOpenChange: change } = latest.current;
        const end = Math.max(-w, Math.min(0, (isOpen ? -w : 0) + g.dx));
        const next = g.vx < -0.5 ? true : g.vx > 0.5 ? false : end < -w / 2;
        if (next !== isOpen) change(next);
        else settle(isOpen);
      },
      // Once the row has the drag it keeps it. By default the responder gives way whenever the
      // list's ScrollView asks for it, which a little vertical drift in the finger does, so the
      // row snapped back mid-swipe.
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => settle(latest.current.open),
    }),
  ).current;
  return (
    <View style={{ overflow: 'hidden' }}>
      <View
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width }}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      >
        {action}
      </View>
      <Animated.View {...responder.panHandlers} style={{ backgroundColor: c.surface, transform: [{ translateX: x }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

/** The button a `SwipeToReveal` row slides open onto: a symbol over a short label, filling the space. */
export function SwipeAction({ icon, label, accessibilityLabel, onPress }: { icon: SFSymbol; label: string; accessibilityLabel: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs, backgroundColor: c.accent, opacity: pressed ? 0.8 : 1 })}
    >
      <Icon name={icon} size={22} color={c.onAccent} />
      <Text style={{ ...type.footnote, color: c.onAccent, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

/**
 * A small button inside a screen's content (More ideas, Mark as unknown), a full tap target tall.
 * A tinted pill with a hairline edge, so it reads as a button and still shows on `accentFill`.
 */
export function HeaderAction({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel?: string }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      scaleTo={0.97}
      hitSlop={space.xs}
      style={{
        minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: space.l, borderRadius: radius.pill,
        backgroundColor: c.accentFill, borderWidth: hairline, borderColor: c.accent,
      }}
    >
      <Text style={{ ...type.body, fontWeight: '600', color: c.accent }}>{label}</Text>
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
      hitSlop={{ top: 4, bottom: 4 }}
      style={{
        minHeight: 36, justifyContent: 'center', paddingHorizontal: space.m + 2, borderRadius: radius.pill,
        backgroundColor: selected ? c.accent : c.surface, borderWidth: hairline, borderColor: selected ? c.accent : c.border,
      }}
    >
      <Text style={{ ...type.subhead, color: selected ? c.onAccent : c.text, fontWeight: selected ? '600' : '400' }}>{label}</Text>
    </Tappable>
  );
}

/** A row of equal segments, one of them chosen: a speed, a length, a text type. */
export function Segments<T extends string | number>({ options, value, onChange, style }: {
  /** `disabled`: shown dimmed and not tappable, for a choice that can't be made right now. */
  options: { value: T; label: string; accessibilityLabel?: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={[{ flexDirection: 'row', backgroundColor: c.fill, borderRadius: radius.s, padding: 2 }, style]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            disabled={o.disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: o.disabled }}
            accessibilityLabel={o.accessibilityLabel ?? o.label}
            hitSlop={{ top: 4, bottom: 4 }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 36, borderRadius: radius.s - 2, backgroundColor: selected ? c.surface : 'transparent', opacity: o.disabled ? 0.4 : 1 }}
          >
            <Text style={{ ...type.subhead, fontWeight: '600', color: selected ? c.text : c.textSecondary }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Something that failed, said as it is, with Try again when there's something to retry. */
export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.xs, alignItems: 'flex-start' }}>
      <Text style={{ ...type.subhead, color: c.danger }}>{message}</Text>
      {onRetry ? <HeaderAction label="Try again" onPress={onRetry} /> : null}
    </View>
  );
}
