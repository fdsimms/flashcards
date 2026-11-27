import type { ImageSourcePropType } from 'react-native';
import type { GlossLanguage } from '../reader/api';

// A flag per language as an image, for a header button: iOS draws an icon-only button as a circle,
// but one labeled with a flag emoji as a pill. The files are 26 points in 1x, @2x and @3x: the button
// takes its width from the image's size in points, so a bigger image makes a pill around a small
// flag (tests/flagImages.test.ts).
export const FLAG_IMAGES: Record<GlossLanguage, ImageSourcePropType> = {
  th: require('../../assets/flags/th.png'),
  es: require('../../assets/flags/es.png'),
  de: require('../../assets/flags/de.png'),
  fr: require('../../assets/flags/fr.png'),
  ru: require('../../assets/flags/ru.png'),
  el: require('../../assets/flags/el.png'),
  pl: require('../../assets/flags/pl.png'),
  nb: require('../../assets/flags/nb.png'),
  en: require('../../assets/flags/en.png'),
  ja: require('../../assets/flags/ja.png'),
  // Toki Pona has no flag: its deck's 🙂, drawn as the other flags are.
  tok: require('../../assets/flags/tok.png'),
};
