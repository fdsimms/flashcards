import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, View, type GestureResponderEvent, type HostInstance, type ScrollViewInstance, type ViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deckDropTarget, deckMove, type DeckDropTarget, type DeckMove, type RowSlot } from '../core/deckOrder';
import { deckRowX } from './deckLayout';
import { haptic } from './haptics';
import { lift, radius, smooth, useTheme } from './theme';

/**
 * Dragging a deck on the deck list to reorder, nest or unnest it: hold a row, then move it up or
 * down to choose the gap, and sideways to choose how deep it goes there (a line shows both). The
 * deck's subdecks move with it. What a drop means is `deckDropTarget` and `deckMove`
 * (src/core/deckOrder.ts); this is only the gesture.
 *
 * After dundundun's ReorderableList, with its rules: a long press lifts the row; the responder is
 * claimed in the capture phase by the view holding every row, so the row's own swipe and press
 * give way; the list's scrolling is off for the drag (`dragging`), or the scroll view takes the
 * touch back on the first move. Nothing re-renders while the finger moves: the card and the line
 * are Animated values set directly, and the list renders only when a drag starts and ends.
 *
 * Unlike that list, the rows don't slide apart to open a gap: they sit in rounded cards that clip
 * them, and a gap can be in a card or between two. The line shows where the deck will land
 * instead, indented to its depth, the way a sidebar does.
 *
 * Positions are measured once, when the drag starts (nothing moves under it after that but the
 * scroll), in the content's own coordinates (`measureLayout` against the view holding the rows),
 * and the card and line are drawn in that view too, so a scroll moves them with the rows.
 */

/** How far the finger moves sideways to go one level deeper or shallower. */
const DEPTH_STEP = 32;
/** How close to the top or bottom edge the card has to be for the list to scroll. */
const AUTOSCROLL_ZONE = 56;
const AUTOSCROLL_STEP = 8;
/** The navigation bar under the status bar, and the tab bar above the home indicator, which the list scrolls under. */
const NAV_BAR = 44;
const TAB_BAR = 49;

interface Measured { x: number; y: number; width: number; height: number }

interface Drag {
  deck: string;
  depth: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** Filled in once the rows are measured; until then the finger moves nothing. */
  rows?: RowSlot[];
  card?: Measured;
  scrollStart: number;
  /** The scroll view's top and height on screen. */
  view?: { top: number; height: number };
  target?: DeckDropTarget;
}

const measureIn = (view: HostInstance, inside: HostInstance) => new Promise<Measured | null>((resolve) => {
  try {
    view.measureLayout(inside, (x, y, width, height) => resolve({ x, y, width, height }), () => resolve(null));
  } catch {
    resolve(null);
  }
});
const measureOnScreen = (view: HostInstance) => new Promise<{ y: number; height: number }>((resolve) => {
  view.measureInWindow((_x, y, _w, height) => resolve({ y, height }));
});

