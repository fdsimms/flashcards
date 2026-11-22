import { plainSet } from '../contrastBuild';
import type { ContrastSet } from '../contrasts';

/** French's Which word fits sets (src/tools/contrasts.ts). Hand-written; a French speaker's check is worth more than the tests. */
export const FRENCH_CONTRASTS: readonly ContrastSet[] = [
  plainSet('fr-bring', [
    { word: 'amener', rule: 'To bring a person here, to where you are or are going.' },
    { word: 'apporter', rule: 'To bring a thing here.' },
    { word: 'emmener', rule: 'To take a person away, somewhere else.' },
    { word: 'emporter', rule: 'To take a thing away with you.' },
  ], [
    ['Tu peux _ du vin ce soir ?', 1, 'Can you bring some wine tonight?'],
    ['Je vais _ les enfants au parc.', 2, "I'm going to take the kids to the park."],
    ['Pense à _ ton parapluie.', 3, 'Remember to take your umbrella.'],
    ['Vous pouvez _ votre ami à la fête.', 0, 'You can bring your friend to the party.'],
    ["Le serveur va _ l'addition.", 1, 'The waiter is going to bring the check.'],
    ['Sur place ou à _ ?', 3, 'For here or to go?'],
    ['Ce soir, il _ sa copine au cinéma.', 2, "Tonight he's taking his girlfriend to the movies.", 'emmène'],
    ['_ ta sœur dimanche, on sera contents de la voir.', 0, "Bring your sister on Sunday, we'll be glad to see her.", 'Amène'],
    ["Je t'ai _ un cadeau.", 1, 'I brought you a present.', 'apporté'],
    ['Le vent a _ mon chapeau.', 3, 'The wind blew my hat away.', 'emporté'],
    ['Il faut _ le chien chez le vétérinaire.', 2, 'We need to take the dog to the vet.'],
    ['Qui va _ grand-mère ici demain ?', 0, "Who's bringing Grandma here tomorrow?"],
  ]),
];
