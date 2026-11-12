import { CURRENCIES, type MoneySaying } from '../money';
import { distinct, type Phrase } from '../phrase';
import { spanishCount } from './numbers';

/*
 * An amount of Mexican pesos in Spanish: un peso, veintiún pesos, mil doscientos setenta y siete
 * pesos, and any centavos after con (doce pesos con cincuenta centavos), or read off a price as
 * doce pesos cincuenta. Written as Mexico writes a price: $1,277.50.
 */

const say = (text: string, note?: string): Phrase => (note ? { text, note } : { text });
const counted = (n: number, one: string, many: string) => `${spanishCount(n)} ${n === 1 ? one : many}`;

export function saySpanishMoney(amount: number): MoneySaying {
  if (!Number.isInteger(amount) || amount <= 0) throw new RangeError(`Not an amount: ${amount}`);
  const { minorPerMajor } = CURRENCIES.MXN;
  const pesos = Math.floor(amount / minorPerMajor);
  const centavos = amount % minorPerMajor;
  const pesosSaid = counted(pesos, 'peso', 'pesos');
  const centavosSaid = counted(centavos, 'centavo', 'centavos');
  let everyday: string;
  const also: Phrase[] = [];
  if (!centavos) everyday = pesosSaid;
  else if (!pesos) everyday = centavosSaid;
  else {
    everyday = `${pesosSaid} con ${centavosSaid}`;
    also.push(say(`${pesosSaid} ${spanishCount(centavos)}`, 'As a price is read out'));
  }
  const written = `$${pesos.toLocaleString('en-US')}${centavos ? `.${String(centavos).padStart(2, '0')}` : ''}`;
  return { everyday: say(everyday), also: distinct([say(everyday), ...also]).slice(1), written: say(written) };
}
