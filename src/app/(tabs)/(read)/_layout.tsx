import { Stack } from 'expo-router';
import React from 'react';
import { useStackScreenOptions } from '../../../ui/stackOptions';

/** The Read & Listen tab's own stack, so its home gets the native header. */
export default function ReadStack() {
  return <Stack screenOptions={useStackScreenOptions()} />;
}
