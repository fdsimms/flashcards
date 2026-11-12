import { Stack } from 'expo-router';
import React from 'react';
import { useStackScreenOptions } from '../../../ui/stackOptions';

/** The Decks tab's own stack, so its screen gets the native header. */
export default function DecksStack() {
  return <Stack screenOptions={useStackScreenOptions()} />;
}
