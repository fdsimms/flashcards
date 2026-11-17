import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SAVED_LABEL, type SavedState } from '../../reader/downloads';
import { Icon } from '../kit';
import { useTheme } from '../theme';

/**
 * Whether a shelf text is kept on the phone for offline (src/reader/downloads.ts), the way iOS
 * shows a download: a filled arrow once it's on this iPhone, a spinner while it saves, an outlined
 * arrow while it isn't saved yet. Not a button: texts download by themselves.
 */
export function SavedMark({ state }: { state: SavedState }) {
  const c = useTheme();
  return (
    <View accessible accessibilityLabel={SAVED_LABEL[state]} style={{ width: 22, alignItems: 'center' }}>
      {state === 'saving'
        ? <ActivityIndicator size="small" color={c.textSecondary} />
        : <Icon name={state === 'saved' ? 'arrow.down.circle.fill' : 'arrow.down.circle'} size={20} color={c.textSecondary} />}
    </View>
  );
}
