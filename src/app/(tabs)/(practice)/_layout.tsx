import { Stack } from 'expo-router';
import React from 'react';
import { useStackScreenOptions } from '../../../ui/stackOptions';

/** The Practice tab's own stack, so its list gets the native header. */
export default function PracticeStack() {
  return <Stack screenOptions={useStackScreenOptions()} />;
}
