import { requireOptionalNativeModule } from 'expo';

/** The native side of the listening Live Activity (ios/ListeningActivityModule.swift). */
interface Native {
  isAvailable(): boolean;
  start(title: string, kind: string, skipsBySeconds: boolean, playing: boolean, detail: string, position: number, duration: number): boolean;
  update(playing: boolean, detail: string, position: number, duration: number): void;
  end(): void;
  addListener(event: 'onAction', listener: (e: { action: string }) => void): { remove: () => void };
}

const mod = requireOptionalNativeModule<Native>('ListeningActivity');

/** Null in a build made before this module was added, which then shows no activity. */
export const listeningActivityNative: Native | null = mod;
