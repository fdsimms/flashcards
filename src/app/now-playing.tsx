import React from 'react';
import { NowPlaying } from '../ui/reader/NowPlaying';

/** Now Playing, opened from the tab bar's player as a sheet (the root stack sets it up). */
export default function NowPlayingRoute() {
  return <NowPlaying />;
}
