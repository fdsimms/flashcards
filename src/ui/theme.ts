import { useColorScheme } from 'react-native';

export function useTheme() {
  const dark = useColorScheme() === 'dark';
  return dark
    ? { bg: '#0f1115', card: '#1a1d24', text: '#f1f1f1', sub: '#9aa0ab', accent: '#d4b46a', border: '#2a2e38',
        again: '#b5473f', hard: '#a8742f', good: '#3d7a52', easy: '#3a6ea5' }
    : { bg: '#f6f4ef', card: '#ffffff', text: '#1b1b1b', sub: '#6b6f78', accent: '#8a6d1f', border: '#e3dfd4',
        again: '#c4554c', hard: '#c98a3a', good: '#4a9063', easy: '#4a80bd' };
}
export type Theme = ReturnType<typeof useTheme>;
