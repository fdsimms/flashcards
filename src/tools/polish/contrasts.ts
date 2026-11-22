import { plainSet } from '../contrastBuild';
import type { ContrastSet } from '../contrasts';

/** Polish's Which word fits sets (src/tools/contrasts.ts). Hand-written; a Polish speaker's check is worth more than the tests. */
export const POLISH_CONTRASTS: readonly ContrastSet[] = [
  plainSet('pl-know', [
    { word: 'wiedzieć', rule: 'To know a fact: what, where, when or that. Often followed by że, co or gdzie.' },
    { word: 'znać', rule: 'To know a person, a place, a language or a film: to be familiar with it.' },
  ], [
    ['Nie _, gdzie on mieszka.', 0, "I don't know where he lives.", 'wiem'],
    ['Czy _ moją siostrę?', 1, 'Do you know my sister?', 'znasz'],
    ['Dobrze _ Kraków.', 1, 'I know Kraków well.', 'znam'],
    ['Nie _, co powiedzieć.', 0, "I don't know what to say.", 'wiem'],
    ['Czy _, która jest godzina?', 0, 'Do you know what time it is?', 'wiesz'],
    ['On _ trzy języki.', 1, 'He knows three languages.', 'zna'],
    ['Skąd to _?', 0, 'How do you know that?', 'wiesz'],
    ['_ go od dziecka.', 1, "I've known him since I was a kid.", 'Znam'],
    ['Ona _, że jesteś zmęczony.', 0, "She knows you're tired.", 'wie'],
    ['Nie _ tego filmu.', 1, "I don't know this movie.", 'znam'],
  ]),
  plainSet('pl-hear', [
    { word: 'słuchać', rule: 'To listen, on purpose. Takes the genitive: słuchać muzyki.' },
    { word: 'słyszeć', rule: 'To hear: a sound reaches you, whether you meant to listen or not.' },
  ], [
    ['Lubię _ muzyki w samochodzie.', 0, 'I like listening to music in the car.', 'słuchać'],
    ['Czy _ ten hałas?', 1, 'Do you hear that noise?', 'słyszysz'],
    ['Mów głośniej, nic nie _.', 1, "Speak up, I can't hear anything.", 'słyszę'],
    ['Dzieci, _ mnie uważnie!', 0, 'Kids, listen to me carefully!', 'słuchajcie'],
    ['On nigdy mnie nie _.', 0, 'He never listens to me.', 'słucha'],
    ['_, że się przeprowadzasz.', 1, "I heard you're moving.", 'Słyszałem'],
    ['Wieczorem _ podcastów.', 0, 'In the evening I listen to podcasts.', 'słucham'],
    ['Telefon dzwonił, ale go nie _.', 1, "The phone rang, but I didn't hear it.", 'słyszałam'],
    ['_ radia przy śniadaniu.', 0, 'We listen to the radio at breakfast.', 'Słuchamy'],
    ['Przez ścianę _ sąsiadów.', 1, 'I can hear the neighbors through the wall.', 'słyszę'],
  ]),
  plainSet('pl-because', [
    { word: 'bo', rule: 'Because: the reason comes after it.' },
    { word: 'więc', rule: 'So: the result comes after it.' },
  ], [
    ['Zostaję w domu, _ pada deszcz.', 0, "I'm staying home because it's raining."],
    ['Pada deszcz, _ zostaję w domu.', 1, "It's raining, so I'm staying home."],
    ['Jestem głodny, _ zrobię kanapkę.', 1, "I'm hungry, so I'll make a sandwich."],
    ['Idę spać, _ jestem zmęczona.', 0, "I'm going to bed because I'm tired."],
    ['Nie mam samochodu, _ jeżdżę autobusem.', 1, "I don't have a car, so I take the bus."],
    ['Nie przyszedł, _ był chory.', 0, "He didn't come because he was sick."],
    ['Było zimno, _ włożyłam kurtkę.', 1, 'It was cold, so I put on a jacket.'],
    ['Uczę się polskiego, _ mam rodzinę w Polsce.', 0, "I'm learning Polish because I have family in Poland."],
    ['Sklep był zamknięty, _ wróciliśmy do domu.', 1, 'The store was closed, so we went back home.'],
    ['Spóźniłem się, _ autobus nie przyjechał.', 0, "I was late because the bus didn't come."],
  ]),
];
