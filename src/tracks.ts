// The tracks the game races, each planned by braga-map on the open world's streets (its tools/track.mjs)
// and raced the same way: the host picks one on the race screen, and every guest takes it from the
// lobby. A new track is braga-map's file and a line here (docs/making-changes.md, "The tracks").
//
// They're imported with the game, a track some 40 KB gzipped, rather than when one is raced: a race
// starts the moment the host's message comes in, with no time to download anything.
import type { Track as Course } from 'braga-map';
import amigos from 'braga-map/tracks/amigos.js';
import lamacaes from 'braga-map/tracks/lamacaes.js';

export interface Raced {
  course: Course;
  // What the race screen says of it after its name and length, to a player.
  blurb: string;
}

export const TRACKS: Raced[] = [
  { course: amigos, blurb: 'à porta dos amigos' },
  { course: lamacaes, blurb: 'à volta de Santa Tecla e de Lamaçães, e de regresso ao pé do Picoto' },
];

// The Volta dos Amigos keeps its place in the world when no race is on: the city is loaded round it, its
// plinth stands at its start, the friends' eggs on their houses beside it (braga-map's decision 014), and
// the brown signs to the landmarks it passes.
export const HOME = amigos;

// The track with this id, or the first if there's none (an id from a build with other tracks).
export const courseById = (id: string): Course => (TRACKS.find((t) => t.course.id === id) ?? TRACKS[0]).course;

// A race ends at the latest after this long a lap (and a minute), at 60 km/h on average: seconds.
export const lapLimit = (c: Course): number => Math.ceil(c.length / 16.7);

// Its length as a player reads it: "10,2 km".
export const km = (c: Course): string => `${(c.length / 1000).toFixed(1).replace('.', ',')} km`;
