import { Stack, useNavigation, useRouter } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, LayoutAnimation, Pressable, Switch, Text, TextInput, useColorScheme, View,
  type AccessibilityState, type PressableProps, type StyleProp, type TextInputInstance, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { accessibilityLabel, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { useConnectionProblem } from './connection';
import { splitFailure } from '../core/failure';
import { withThaiLineHeight } from '../core/script';
import { haptic } from './haptics';
import { showsHomeButton } from './homeButton';
import { useKeyboardLanguage } from './useKeyboardLanguage';
import { useMissingKeyboard } from './useMissingKeyboard';
import { useReduceMotion } from './motion';
import { makingSpoken, type StageStep } from '../reader/making';
import { MakingProgress } from './MakingProgress';
import { WorkingMark } from './WorkingMark';
import { Hoverable, HoverPressable } from './hover';
import { hairline, lift, MIN_TAP, radius, smooth, space, type, useTheme, type Colors } from './theme';

/**
 * The shared pieces every screen is built from, so a header, a button or a card looks the same
 * everywhere. Reach for these before styling a Pressable or a box by hand.
 */

/**
 * An SF Symbol, the icon set iOS itself uses. Decorative: whatever holds it carries the label.
 * `effect` plays the system's symbol animation once when it appears (a bounce for something
 * landing, a pulse for something waiting), and not at all with Reduce Motion.
 */
export function Icon({ name, size = 20, color, weight = 'medium', effect }: { name: SFSymbol; size?: number; color: string; weight?: 'regular' | 'medium' | 'semibold' | 'bold'; effect?: 'bounce' | 'pulse' }) {
  const reduce = useReduceMotion();
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={color}
      weight={weight}
      resizeMode="scaleAspectFit"
      animationSpec={effect && !reduce ? { effect: { type: effect, wholeSymbol: true } } : undefined}
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
  // restOpacity changes (a button enabling as its field fills) but a native-driven interpolation
  // is built once, so a range that depends on it kept the first value: a button mounted disabled
  // stayed dimmed. It's its own Value, set on change, and multiplied in.
  const restValue = useRef(new Animated.Value(restOpacity)).current;
  useEffect(() => { restValue.setValue(restOpacity); }, [restValue, restOpacity]);
  const dim = down.interpolate({ inputRange: [0, 1], outputRange: [1, dimTo] });
  return (
    <Hoverable effect={rest.disabled ? 'none' : 'lift'}>
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => { to(1); onPressIn?.(e); }}
      onPressOut={(e) => { to(0); onPressOut?.(e); }}
      style={[
        style,
        {
          opacity: Animated.multiply(dim, restValue),
          transform: [{ scale: down.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] }) }],
        },
      ]}
    />
    </Hoverable>
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
  /**
   * A tab's title drawn at the left of the button row, in place of the large title, which iOS puts on
   * its own row under the buttons. Fixed rather than collapsing, so the scroll content needs no
   * `contentInsetAdjustmentBehavior`. For a screen with no left-hand toolbar of its own: it takes that side.
   */
  leadingTitle?: boolean;
  /** `Stack.Toolbar` elements, e.g. `<Stack.Toolbar placement="right">` holding buttons. */
  toolbar?: React.ReactNode;
  /** Pinned to the bottom, above the home indicator: the screen's main buttons. */
  footer?: React.ReactNode;
  /** Extra style for the footer's box, to set it apart from the content (a surface fill, an edge). */
  footerStyle?: StyleProp<ViewStyle>;
  /** The footer's height once laid out, for a screen whose content must clear it (pad the scroll content by this). */
  onFooterLayout?: (height: number) => void;
  /** Floats over the content's bottom edge, just above the footer, without moving anything. Needs a footer. */
  floating?: React.ReactNode;
  /** Turns off swiping the screen away: a sheet with changes that would be lost, or a screen with its own sideways swipe. */
  lockGesture?: boolean;
  /** False to leave out the header's Offline button, shown while the user's server can't be reached (the Offline sheet itself). */
  offlineButton?: boolean;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const c = useTheme();
  const router = useRouter();
  const problem = useConnectionProblem();
  // Read once, while this screen is the one just pushed: its place in the stack and its name.
  const navigation = useNavigation();
  const [home] = useState(() => {
    const routes = navigation.getState()?.routes ?? [];
    return showsHomeButton(routes.length, routes[routes.length - 1]?.name ?? '');
  });
  // On a screen several pushes deep, a house to go back to the tab in one tap (dismissAll closes every pushed screen).
  const withHome = home
    ? withRightButton(props.toolbar, (
      <Stack.Toolbar.Button
        key="home"
        icon="house"
        accessibilityLabel="Home"
        accessibilityHint="Goes back to the main screen"
        onPress={() => { haptic.tap(); router.dismissAll(); }}
      />
    ))
    : props.toolbar;
  // No Wi-Fi for offline; a cloud with a warning when the internet works but the user's server doesn't answer.
  const toolbar = problem && props.offlineButton !== false
    ? withRightButton(withHome, (
      <Stack.Toolbar.Button
        key="offline"
        icon={problem === 'offline' ? 'wifi.slash' : 'exclamationmark.icloud'}
        separateBackground
        accessibilityLabel={problem === 'offline' ? 'Offline' : "Can't reach your server"}
        accessibilityHint="Shows what's waiting to be sent"
        onPress={() => { haptic.tap(); router.push('/offline'); }}
      />
    ))
    : withHome;
  const head = (
    <>
      <Stack.Screen options={{ title: props.title ?? '', headerLargeTitleEnabled: !!props.title && props.largeTitle !== false && !props.leadingTitle, gestureEnabled: !props.lockGesture }} />
      {props.leadingTitle && props.title ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.View hidesSharedBackground>
            <Text accessibilityRole="header" numberOfLines={1} style={{ ...type.largeTitle, fontSize: 28, color: c.text }}>{props.title}</Text>
          </Stack.Toolbar.View>
        </Stack.Toolbar>
      ) : null}
      {toolbar}
    </>
  );
  if (!props.footer) return <>{head}{props.children}</>;
  return (
    <View style={{ flex: 1 }}>
      {head}
      <View style={{ flex: 1 }}>
        {props.children}
        {props.floating ? <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>{props.floating}</View> : null}
      </View>
      <View onLayout={props.onFooterLayout ? (e) => props.onFooterLayout?.(e.nativeEvent.layout.height) : undefined} style={[{ paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: Math.max(insets.bottom, space.l), gap: space.s }, props.footerStyle]}>
        {props.footer}
      </View>
    </View>
  );
}

