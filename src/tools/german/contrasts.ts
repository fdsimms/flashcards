import { plainSet } from '../contrastBuild';
import type { ContrastSet } from '../contrasts';

/** German's Which word fits sets (src/tools/contrasts.ts). Hand-written; a German speaker's check is worth more than the tests. */
export const GERMAN_CONTRASTS: readonly ContrastSet[] = [
  plainSet('de-to', [
    { word: 'nach', rule: 'To a city, or a country with no article, and nach Hause: home.' },
    { word: 'zu', rule: 'To a person, a shop, a building or an event: zu Oma, zum Arzt, zur Party.' },
  ], [
    ['Wir fliegen morgen _ Spanien.', 0, "We're flying to Spain tomorrow."],
    ['Ich gehe heute _ meiner Oma.', 1, "I'm going to my grandma's today."],
    ['Wann kommst du _ Hause?', 0, 'When are you coming home?'],
    ['Ich muss _ Arzt.', 1, 'I have to go to the doctor.', 'zum'],
    ['Der Zug fährt _ München.', 0, 'The train goes to Munich.'],
    ['Kommst du mit _ Party?', 1, 'Are you coming to the party?', 'zur'],
    ['Sie zieht nächstes Jahr _ Wien.', 0, "She's moving to Vienna next year."],
    ['Ich gehe schnell _ Bäcker.', 1, "I'm just popping to the bakery.", 'zum'],
    ['Wie komme ich _ Bahnhof?', 1, 'How do I get to the station?', 'zum'],
    ['Im Sommer fahren wir _ Italien.', 0, "In the summer we're going to Italy."],
  ]),
  plainSet('de-ask', [
    { word: 'fragen', rule: 'To ask a question. fragen nach: to ask about.' },
    { word: 'bitten', rule: 'To ask for something, or ask someone to do something. bitten um: to ask for.' },
  ], [
    ['Darf ich dich etwas _?', 0, 'Can I ask you something?'],
    ['Er hat mich um Hilfe _.', 1, 'He asked me for help.', 'gebeten'],
    ['Sie hat mich nach meinem Namen _.', 0, 'She asked me my name.', 'gefragt'],
    ['Ich _ Sie, leise zu sein.', 1, "I'm asking you to be quiet.", 'bitte'],
    ['_ doch den Lehrer!', 0, 'Just ask the teacher!', 'Frag'],
    ['Wir _ um Ihr Verständnis.', 1, 'We ask for your understanding.', 'bitten'],
    ['Warum _ du so viel?', 0, 'Why do you ask so many questions?', 'fragst'],
    ['Kann ich Sie um einen Gefallen _?', 1, 'Can I ask you a favor?', 'bitten'],
    ['Er _, wie spät es ist.', 0, "He's asking what time it is.", 'fragt'],
    ['Sie hat ihn _, das Fenster zu schließen.', 1, 'She asked him to close the window.', 'gebeten'],
  ]),
  plainSet('de-since', [
    { word: 'seit', rule: 'Since, or for: something that started then and is still going on.' },
    { word: 'vor', rule: 'Ago: something that happened then and is over.' },
  ], [
    ['Ich wohne _ drei Jahren in Berlin.', 0, "I've lived in Berlin for three years."],
    ['Ich bin _ drei Jahren nach Berlin gezogen.', 1, 'I moved to Berlin three years ago.'],
    ['_ einer Woche habe ich sie getroffen.', 1, 'I met her a week ago.', 'Vor'],
    ['Er ist _ Montag krank.', 0, "He's been sick since Monday."],
    ['Wir kennen uns _ der Schule.', 0, "We've known each other since school."],
    ['Der Zug ist _ fünf Minuten abgefahren.', 1, 'The train left five minutes ago.'],
    ['_ wann lernst du Deutsch?', 0, 'How long have you been learning German?', 'Seit'],
    ['Das Restaurant hat _ einem Monat zugemacht.', 1, 'The restaurant closed a month ago.'],
    ['Ich warte schon _ einer Stunde.', 0, "I've been waiting for an hour."],
    ['Wir haben _ zwei Tagen telefoniert.', 1, 'We talked on the phone two days ago.'],
  ]),
];
