import { requireOptionalNativeModule } from 'expo';

/** One Home Screen quick action (long-press the app icon). `deck` comes back with the tap. */
export interface HomeShortcutItem {
  type: string;
  title: string;
  subtitle?: string;
  /** An SF Symbol's name. */
  symbol?: string;
  deck?: string;
}

/** The native side (ios/HomeShortcutsModule.swift). */
interface Native {
  setItems(items: HomeShortcutItem[]): Promise<void>;
  takePending(): Promise<{ type: string; deck?: string } | null>;
  addListener(event: 'onShortcut', listener: () => void): { remove: () => void };
}

/** Null in a build made before this module was added, which then has no quick actions. */
export const homeShortcutsNative: Native | null = requireOptionalNativeModule<Native>('HomeShortcuts');
