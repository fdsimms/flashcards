import React from 'react';
import { GENRES, genreLabel, genreOfLabel, type Genre } from '../../reader/genre';
import { Select } from '../kit';

/** The Genre row on the New dialogue, story and series sheets (reader/genre.ts). */
export function GenrePick({ genre, onChange }: { genre: Genre; onChange: (genre: Genre) => void }) {
  return <Select label="Genre" options={GENRES.map((g) => g.label)} value={genreLabel(genre)} onChange={(label) => onChange(genreOfLabel(label))} />;
}
