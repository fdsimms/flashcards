import { distinct, type Phrase } from '../phrase';
import type { ClockTime, TimeSaying } from '../time';
import { spanishNumber } from './numbers';

/**
 * A time of day in Spanish, as Mexico says it (the decks' Spanish is es-MX). On the 12-hour clock
 * with the article: la una, las dos. y cuarto, y media, else y and the minutes, up to :39; from :40
 * the minutes left para the next hour (cuarto para las tres, diez para las tres), with y cuarenta
 * as another way to say it, para already heard from :35, and Spain's menos (las tres menos cuarto)
 * noted as Spain's. The part of the day (de la madrugada, de la mañana, del día at noon, de la
 * tarde, de la noche) is added when it isn't clear. The formal 24-hour form reads the digits: las
 * catorce treinta, las catorce horas, las veintiuna horas (horas is feminine).
 */

const SPAIN = 'In Spain';

/** The hour 0 to 23 on the 12-hour clock, with its article: la una, las doce. */
function hourName(h: number): string {
  const h12 = ((h + 11) % 12) + 1;
  return h12 === 1 ? 'la una' : `las ${spanishNumber(h12)}`;
}

/** The part of the day `h` falls in. */
function partOfDay(h: number): string {
  if (h === 0) return 'de la noche';
  if (h <= 5) return 'de la madrugada';
  if (h <= 11) return 'de la mañana';
  if (h === 12) return 'del día';
  if (h <= 19) return 'de la tarde';
  return 'de la noche';
}

const say = (text: string, note?: string): Phrase => (note ? { text, note } : { text });

export function saySpanishTime(t: ClockTime): TimeSaying {
  const { hour: h, minute: m } = t;
  if (!(Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59)) throw new RangeError(`Not a time of day: ${h}:${m}`);
  const hour = hourName(h);
  const next = hourName((h + 1) % 24);
  const part = partOfDay(h);
  const past = () => m === 15 ? 'y cuarto' : m === 30 ? 'y media' : `y ${spanishNumber(m)}`;
  /** The minutes left to the next hour: cuarto, diez, un minuto. */
  const left = () => (m === 45 ? 'cuarto' : m === 59 ? 'un minuto' : spanishNumber(60 - m));
  const toNext = () => `menos ${left()}`;
  const forNext = () => `${left()} para ${next}`;

  let everyday: string;
  const also: Phrase[] = [];
  if (m === 0) {
    everyday = hour;
    also.push(say(`${hour} ${part}`), say(`${hour} en punto`));
    if (h === 12) also.push(say('mediodía'));
    if (h === 0) also.push(say('medianoche'));
  } else if (m < 40) {
    everyday = `${hour} ${past()}`;
    also.push(say(`${everyday} ${part}`));
    if (m >= 35) also.push(say(forNext()), say(`${next} ${toNext()}`, SPAIN));
  } else {
    everyday = forNext();
    also.push(say(`${everyday} ${part}`), say(`${hour} ${past()}`), say(`${next} ${toNext()}`, SPAIN));
  }

  const formalHour = h === 1 ? 'la una' : `las ${spanishNumber(h, true)}`;
  const formal = m === 0
    ? (h === 1 ? formalHour : `${formalHour} horas`)
    : `${formalHour} ${m < 10 ? 'cero ' : ''}${spanishNumber(m)}`;
  return { everyday: say(everyday), also: distinct([say(everyday), ...also]).slice(1), formal: say(formal) };
}
