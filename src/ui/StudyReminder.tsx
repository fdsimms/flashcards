import React from 'react';
import { Alert, Linking, ScrollView, Text, useWindowDimensions } from 'react-native';
import { failureText } from '../core/failure';
import { REMINDER_MINUTES, type ReminderPrefs } from '../core/reminder';
import { Card, Group, Help, Loading, Screen, SwitchRow } from './kit';
import { notificationsAllowed, reminderTime, saveReminder, useReminderPrefs } from './studyReminder';
import { space, type, useTheme } from './theme';
import { Wheel, WheelBand, wheelScale } from './tools/Wheel';

const hourLabel = (hour: number) => new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: 'numeric' });

/**
 * Settings, Study reminder: whether Franki sends a notification each day, and at what time
 * (src/core/reminder.ts says what it holds). Off until turned on; turning it on asks iOS for
 * permission the first time.
 */
export function StudyReminder() {
  const c = useTheme();
  const { fontScale } = useWindowDimensions();
  const prefs = useReminderPrefs();

  const save = async (next: ReminderPrefs) => {
    try {
      await saveReminder(next);
    } catch (e) {
      Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' }));
    }
  };

  const turn = async (on: boolean) => {
    if (!prefs) return;
    if (on && !(await notificationsAllowed(true).catch(() => false))) {
      Alert.alert(
        'Notifications are off for Franki',
        'To get a study reminder, allow notifications for Franki in the Settings app, then turn this on again.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Open Settings', onPress: () => { Linking.openSettings().catch(() => undefined); } }],
      );
      return;
    }
    await save({ ...prefs, on });
  };

  // A minute saved by hand that the wheel doesn't offer shows at the nearest one before it.
  const minuteIndex = prefs ? Math.max(0, REMINDER_MINUTES.findLastIndex((m) => m <= prefs.minute)) : 0;

  return (
    <Screen title="Study reminder" largeTitle={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.m }}>
        {!prefs ? <Loading /> : (
          <>
            <Group>
              <SwitchRow
                first
                label="Remind me to study"
                hint={prefs.on ? `Every day at ${reminderTime(prefs)}.` : 'A notification each day with how many reviews and new cards are waiting.'}
                value={prefs.on}
                onValueChange={turn}
              />
            </Group>
            {prefs.on ? (
              <Card style={{ alignItems: 'center', gap: space.s }}>
                <Text style={{ ...type.subhead, color: c.textSecondary, alignSelf: 'flex-start' }}>Time</Text>
                <WheelBand>
                  <Wheel label="Hour" count={24} value={prefs.hour} format={hourLabel} width={88 * wheelScale(fontScale)} onChange={(hour) => save({ ...prefs, hour })} />
                  <Text maxFontSizeMultiplier={2} style={{ ...type.title, fontSize: 28, color: c.text, paddingBottom: 3 }}>:</Text>
                  <Wheel
                    label="Minute"
                    count={REMINDER_MINUTES.length}
                    value={minuteIndex}
                    format={(i) => String(REMINDER_MINUTES[i]).padStart(2, '0')}
                    width={64 * wheelScale(fontScale)}
                    onChange={(i) => save({ ...prefs, minute: REMINDER_MINUTES[i] })}
                  />
                </WheelBand>
              </Card>
            ) : null}
            <Help>
              The counts are the deck list's as of the last time Franki was open, since iOS shows a reminder as it was written.
              Answers given in Anki or AnkiMobile after that aren't in them. If Franki hasn't been opened that day, the reminder
              doesn't give a number. Nothing is sent anywhere: the reminder is made on this iPhone.
            </Help>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
