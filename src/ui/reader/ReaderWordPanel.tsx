import React from 'react';
import { SidePanel } from '../SidePanel';

/**
 * The tapped word's panel beside the text on a wide window (SidePanel.tsx): what the gloss
 * popover shows on a phone. The text's scroll view leaves room for it (Reader.tsx).
 */
export function ReaderWordPanel({ children }: { children?: React.ReactNode }) {
  return <SidePanel label="Word" empty="Tap a word to see its meaning.">{children}</SidePanel>;
}
