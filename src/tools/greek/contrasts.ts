import { plainSet } from '../contrastBuild';
import type { ContrastSet } from '../contrasts';

/** Greek's Which word fits sets (src/tools/contrasts.ts). Hand-written; a Greek speaker's check is worth more than the tests. */
export const GREEK_CONTRASTS: readonly ContrastSet[] = [
  plainSet('el-see', [
    { word: 'βλέπω', rule: 'To see. Also to watch TV or a movie.' },
    { word: 'κοιτάζω', rule: 'To look at: to turn your eyes to something on purpose. Κοίτα! is "Look!"' },
  ], [
    ['Δεν _ τίποτα, είναι σκοτάδι.', 0, "I can't see anything, it's dark.", 'βλέπω'],
    ['_ εδώ!', 1, 'Look here!', 'Κοίτα'],
    ['Χθες _ μια ταινία.', 0, 'I watched a movie yesterday.', 'είδα'],
    ['Γιατί με _ έτσι;', 1, 'Why are you looking at me like that?', 'κοιτάζεις'],
    ['_ τον Νίκο στο σούπερ μάρκετ.', 0, 'I saw Nikos at the supermarket.', 'Είδα'],
    ['_ έξω από το παράθυρο.', 1, 'I looked out the window.', 'Κοίταξα'],
    ['Από εδώ _ τη θάλασσα.', 0, 'From here we can see the sea.', 'βλέπουμε'],
    ['_ τον χάρτη πριν φύγουμε.', 1, 'Look at the map before we leave.', 'Κοίτα'],
    ['Τα παιδιά _ τηλεόραση.', 0, 'The kids are watching TV.', 'βλέπουν'],
    ['Μην _ το κινητό σου στο τραπέζι.', 1, "Don't look at your phone at the table.", 'κοιτάς'],
  ]),
];
