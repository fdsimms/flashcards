import { ActionSheetIOS } from 'react-native';
import { QUIET_CHOICES, type QuietChoice } from '../core/quietMode';

/** Quiet mode's length choices (and Turn off while it's on): the sheet Review's header and Today's card both open. */
export function chooseQuietLength({ active, onStart, onOff }: { active: boolean; onStart: (choice: QuietChoice) => void; onOff: () => void }): void {
  const options = [...QUIET_CHOICES.map((q) => q.label), ...(active ? ['Turn off Quiet mode'] : []), 'Cancel'];
  ActionSheetIOS.showActionSheetWithOptions({
    title: 'Quiet mode',
    message: 'Listening cards stay due and come back when this ends. Sound and the microphone are off.',
    options,
    cancelButtonIndex: options.length - 1,
    destructiveButtonIndex: active ? options.length - 2 : undefined,
  }, (i) => {
    if (i === options.length - 1) return;
    if (i < QUIET_CHOICES.length) onStart(QUIET_CHOICES[i].choice);
    else onOff();
  });
}