export function useDeckDrag(opts: {
  /** Every deck in the deck list's order, collapsed ones' subdecks included. */
  decks: string[];
  /** The rows on screen, in order. */
  shown: { deck: string; depth: number }[];
  onMove: (move: DeckMove) => void;
  /** The row as the card being dragged draws it. */
  renderCard: (deck: string) => React.ReactNode;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [dragging, setDragging] = useState<string | null>(null);
  const [card, setCard] = useState<{ deck: string; at: Measured } | null>(null);
  const drag = useRef<Drag | null>(null);
  const content = useRef<ViewInstance>(null);
  const scrollView = useRef<ScrollViewInstance>(null);
  const rows = useRef(new Map<string, ViewInstance>());
  const scrollY = useRef(0);
  const contentHeight = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cardX = useRef(new Animated.Value(0)).current;
  const cardY = useRef(new Animated.Value(0)).current;
  const lineX = useRef(new Animated.Value(0)).current;
  const lineY = useRef(new Animated.Value(0)).current;
  // The handlers below are made once, so they read the latest props from here.
  const latest = useRef({ ...opts, insets });
  latest.current = { ...opts, insets };

  // One ref callback per deck, so a row doesn't get a new one every render.
  const refs = useRef(new Map<string, (v: ViewInstance | null) => void>());
  const rowRef = useCallback((deck: string) => {
    let fn = refs.current.get(deck);
    if (!fn) {
      fn = (v) => { if (v) rows.current.set(deck, v); else rows.current.delete(deck); };
      refs.current.set(deck, fn);
    }
    return fn;
  }, []);

  const stopScrolling = () => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  };

  /** Puts the card under the finger, and the line where it would land. */
  const follow = () => {
    const d = drag.current;
    if (!d?.rows || !d.card) return;
    const dy = d.y - d.startY + (scrollY.current - d.scrollStart);
    const dx = d.x - d.startX;
    cardY.setValue(dy);
    cardX.setValue(Math.max(-DEPTH_STEP * 2, Math.min(DEPTH_STEP * 2, dx)));
    const target = deckDropTarget(d.rows, d.deck, d.card.y + dy + d.card.height / 2, d.depth + dx / DEPTH_STEP);
    // The line starts where a row would at that depth (the wells' indent, deckLayout.ts).
    lineX.setValue(d.card.x + deckRowX(target.depth));
    lineY.setValue(target.lineY);
    if (d.target && (d.target.after !== target.after || d.target.depth !== target.depth)) haptic.select();
    d.target = target;
  };

  /** Scrolls the list while the card is held near its top or bottom edge. */
  const scrollIfAtEdge = () => {
    const d = drag.current;
    if (!d?.card || !d.view) return;
    const { insets: safe } = latest.current;
    const top = safe.top + NAV_BAR;
    const bottom = d.view.top + d.view.height - safe.bottom - TAB_BAR;
    // The card on screen: where its row was, plus how far the finger has moved.
    const cardTop = d.view.top + d.card.y - d.scrollStart + (d.y - d.startY);
    const step = cardTop < top + AUTOSCROLL_ZONE ? -AUTOSCROLL_STEP
      : cardTop + d.card.height > bottom - AUTOSCROLL_ZONE ? AUTOSCROLL_STEP : 0;
    if (step === 0) { stopScrolling(); return; }
    if (timer.current !== null) return;
    // Never past the content's ends: a scroll set from code stays where it's put, and the list
    // would be left with a gap above or below it.
    const min = -(top - d.view.top);
    const max = Math.max(min, contentHeight.current - (bottom - d.view.top));
    timer.current = setInterval(() => {
      // Toward an end and no further, nor back from past it (the large title open at the top).
      const at = scrollY.current;
      const next = step < 0 ? Math.max(Math.min(min, at), at + step) : Math.min(Math.max(max, at), at + step);
      if (!drag.current || next === scrollY.current) { stopScrolling(); return; }
      scrollY.current = next;
      scrollView.current?.scrollTo({ y: next, animated: false });
      follow();
    }, 16);
  };

  const end = useCallback((drop: boolean) => {
    stopScrolling();
    const d = drag.current;
    drag.current = null;
    setDragging(null);
    setCard(null);
    if (!drop || !d?.target) return;
    const move = deckMove(latest.current.decks, d.deck, d.target.after, d.target.depth);
    if (move) latest.current.onMove(move);
  }, []);

  /** Lifts `deck`'s row, from the long press on it. */
  const begin = useCallback(async (deck: string, e: GestureResponderEvent) => {
    if (drag.current || !content.current || !scrollView.current) return;
    const { pageX, pageY } = e.nativeEvent;
    const d: Drag = { deck, depth: deck.split('::').length - 1, startX: pageX, startY: pageY, x: pageX, y: pageY, scrollStart: 0 };
    drag.current = d;
    haptic.lift();
    setDragging(deck);
    const inside = content.current;
    const shown = latest.current.shown.filter((r) => rows.current.has(r.deck));
    const [measured, view, own] = await Promise.all([
      Promise.all(shown.map((r) => measureIn(rows.current.get(r.deck)!, inside))),
      measureOnScreen(scrollView.current),
      measureOnScreen(rows.current.get(deck) ?? inside),
    ]);
    if (drag.current !== d) return;
    const slots: RowSlot[] = [];
    shown.forEach((r, i) => { const m = measured[i]; if (m) slots.push({ deck: r.deck, depth: r.depth, top: m.y, height: m.height }); });
    const at = measured[shown.findIndex((r) => r.deck === deck)];
    if (!at) { end(false); return; }
    // Where the list is scrolled to, from where the row is on screen: a scroll event may not have
    // come yet, and the one kept would then be 0 with the list resting under the large title.
    scrollY.current = at.y - (own.y - view.y);
    d.scrollStart = scrollY.current;
    d.rows = slots;
    d.card = at;
    d.view = { top: view.y, height: view.height };
    cardX.setValue(0);
    cardY.setValue(0);
    setCard({ deck, at });
    follow();
  }, [end, cardX, cardY]); // eslint-disable-line react-hooks/exhaustive-deps

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    // In the capture phase, so the row's swipe and press let go once the drag has started.
    onMoveShouldSetPanResponderCapture: () => drag.current !== null,
    onMoveShouldSetPanResponder: () => drag.current !== null,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (e) => {
      const d = drag.current;
      if (!d) return;
      d.x = e.nativeEvent.pageX;
      d.y = e.nativeEvent.pageY;
      follow();
      scrollIfAtEdge();
    },
    onPanResponderRelease: () => end(true),
    onPanResponderTerminate: () => end(false),
  }), [end]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => stopScrolling, []);

  /** Spread on the view holding every row, inside the scroll view. */
  const contentProps = {
    ref: content,
    collapsable: false,
    ...responder.panHandlers,
    // A press held and let go without moving never hands the touch over: end it here.
    onTouchEnd: () => { if (drag.current) end(true); },
    onTouchCancel: () => { if (drag.current) end(false); },
  };

  /** Spread on the scroll view. */
  const scrollProps = {
    ref: scrollView,
    scrollEnabled: dragging === null,
    scrollEventThrottle: 16,
    onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) => { scrollY.current = e.nativeEvent.contentOffset.y; },
    onContentSizeChange: (_w: number, h: number) => { contentHeight.current = h; },
  };

  // Last inside the view holding the rows, so it's drawn over them and outside their cards.
  const overlay = card ? (
    <>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute', top: -4, left: lineX, width: Animated.subtract(card.at.x + card.at.width, lineX),
          flexDirection: 'row', alignItems: 'center', transform: [{ translateY: lineY }],
        }}
      >
        <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: c.accent, backgroundColor: c.bg }} />
        <View style={{ flex: 1, height: 2, borderRadius: 1, backgroundColor: c.accent }} />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute', left: card.at.x, top: card.at.y, width: card.at.width,
          borderRadius: radius.l, ...smooth, backgroundColor: c.surface, ...lift(c, 'high'),
          transform: [{ translateX: cardX }, { translateY: cardY }, { scale: 1.03 }],
        }}
      >
        {/* Clipped inside the shadow's box: a view that clips can't also cast one. */}
        <View style={{ borderRadius: radius.l, ...smooth, overflow: 'hidden' }}>{latest.current.renderCard(card.deck)}</View>
      </Animated.View>
    </>
  ) : null;

  return { dragging, begin, rowRef, contentProps, scrollProps, overlay };
}
