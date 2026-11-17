import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type TextStyle } from 'react-native';
import { DEFAULT_FONT_SETTINGS, launchFont, resolveFontFace, type AppFont, type FontSettings } from '../core/fonts';
import type { Repo } from '../db/repo';
import { useTheme } from './theme';

/**
 * The app's font (Settings, Font): every `Text` and `TextInput` draws in it, and a card shows its own
 * (`CardFontScope`).
 *
 * `Text` and `TextInput` are replaced on the `react-native` module object by wrappers that read the font
 * from context, so no screen has to say which font it's in, and one added later is already in it. That
 * works because Metro compiles `import { Text } from 'react-native'` to a member access made when the
 * screen renders, not a binding taken when it's imported. Code that took `Text` at module scope with
 * `require` would miss it; there is none.
 *
 * Rule: a style that sets `fontFamily` at all (even to `undefined`, which means the system font) is left
 * alone, so a face a screen names itself (Prompt for loopless Thai, a font row's own preview) is never
 * replaced. Text that should follow the app's font must leave `fontFamily` out of its style.
 */

/** The font text draws in here: the app's, or a card's inside `CardFontScope`. */
const FontContext = createContext<AppFont>('system');
/** The weight of the `Text` this one is nested in, which it keeps unless it sets its own (as on iOS). */
const InheritedWeight = createContext<TextStyle['fontWeight']>(undefined);

type Props = { style?: unknown; children?: React.ReactNode; [key: string]: unknown };
let patched = false;

function applyPatch() {
  if (patched) return;
  patched = true;
  // `require`, not `import * as`: the namespace import is a copy, and what's patched must be the module's own object.
  const RN = require('react-native') as Record<string, React.ComponentType<Props>>;
  for (const name of ['Text', 'TextInput'] as const) {
    const Base = RN[name];
    if (!Base) continue;
    const isText = name === 'Text';
    const WithFont = (props: Props) => {
      const font = useContext(FontContext);
      const inherited = useContext(InheritedWeight);
      // The system font is the default: pass straight through, with no flatten and no extra style.
      if (font === 'system') return <Base {...props} />;
      const flat = StyleSheet.flatten(props.style as TextStyle) ?? {};
      // Any opinion about the family stands (Prompt for loopless Thai). `in`, because `fontFamily: undefined` is one too.
      if ('fontFamily' in flat) return <Base {...props} />;
      const weight = flat.fontWeight ?? inherited;
      const fontFamily = resolveFontFace(font, weight);
      if (!fontFamily) return <Base {...props} />;
      // The face is the weight: with `fontWeight` left on, iOS would fake a bold over a bold face.
      const text = <Base {...props} style={[props.style, { fontFamily, fontWeight: undefined }]} />;
      return isText && flat.fontWeight !== undefined ? <InheritedWeight.Provider value={flat.fontWeight}>{text}</InheritedWeight.Provider> : text;
    };
    Object.assign(WithFont, Base); // statics (TextInput.State)
    WithFont.displayName = `AppFont(${name})`;
    Object.defineProperty(RN, name, { configurable: true, enumerable: true, get: () => WithFont });
  }
}

// Runs on import: _layout imports this module before anything renders.
applyPatch();

interface FontValue {
  settings: FontSettings;
  /** The font the app is drawn in now: the chosen one, or the pick made when the app opened. */
  font: AppFont;
  /** Saves the choice, then shows it. Rejects when it couldn't be saved, so the screen can say so. */
  save: (next: FontSettings) => Promise<void>;
}

const Value = createContext<FontValue | null>(null);

export function useFontSettings(): FontValue {
  const v = useContext(Value);
  if (!v) throw new Error('useFontSettings is used outside AppFontScope');
  return v;
}

/** Holds the app's font for everything below it. Shows nothing until the setting is read, so no screen draws in the wrong font first. */
export function AppFontScope({ repo, children }: { repo: Repo; children: React.ReactNode }) {
  const c = useTheme();
  const [loaded, setLoaded] = useState<{ settings: FontSettings; font: AppFont }>();

  useEffect(() => {
    let stale = false;
    repo.fontSettings()
      .catch(() => DEFAULT_FONT_SETTINGS) // a setting that can't be read is no reason to keep the app from opening
      .then((settings) => { if (!stale) setLoaded({ settings, font: launchFont(settings) }); });
    return () => { stale = true; };
  }, [repo]);

  const save = useCallback(async (next: FontSettings) => {
    await repo.saveFontSettings(next);
    // A random pick holds until the app is opened again, unless the font showing is no longer in the pool.
    setLoaded((prev) => ({ settings: next, font: !next.random ? next.font : prev && next.pool.includes(prev.font) ? prev.font : launchFont(next) }));
  }, [repo]);

  const value = useMemo(() => loaded && { settings: loaded.settings, font: loaded.font, save }, [loaded, save]);
  if (!value) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  return (
    <Value.Provider value={value}>
      <FontContext.Provider value={value.font}>{children}</FontContext.Provider>
    </Value.Provider>
  );
}

/** The font text draws in here: the app's, or a card's inside `CardFontScope`. */
export function useFont(): AppFont {
  return useContext(FontContext);
}

/** A card's own font, over the app's: what a deck cycling its fonts picked for this card, or the system font when cards don't use the app's. */
export function CardFontScope({ font, children }: { font: AppFont; children: React.ReactNode }) {
  return <FontContext.Provider value={font}>{children}</FontContext.Provider>;
}