/**
 * The screen's toolbar with `button` added to its right-hand items, or a right-hand toolbar holding
 * just it when the screen has none. A screen gets one toolbar per side (the last one drawn wins),
 * so the button goes inside the screen's own rather than beside it.
 */
function withRightButton(toolbar: React.ReactNode, button: React.ReactElement): React.ReactNode {
  let placed = false;
  const visit = (node: React.ReactNode): React.ReactNode => React.Children.map(node, (child) => {
    if (!React.isValidElement<{ children?: React.ReactNode; placement?: string }>(child)) return child;
    if (child.type === React.Fragment) return React.cloneElement(child, undefined, visit(child.props.children));
    if (child.type === Stack.Toolbar && child.props.placement === 'right') {
      placed = true;
      return React.cloneElement(child, undefined, ...React.Children.toArray(child.props.children), button);
    }
    return child;
  });
  const out = visit(toolbar);
  return placed ? out : <>{out}<Stack.Toolbar placement="right">{button}</Stack.Toolbar></>;
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
export function Divider({ inset }: { inset: number }) {
  const c = useTheme();
  return <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: inset, right: 0, height: hairline, backgroundColor: c.border }} />;
}

/**
 * A row in a `Group` that opens another screen: its name, a line about it, and a chevron. With
 * `icon`, a colored tile holds the symbol, as in iOS Settings; `icon.color` should be a theme
 * color that white reads on (the rating colors are).
 */
export function NavRow({ label, detail, badge, facts, loading, making, working, onPress, onLongPress, first, icon, disabled, action, indent = 0 }: {
  label: string;
  detail?: string;
  /** A colored `Tag` at the start of the line under the name, before `detail` (a grammar point's state). */
  badge?: TagProps;
  /** Captioned lines under the name, in place of `detail`, for a row that says several things (Voices: Azure, iPhone). Each value wraps on its own. */
  facts?: { label: string; value: string }[];
  /** The detail is still being read: its line is held open (blank), so the row doesn't grow when the value arrives. */
  loading?: boolean;
  /** Something is being made in the background: the step under way and a bar of its steps stand in for `detail`, and a turning mark for the chevron. The row should be `disabled`. */
  making?: StageStep[];
  /** Something is being made for it in the background, with no steps to show (a series' next episode): a turning mark for the chevron, `detail` saying what. The row stays tappable. */
  working?: boolean;
  onPress: () => void;
  /** A menu of more things to do with it (Up Next's Play Next and Play Later). */
  onLongPress?: () => void;
  first?: boolean;
  icon?: { name: SFSymbol; color: string };
  /** Dimmed and not tappable; the detail should say why. */
  disabled?: boolean;
  /** A round button before the chevron, for a second thing the row can do (Past texts' listen). */
  action?: { icon: SFSymbol; label: string; onPress: () => void };
  /** How many steps in from the group's edge the row starts: a subdeck under its parent deck. */
  indent?: number;
}) {
  const c = useTheme();
  const tile = 30;
  const start = space.l + indent * space.xl;
  return (
    <Hoverable effect={disabled ? 'none' : 'highlight'}>
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={[label, ...(badge ? [badge.text] : []), ...(facts ? facts.map((f) => `${f.label}: ${f.value}`) : making ? [makingSpoken(making)] : detail ? [detail] : [])].join('. ')}
      style={({ pressed }) => ({
        minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m,
        paddingVertical: space.m, paddingLeft: start, paddingRight: space.l, backgroundColor: pressed ? c.fill : 'transparent',
      })}
    >
      {first ? null : <Divider inset={start + (icon ? tile + space.m : 0)} />}
      {icon ? (
        <View style={{ opacity: disabled ? 0.45 : 1, width: tile, height: tile, borderRadius: 7, ...smooth, backgroundColor: icon.color, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon.name} size={17} color={c.onRating} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: space.xs }}>
        {/* Only the name dims when disabled: the detail says why, so it stays readable. */}
        <Text style={{ ...type.body, color: disabled ? c.textTertiary : c.text }}>{label}</Text>
        {facts ? facts.map((f) => (
          <View key={f.label} style={{ flexDirection: 'row', gap: space.s }}>
            <Text style={{ ...type.footnote, color: c.textSecondary, width: 56 }}>{f.label}</Text>
            <Text style={{ ...type.footnote, color: c.text, flex: 1 }}>{f.value}</Text>
          </View>
        )) : badge ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s, marginTop: 3 }}>
            <Tag {...badge} />
            {detail ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{detail}</Text> : null}
          </View>
        ) : making ? <MakingProgress steps={making} /> : detail ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{detail}</Text> : loading ? <Text style={type.footnote}>{'\u00a0'}</Text> : null}
      </View>
      {action ? (
        <Tappable
          onPress={() => { haptic.tap(); action.onPress(); }}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          scaleTo={0.92}
          style={{ width: MIN_TAP, height: MIN_TAP, borderRadius: radius.pill, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center' }}
        >
          {/* The same mark as PlayDot (PlayCircle.tsx), which kit can't import. */}
          <Icon name={action.icon} size={16} color={c.accent} weight="semibold" />
        </Tappable>
      ) : null}
      {making || working ? <WorkingMark /> : <Icon name="chevron.right" size={14} color={c.textTertiary} weight="semibold" />}
    </Pressable>
    </Hoverable>
  );
}

