import type { ImageSourcePropType } from 'react-native';
import type { Language } from '../reader/api';

// A flag per language as an image, for a header button: iOS draws an icon-only button as a circle,
// but one labeled with a flag emoji as a pill.
export const FLAG_IMAGES: Record<Language, ImageSourcePropType> = {
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
};
