import type { AudioSource } from 'expo-audio';

/**
 * The break between a looped text's last line and its first: a soft chime, then silence
 * (assets/make-loop-break.py). Played on the reader's own player, so it's heard with the screen
 * locked and on the mini-player too, and its end is what starts the first line again.
 */
export const LOOP_BREAK_SOURCE: AudioSource = require('../../assets/sounds/loop-break.wav');