type TagProps = {
  text: string;
  color: string;
  fill: string;
  /** What VoiceOver says when the text alone is cryptic ("AI", "N5"). */
  accessibilityLabel?: string;
  /** A symbol before the text (a card's state, a verdict). */
  icon?: SFSymbol;
  /** The symbol's color, when it isn't the text's (an amber mark beside amber ink). */
  iconColor?: string;
  /** Drawn before the text in place of a symbol (a learning card's step dots). */
  leading?: React.ReactNode;
};

/**
 * A short colored label (a grammar point's state, a count beside a heading): its text in a color
 * on a faint fill of the same color, which the theme pairs to pass 4.5:1 (`violetInk` on
 * `violetFill`, `goodInk` on `goodFill`).
 */
export function Tag({ text, color, fill, accessibilityLabel, icon, iconColor, leading }: TagProps) {
  return (
    <View accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, borderRadius: radius.pill, ...smooth, backgroundColor: fill, paddingHorizontal: space.s, paddingVertical: 2 }}>
      {leading ?? (icon ? <Icon name={icon} size={12} color={iconColor ?? color} weight="semibold" /> : null)}
      <Text style={{ ...type.footnote, fontWeight: '600', color, fontVariant: ['tabular-nums'] }}>{text}</Text>
    </View>
  );
}

/** A row in a `Group` choosing one of several: a checkmark on the chosen one, as in an iOS picker. */
export function CheckRow({ label, hint, selected, onPress, first }: { label: string; hint?: string; selected: boolean; onPress: () => void; first?: boolean }) {
  const c = useTheme();
  return (
    <Hoverable effect="highlight">
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
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={{ ...type.body, color: c.text }}>{label}</Text>
        {hint ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{hint}</Text> : null}
      </View>
      {selected ? <Icon name="checkmark" size={17} color={c.accent} weight="semibold" /> : null}
    </Pressable>
    </Hoverable>
  );
}

/** A row in a `Group` with an on/off switch. The whole row is labelled for VoiceOver, which flips it. */
export function SwitchRow({ label, hint, value, onValueChange, first, style }: { label: string; hint?: string; value: boolean; onValueChange: (on: boolean) => void; first?: boolean; /** For a switch inside a `Card` rather than a `Group`: `{ paddingVertical: 0, paddingHorizontal: 0, minHeight: 0 }` keeps the card's own padding. */ style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  return (
    <View
      accessible
      accessibilityRole="switch"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      accessibilityState={{ checked: value }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={() => { haptic.select(); onValueChange(!value); }}
      style={[{ minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, paddingHorizontal: space.l }, style]}
    >
      {first ? null : <Divider inset={space.l} />}
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={{ ...type.body, color: c.text }}>{label}</Text>
        {hint ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={(on) => { haptic.select(); onValueChange(on); }} trackColor={{ true: c.accent, false: c.border }} ios_backgroundColor={c.border} />
    </View>
  );
}

/**
 * A row that slides left under the finger to show an action behind it, as a table row does in
 * iOS: dragged past halfway (or flicked) it stays open on `action`, which fills `width`. Dragged
 * most of the way across (or flicked hard) it runs `onFullSwipe` instead, as a full swipe does in
 * Mail, and settles shut. Whether it's open is the parent's (`open`), so only one row in a list is
 * open at a time. The action must also be reachable another way (a visible button), since a swipe
 * can't be found by VoiceOver or by someone who never tries it.
 *
 * The drag runs on the UI thread (Reanimated); only the decision hops back to JS.
 */
export function SwipeToReveal({ open, onOpenChange, action, onFullSwipe, width = 92, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: React.ReactNode;
  /** What a full swipe does. Without it the row stops at `width`. */
  onFullSwipe?: () => void;
  width?: number;
  children: React.ReactNode;
}) {
  const c = useTheme();
  const x = useSharedValue(0);
  const rowWidth = useSharedValue(0);
  const full = useSharedValue(!!onFullSwipe);
  const crossedFull = useSharedValue(false);
  const isOpen = useSharedValue(open);
  const wide = useSharedValue(width);
  const settle = (to: boolean) => { x.value = withSpring(to ? -width : 0, { damping: 20, stiffness: 260, mass: 1 }); };
  useEffect(() => { isOpen.value = open; settle(open); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { wide.value = width; }, [width]); // eslint-disable-line react-hooks/exhaustive-deps
  // The gesture's callbacks reach JS through this, so it reads the latest props.
  const latest = useRef({ open, onOpenChange, onFullSwipe });
  latest.current = { open, onOpenChange, onFullSwipe };
  const finish = (result: 'full' | 'open' | 'close') => {
    const { open: was, onOpenChange: change, onFullSwipe: runFull } = latest.current;
    if (result === 'full') { haptic.tap(); settle(false); if (was) change(false); runFull?.(); return; }
    const next = result === 'open';
    if (next !== was) change(next);
    else settle(was);
  };
  const tick = () => haptic.select();
  const pan = usePanGesture({
    // Claim only a clearly horizontal drag, so the list still scrolls vertically.
    activeOffsetX: [-10, 10],
    failOffsetY: [-14, 14],
    // A two-finger swipe on a trackpad opens the row too, not only a click and drag.
    enableTrackpadTwoFingerGesture: true,
    onUpdate: (e) => {
      const base = isOpen.value ? -wide.value : 0;
      const canFull = full.value;
      const min = canFull ? -rowWidth.value : -wide.value * 1.15;
      const next = Math.max(min, Math.min(0, base + e.translationX));
      x.value = next;
      const past = canFull && -next > rowWidth.value * 0.55;
      if (past !== crossedFull.value) { crossedFull.value = past; if (past) scheduleOnRN(tick); }
    },
    onDeactivate: (e) => {
      crossedFull.value = false;
      const base = isOpen.value ? -wide.value : 0;
      const end = Math.max(-rowWidth.value, Math.min(0, base + e.translationX));
      if (e.canceled) { scheduleOnRN(finish, isOpen.value ? 'open' : 'close'); return; }
      if (full.value && (-end > rowWidth.value * 0.55 || (e.velocityX < -1600 && -end > wide.value * 1.3))) { scheduleOnRN(finish, 'full'); return; }
      const next = e.velocityX < -500 ? 'open' : e.velocityX > 500 ? 'close' : end < -wide.value / 2 ? 'open' : 'close';
      scheduleOnRN(finish, next);
    },
  });
  useEffect(() => { full.value = !!onFullSwipe; }, [onFullSwipe]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  // The action grows with the drag past its own width, so a full swipe reads as pulling it across.
  // It's invisible while the row is shut: the row covers it, but a row fading during a layout
  // animation (collapsing a deck) goes translucent and would show it through.
  const actionStyle = useAnimatedStyle(() => ({ width: Math.max(wide.value, -x.value), opacity: x.value < -1 ? 1 : 0 }));
  return (
    <View style={{ overflow: 'hidden' }} onLayout={(e) => { rowWidth.value = e.nativeEvent.layout.width; }}>
      <Reanimated.View
        style={[{ position: 'absolute', top: 0, right: 0, bottom: 0 }, actionStyle]}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      >
        {action}
      </Reanimated.View>
      <GestureDetector gesture={pan}>
        <Reanimated.View style={[{ backgroundColor: c.surface }, rowStyle]}>
          {children}
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
}

/** The button a `SwipeToReveal` row slides open onto: a symbol over a short label, filling the space. */
export function SwipeAction({ icon, label, accessibilityLabel, onPress, destructive }: { icon: SFSymbol; label: string; accessibilityLabel: string; onPress: () => void; destructive?: boolean }) {
  const c = useTheme();
  const fill = destructive ? c.danger : c.accent;
  const ink = destructive ? c.onRating : c.onAccent;
  return (
    <Hoverable effect="highlight">
    <Pressable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs, backgroundColor: fill, opacity: pressed ? 0.8 : 1 })}
    >
      <Icon name={icon} size={22} color={ink} />
      <Text style={{ ...type.footnote, color: ink, fontWeight: '600' }}>{label}</Text>
    </Pressable>
    </Hoverable>
  );
}

/**
 * A small button inside a screen's content (More ideas, Mark as unknown), a full tap target tall.
 * A tinted pill with a hairline edge, so it reads as a button and still shows on `accentFill`.
 */
export function HeaderAction({ label, onPress, accessibilityLabel, busy }: { label: string; onPress: () => void; accessibilityLabel?: string; /** Shows a spinner in place of the label while the action is in flight, and can't be pressed. */ busy?: boolean }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!busy, busy: !!busy }}
      scaleTo={0.97}
      hitSlop={space.xs}
      style={{
        minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: space.l, borderRadius: radius.pill,
        backgroundColor: c.accentFill, borderWidth: hairline, borderColor: c.accent,
      }}
    >
      {busy ? <ActivityIndicator color={c.accentInk} /> : <Text style={{ ...type.headline, color: c.accentInk }}>{label}</Text>}
    </Tappable>
  );
}

/**
 * The top of a page sheet: its title block, and a round close button at the right so a sheet
 * can be left without scrolling down to its bottom buttons. `onClose` does what the sheet's own
 * Close, Cancel or Skip button does, and `disabled` matches that button's.
 */
export function SheetHeader({ children, onClose, disabled }: { children: React.ReactNode; onClose: () => void; disabled?: boolean }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
      <View style={{ flex: 1, gap: space.xs, paddingTop: space.s }}>{children}</View>
      <Tappable
        onPress={() => { haptic.tap(); onClose(); }}
        disabled={disabled}
        restOpacity={disabled ? 0.4 : 1}
        accessibilityRole="button"
        accessibilityLabel="Close"
        accessibilityState={{ disabled: !!disabled }}
        hitSlop={space.xs}
        style={{ width: MIN_TAP, height: MIN_TAP, borderRadius: radius.pill, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="xmark" size={14} color={c.textSecondary} weight="bold" />
      </Tappable>
    </View>
  );
}

export function Button(props: {
  label: string;
  onPress: () => void;
  /**
   * `destructive` is for what deletes or switches something off: quiet until pressed, red text.
   * `tinted` is a way out beside a question's answers (I don't know): gold-tinted, so it reads as
   * neither an answer nor the screen's main action.
   */
  variant?: 'primary' | 'secondary' | 'destructive' | 'tinted';
  disabled?: boolean;
  /** Shows a spinner in place of the label, and can't be pressed. */
  busy?: boolean;
  /** With `busy`: says what is happening beside the turning mark, for a wait on Claude. Without it, a bare spinner. */
  busyLabel?: string;
  /** What VoiceOver says when the label alone isn't enough: a button repeated down a list names its row. */
  accessibilityLabel?: string;
  /** `small` is 44pt with the label in subhead, for buttons side by side in a bar or under a card (Look up's Hear it and Add to deck). */
  size?: 'regular' | 'small';
  /** A symbol before the label. */
  icon?: SFSymbol;
  /** A caption under the label, saying what the button will act on ("3 notes"). */
  hint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const variant = props.variant ?? 'primary';
  const small = props.size === 'small';
  const labelType = small ? { ...type.subhead, fontWeight: '600' as const } : type.headline;
  const off = props.disabled || props.busy;
  const fg = variant === 'primary' ? c.onAccent : variant === 'destructive' ? c.danger : variant === 'tinted' ? c.accentInk : c.text;
  return (
    <Tappable
      onPress={() => { haptic.tap(); props.onPress(); }}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled: !!off, busy: !!props.busy }}
      scaleTo={0.98}
      dimTo={0.85}
      restOpacity={off ? 0.45 : 1}
      style={[
        {
          minHeight: small ? MIN_TAP : 52, borderRadius: radius.m + 2, ...smooth, paddingHorizontal: small ? space.m : space.l, paddingVertical: small ? space.s : space.m,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: variant === 'primary' ? c.accent : variant === 'tinted' ? c.accentFill : c.fill,
          // The fill alone is 1.1:1 on the screen in light mode, so the button needs an edge to read as one. Inside the box: the size is the same.
          ...(variant === 'primary' || variant === 'tinted' ? null : { borderWidth: 1, borderColor: c.controlEdge }),
        },
        props.style,
      ]}
    >
      {props.busy && props.busyLabel ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <WorkingMark color={fg} />
          <Text style={{ ...labelType, color: fg }}>{props.busyLabel}</Text>
        </View>
      ) : props.busy ? <ActivityIndicator color={fg} /> : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 }}>
            {props.icon ? <Icon name={props.icon} size={small ? 15 : 18} color={fg} weight="semibold" /> : null}
            <Text style={{ ...labelType, color: fg, textAlign: 'center', flexShrink: 1 }}>{props.label}</Text>
          </View>
          {props.hint ? <Text style={{ ...type.caption, color: variant === 'destructive' ? c.danger : c.textSecondary, textAlign: 'center' }}>{props.hint}</Text> : null}
        </>
      )}
    </Tappable>
  );
}

/**
 * A button that is only words in the gold ink ("Show English", "Add anyway", "More ideas"): for a
 * small action beside content, where a `Button` would be too heavy. 44 tall, with an optional
 * symbol before the words and a chevron after them for something that opens and closes.
 * `busyLabel` replaces the words, beside the turning mark, while a request runs. It sets no
 * `alignSelf`: pass one in `style` where it stands alone in a column.
 */
export function TextButton({ label, onPress, icon, chevron, disabled, busy, busyLabel, accessibilityLabel, accessibilityState, style }: {
  label: string;
  onPress: () => void;
  icon?: SFSymbol;
  /** Which way the chevron after the words points: down while closed, up while open. */
  chevron?: 'up' | 'down';
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const off = disabled || busy;
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ ...accessibilityState, disabled: !!off, busy: !!busy }}
      restOpacity={disabled && !busy ? 0.45 : 1}
      scaleTo={0.97}
      style={[{ minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', gap: space.xs }, style]}
    >
      {busy && busyLabel ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <WorkingMark />
          <Text style={{ ...type.subhead, color: c.textSecondary }}>{busyLabel}</Text>
        </View>
      ) : (
        <>
          {icon ? <Icon name={icon} size={16} color={c.accentInk} weight="semibold" /> : null}
          <Text style={{ ...type.subhead, fontWeight: '600', color: c.accentInk, flexShrink: 1 }}>{label}</Text>
          {chevron ? <Icon name={chevron === 'up' ? 'chevron.up' : 'chevron.down'} size={12} color={c.accentInk} weight="semibold" /> : null}
        </>
      )}
    </Tappable>
  );
}

/**
 * A small × that closes or removes the thing beside it (a notice, a queued word, a suggestion): a
 * 44pt target around a 14pt mark in the quiet gray. `label` says what it closes ("Remove kot").
 * The round gray button that closes a sheet is `SheetHeader`'s.
 */
export function CloseButton({ label, onPress, disabled, busy, style }: { label: string; onPress: () => void; disabled?: boolean; /** A spinner in place of the ×, while what it started runs. */ busy?: boolean; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      scaleTo={0.9}
      style={[{ minWidth: MIN_TAP, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      {busy ? <ActivityIndicator size="small" color={c.textSecondary} /> : <Icon name="xmark" size={14} color={c.textTertiary} weight="semibold" />}
    </Tappable>
  );
}

/**
 * A lifted card that says something has happened and opens it: a deck shared to Franki, new words
 * running low, notes ready from Claude, vacation, reviews to do first. An icon, the news, a line
 * on what a tap does, then a close button when it can be dismissed or a chevron when it can't.
 * The caller wraps it in `Reveal` where it should fade in.
 */
export function Banner({ icon, iconColor, title, hint, onPress, onDismiss, dismissLabel = 'Dismiss', accessibilityHint }: {
  icon: SFSymbol;
  iconColor: string;
  title: string;
  hint: string;
  onPress: () => void;
  onDismiss?: () => void;
  /** What VoiceOver says for the close button ("Dismiss until tomorrow"). */
  dismissLabel?: string;
  accessibilityHint?: string;
}) {
  const c = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', borderRadius: radius.l, ...smooth,
        backgroundColor: c.surface, borderColor: c.border, borderWidth: hairline, ...lift(c, 'high'),
      }}
    >
      <Tappable
        onPress={() => { haptic.tap(); onPress(); }}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${hint}`}
        accessibilityHint={accessibilityHint}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56, paddingVertical: space.m, paddingLeft: space.l, paddingRight: onDismiss ? 0 : space.l }}
      >
        <Icon name={icon} size={22} color={iconColor} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={2} style={{ ...type.callout, color: c.text }}>{title}</Text>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>{hint}</Text>
        </View>
        {onDismiss ? null : <Icon name="chevron.right" size={14} color={c.textTertiary} weight="semibold" />}
      </Tappable>
      {onDismiss ? (
        <CloseButton label={dismissLabel} onPress={onDismiss} style={{ marginRight: space.xs }} />
      ) : null}
    </View>
  );
}

/**
 * A row in a `Group` that shows something rather than opening it: a label, a symbol before it if
 * any, and what's at its end (a status, a count) as children. The line above it starts at the
 * label, as in every other group. VoiceOver reads the row as one.
 */
export function ValueRow({ label, icon, first, children }: { label: string; icon?: { name: SFSymbol; color: string }; first?: boolean; children?: React.ReactNode }) {
  const c = useTheme();
  return (
    <View accessible style={{ minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, paddingHorizontal: space.l }}>
      {first ? null : <Divider inset={space.l + (icon ? VALUE_ICON + space.m : 0)} />}
      {icon ? <Icon name={icon.name} size={VALUE_ICON} color={icon.color} /> : null}
      <Text style={{ ...type.body, color: c.text, flex: 1 }}>{label}</Text>
      {children}
    </View>
  );
}
const VALUE_ICON = 18;

/**
 * A row in a `Group` with a check circle, for picking several (`CheckRow` is a checkmark, for picking
 * one): tapping it checks it or takes the check off. `big` is a cram lesson's, for a glance
 * mid-conversation. The label is often a word in the language being learned, so it takes Thai's
 * taller line where it needs one.
 */
export function CheckboxRow({ label, detail, checked, onPress, first, big, color, trailing, disabled, labelSize, accessibilityLabel }: {
  label: string;
  detail?: string;
  checked: boolean;
  onPress: () => void;
  first?: boolean;
  big?: boolean;
  /** The check's fill when on: the accent, unless this says otherwise (lesson mode's green). */
  color?: string;
  /** Something small after the text ("Saving"). */
  trailing?: React.ReactNode;
  disabled?: boolean;
  /** Replaces the label's size and line height (a cram's text size, for a label in the cram's language). */
  labelSize?: { fontSize: number; lineHeight: number };
  /** What VoiceOver says when the label and detail leave something out (what `trailing` shows). */
  accessibilityLabel?: string;
}) {
  const c = useTheme();
  return (
    <HoverPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel ?? (detail ? `${label}, ${detail}` : label)}
      style={({ pressed }) => ({
        minHeight: MIN_TAP + (big ? space.l : space.m), flexDirection: 'row', alignItems: 'center', gap: space.m,
        paddingVertical: big ? space.m : space.s + 2, paddingHorizontal: space.l, backgroundColor: pressed ? c.fill : c.surface,
      })}
    >
      {first ? null : <Divider inset={space.l} />}
      <Icon name={checked ? 'checkmark.circle.fill' : 'circle'} size={big ? 26 : 22} color={checked ? color ?? c.accent : c.textTertiary} weight="regular" />
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={{ ...withThaiLineHeight(big ? type.headline : type.body, label), ...labelSize, color: checked && big ? c.textSecondary : c.text }}>{label}</Text>
        {detail ? <Text numberOfLines={2} style={{ ...(big ? type.subhead : type.footnote), color: c.textSecondary }}>{detail}</Text> : null}
      </View>
      {trailing}
    </HoverPressable>
  );
}

/**
 * Something added that a tap takes back out (a tag, a word added to a lesson, a phrase caught in a
 * cram lesson): its text in the gold ink on the gold tint, a line after it if any, and a ×.
 * `labelStyle` replaces the label's size (a cram's text size); a word in the language being
 * learned takes Thai's taller line where it needs one.
 */
export function RemovableChip({ label, detail, onRemove, accessibilityLabel, labelStyle }: { label: string; detail?: string; onRemove: () => void; accessibilityLabel?: string; labelStyle?: TextStyle }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={() => { haptic.tap(); onRemove(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `Remove ${detail ? `${label}, ${detail}` : label}`}
      scaleTo={0.95}
      hitSlop={{ top: 4, bottom: 4 }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, minHeight: 36, paddingVertical: space.xs, paddingLeft: space.m, paddingRight: space.s, borderRadius: radius.pill, backgroundColor: c.accentFill }}
    >
      <Text style={{ ...withThaiLineHeight(type.subhead, label), ...labelStyle, color: c.accentInk }}>{label}</Text>
      {detail ? <Text style={{ ...type.caption, color: c.textSecondary }}>{detail}</Text> : null}
      <Icon name="xmark" size={12} color={c.accentInk} weight="semibold" />
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

function Overline({ children, paddingTop }: { children: React.ReactNode; paddingTop?: number }) {
  const c = useTheme();
  return <Text accessibilityRole="header" style={{ ...type.overline, color: c.textSecondary, paddingHorizontal: space.l, paddingTop }}>{children}</Text>;
}

/** A small all-caps label over a group of rows, for a page whose children are all spaced the same (see `Section`). */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Overline paddingTop={space.s}>{children}</Overline>;
}

/** The gap between `Section`s in a page's scroll content: wider than the 8 inside one, so each reads as a unit. */
export const SECTION_GAP = space.xl;

/**
 * A title, the group of rows it names and the line explaining them, kept 8 apart so they read as one
 * unit. A page made of `Section`s sets `gap: SECTION_GAP` on its scroll content, so the space between
 * units is wider than the space inside one. A flat column at one gap can't say which block a `Help`
 * line belongs to: it is as far from the group above as from the one below.
 */
export function Section({ title, footer, children }: { title?: string; /** The `Help` for the rows above it, lined up with their text. */ footer?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <View style={{ gap: space.s }}>
      {title ? <Overline>{title}</Overline> : null}
      {children}
      {footer ? <View style={{ paddingHorizontal: space.l, gap: space.s }}>{footer}</View> : null}
    </View>
  );
}

/** A line explaining a control or a screen, in the quieter color. */
export function Help({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return <Text style={{ ...type.subhead, color: c.textSecondary, lineHeight: 21 }}>{children}</Text>;
}

/** A count with its label, e.g. "12 due": dimmed when zero so the decks with work stand out. */
export function Count({ value, label, color, current }: { value: number; label: string; color: string; /** Underlines the count, for the one the card on screen is counted in. */ current?: boolean }) {
  const c = useTheme();
  return (
    <Text style={{ ...type.subhead, color: value ? color : c.textDim, fontVariant: ['tabular-nums'], ...(current ? { textDecorationLine: 'underline' as const, textDecorationColor: value ? color : c.textDim } : null) }}>
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
 * passes it as a prop). `keyboardLanguage` is the language the answer is typed in (a speech tag, ru-RU):
 * the field opens on that language's keyboard when the person has it (useKeyboardLanguage).
 * `code` sets it in the system's monospaced face, for a card template or styling.
 */
export function Field({ label, error, ref, onFocus, onBlur, keyboardLanguage, code, ...input }: TextInputProps & { label: string; error?: boolean; keyboardLanguage?: string; code?: boolean; ref?: React.Ref<TextInputInstance> }) {
  const c = useTheme();
  const keyboard = useKeyboardLanguage(keyboardLanguage);
  const noKeyboard = useMissingKeyboard(keyboardLanguage);
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
        onFocus={(e) => { setFocused(true); keyboard.onFocus(); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); keyboard.onBlur(); onBlur?.(e); }}
        style={{
          ...type.body, color: c.text, backgroundColor: c.fill, ...smooth,
          borderColor: error ? c.danger : focused ? c.accent : 'transparent', borderWidth: 1.5, borderRadius: radius.m,
          paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP,
          ...(code ? { fontFamily: 'Menlo', fontSize: type.callout.fontSize } : null),
        }}
      />
      {noKeyboard ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{noKeyboard}</Text> : null}
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
      <Hoverable effect="highlight">
      <Pressable
        onPress={() => { haptic.select(); toggle(!open); }}
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
      </Hoverable>
      {open ? (
        <View style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, overflow: 'hidden' }}>
          {options.map((o, i) => {
            const parts = o.split('::');
            const selected = o === value;
            return (
              <Hoverable key={o} effect="highlight">
              <Pressable
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
              </Hoverable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** A choice among a few (a deck, a note type): pill-shaped, filled when chosen. */
export function Chip({ label, selected = false, onPress, accessibilityLabel, accessibilityLanguage, accessibilityState }: {
  label: string;
  /** A choice that's on. Leave it off for a suggestion that fills something in when tapped (a topic, a question to ask). */
  selected?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  /** The label's language, for a word in the language being learned (it also picks the font). */
  accessibilityLanguage?: string;
  accessibilityState?: AccessibilityState;
}) {
  const c = useTheme();
  return (
    <Tappable
      onPress={() => { haptic.select(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ ...accessibilityState, selected }}
      scaleTo={0.95}
      hitSlop={{ top: 4, bottom: 4 }}
      style={{
        minHeight: 36, justifyContent: 'center', paddingHorizontal: space.m + 2, paddingVertical: space.xs, borderRadius: radius.pill,
        backgroundColor: selected ? c.accent : c.surface, borderWidth: hairline, borderColor: selected ? c.accent : c.border,
      }}
    >
      <Text accessibilityLanguage={accessibilityLanguage} style={{ ...type.subhead, color: selected ? c.onAccent : c.text, fontWeight: selected ? '600' : '400' }}>{label}</Text>
    </Tappable>
  );
}

/**
 * A row of equal segments, one of them chosen: a speed, a length, a text type. iOS's own segmented
 * control, so the thumb slides, it follows the system's look and text size, and VoiceOver treats it
 * as the system's. It can't dim one segment, so options with `disabled` use the drawn one below.
 */
export function Segments<T extends string | number>(props: {
  /** `disabled`: shown dimmed and not tappable, for a choice that can't be made right now. */
  options: { value: T; label: string; accessibilityLabel?: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const { options, value, onChange, style } = props;
  if (options.some((o) => o.disabled)) return <DrawnSegments {...props} />;
  return (
    <View style={style}>
      <Host matchContents={{ vertical: true }} colorScheme={dark ? 'dark' : 'light'} seedColor={c.accent} style={{ alignSelf: 'stretch' }}>
        <Picker
          modifiers={[pickerStyle('segmented')]}
          selection={value}
          onSelectionChange={(v: T) => { if (v !== value) haptic.select(); onChange(v); }}
        >
          {options.map((o) => (
            <SwiftText key={o.value} modifiers={[tag(o.value), ...(o.accessibilityLabel ? [accessibilityLabel(o.accessibilityLabel)] : [])]}>{o.label}</SwiftText>
          ))}
        </Picker>
      </Host>
    </View>
  );
}

/** The segmented control drawn by hand, for a row with a segment that has to be dimmed. */
function DrawnSegments<T extends string | number>({ options, value, onChange, style }: {
  options: { value: T; label: string; accessibilityLabel?: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={[{ flexDirection: 'row', backgroundColor: c.fill, borderRadius: radius.s, ...smooth, padding: 2 }, style]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Hoverable key={o.value} effect={o.disabled ? 'none' : 'highlight'}>
          <Pressable
            onPress={() => { if (!selected) haptic.select(); onChange(o.value); }}
            disabled={o.disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: o.disabled }}
            accessibilityLabel={o.accessibilityLabel ?? o.label}
            hitSlop={{ top: 4, bottom: 4 }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 36, borderRadius: radius.s - 2, ...smooth, backgroundColor: selected ? c.surface : 'transparent', opacity: o.disabled ? 0.4 : 1 }}
          >
            <Text style={{ ...type.subhead, fontWeight: '600', color: selected ? c.text : c.textSecondary }}>{o.label}</Text>
          </Pressable>
          </Hoverable>
        );
      })}
    </View>
  );
}

/**
 * How far through a session or a drill is, as a thin line: Review's under its header, a quiz's over
 * its question. The fill eases to each new value (at once with Reduce Motion). `value` is 0 to 1.
 */
export function ProgressBar({ value, label = 'Progress through this session', style }: { value: number; label?: string; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(value)).current;
  useEffect(() => {
    // Width can't use the native driver; the bar is one view, so the JS-driven animation is cheap.
    Animated.timing(v, { toValue: value, duration: reduce ? 0 : 320, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [value, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      style={[{ height: 4, borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden' }, style]}
    >
      <Animated.View style={{ height: '100%', borderRadius: radius.pill, backgroundColor: c.accent, width: v.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'], extrapolate: 'clamp' }) }} />
    </View>
  );
}

/** Where an answer choice stands: not answered yet, the right one, the one picked wrongly, or another after answering. */
export type AnswerState = 'open' | 'right' | 'wrong' | 'other';

/**
 * The box of a quiz's answer choice, spread into its style: the same in every quiz, a pill grid or
 * a list of rows. The right answer is tinted green and the wrong pick red. The border is the same
 * width in every state, so answering doesn't shift the choice's text.
 */
export function answerLook(c: Colors, state: AnswerState) {
  return {
    borderRadius: radius.m + 2, ...smooth, borderWidth: 1.5,
    backgroundColor: state === 'right' ? c.goodFill : state === 'wrong' ? c.dangerFill : c.surface,
    borderColor: state === 'right' ? c.countDue : state === 'wrong' ? c.danger : c.border,
  } as const;
}

/**
 * A reading as a bar: a share known, a chance of remembering, how far a lesson has played. 6 high
 * with round ends wherever it appears. `value` is 0 to 1. A session's or a drill's progress is
 * `ProgressBar`. With `label`, VoiceOver reads it as a progress bar; leave it off where the
 * surrounding row already says the number. `track` is for a bar on a tinted surface, where the
 * usual fill wouldn't show.
 */
export function Meter({ value, color, width, track, label, style }: { value: number; color: string; width?: number; track?: string; label?: string; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  const share = Math.max(0, Math.min(1, value));
  return (
    <View
      accessible={label ? true : undefined}
      accessibilityRole={label ? 'progressbar' : undefined}
      accessibilityLabel={label}
      accessibilityValue={label ? { min: 0, max: 100, now: Math.round(share * 100) } : undefined}
      style={[{ height: 6, width, borderRadius: radius.pill, backgroundColor: track ?? c.fill, overflow: 'hidden' }, style]}
    >
      <View style={{ width: `${share * 100}%`, height: '100%', borderRadius: radius.pill, backgroundColor: color }} />
    </View>
  );
}

/**
 * What a list or a page shows when there's nothing in it yet: an icon, a title saying so, a line on
 * how something gets there, and, as children, what to do about it (Buttons, a Help line). The same
 * everywhere a screen's whole list is empty; a search that matches nothing, or one empty part of a
 * page, says so in a line instead.
 */
export function EmptyState({ icon, title, body, children }: { icon: SFSymbol; title: string; body?: string; children?: React.ReactNode }) {
  const c = useTheme();
  return (
    <Card style={{ alignItems: 'center', paddingVertical: space.xl, gap: space.s }}>
      <Icon name={icon} size={40} color={c.textTertiary} weight="regular" />
      <Text accessibilityRole="header" style={{ ...type.title, color: c.text, marginTop: space.s, textAlign: 'center' }}>{title}</Text>
      {body ? <Text style={{ ...type.subhead, color: c.textSecondary, lineHeight: 21, textAlign: 'center' }}>{body}</Text> : null}
      {children ? <View style={{ alignSelf: 'stretch', gap: space.s, marginTop: space.m }}>{children}</View> : null}
    </Card>
  );
}

/**
 * A screen's title as a heading in its content, for a name the user wrote (a cram, a deck). The
 * native large title is one line and cuts a long name short; this wraps. Pass no `title` to `Screen`.
 */
export function PageTitle({ children }: { children: string }) {
  const c = useTheme();
  return <Text accessibilityRole="header" style={{ ...type.largeTitle, color: c.text }}>{children}</Text>;
}

/**
 * What a screen shows until its data is in: a spinner, or, when loading failed, why, with Try
 * again. Fills the screen and centers itself, so a screen never sits blank while it waits.
 */
export function Loading({ error, onRetry }: { error?: string | null; onRetry?: () => void }) {
  const c = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: space.xl, minHeight: 160 }}>
      {error ? <ErrorNote centered message={error} onRetry={onRetry} /> : <ActivityIndicator color={c.accent} accessibilityLabel="Loading" />}
    </View>
  );
}

/**
 * Something that failed, with Try again when there's something to retry. A message that opens with
 * "Couldn't <what>." shows that sentence as the title and the rest under it (`splitFailure`). The
 * card is for an error inside a screen; `centered` is for a screen with nothing else to show
 * (`Loading` uses it).
 */
export function ErrorNote({ message, onRetry, centered }: { message: string; onRetry?: () => void; centered?: boolean }) {
  const c = useTheme();
  const { title, reason } = splitFailure(message);
  const words = (
    <>
      {title ? <Text style={{ ...type.headline, color: c.text, textAlign: centered ? 'center' : 'left' }}>{title}</Text> : null}
      <Text style={{ ...type.subhead, color: title ? c.textSecondary : c.danger, textAlign: centered ? 'center' : 'left' }}>{reason}</Text>
    </>
  );
  if (centered) {
    return (
      <View accessibilityRole="alert" style={{ alignItems: 'center', gap: space.xs, maxWidth: 320 }}>
        <Icon name="exclamationmark.triangle" size={40} color={c.danger} weight="regular" />
        <View style={{ gap: space.xs, alignItems: 'center', paddingTop: space.xs }}>{words}</View>
        {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} style={{ marginTop: space.m, alignSelf: 'stretch' }} /> : null}
      </View>
    );
  }
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row', alignItems: 'flex-start', gap: space.m, alignSelf: 'stretch', padding: space.m,
        borderRadius: radius.l, ...smooth, backgroundColor: c.dangerFill, borderWidth: hairline, borderColor: c.dangerEdge,
      }}
    >
      <View style={{ paddingTop: 2 }}><Icon name="exclamationmark.triangle" size={20} color={c.danger} /></View>
      <View style={{ flex: 1, gap: space.xs }}>
        {words}
        {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} style={{ marginTop: space.s }} /> : null}
      </View>
    </View>
  );
}
