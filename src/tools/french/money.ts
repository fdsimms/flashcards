import { CURRENCIES, type MoneySaying } from '../money';
import { distinct, type Phrase } from '../phrase';
import { frenchNumber } from './numbers';

/*
 * An amount of euros in French: un euro, vingt et un euros, deux cents euros, quatre-vingts
 * euros, mille deux cent soixante-dix-sept euros; with cents, as a price is read out, douze
 * euros cinquante (or douze euros et cinquante centimes). Written as French typography writes a
 * price: 1 277,50 €, with a narrow no-break space between thousands and before the sign.
 */

const say = (text: string, note?: string): Phrase => (note ? { text, note } : { text });
const counted = (n: number, one: string, many: string) => `${frenchNumber(n)} ${n === 1 ? one : many}`;
const NNBSP = ' ';

export function sayFrenchMoney(amount: number): MoneySaying {
  if (!Number.isInteger(amount) || amount <= 0) throw new RangeError(`Not an amount: ${amount}`);
  const { minorPerMajor } = CURRENCIES.EUR;
  const euros = Math.floor(amount / minorPerMajor);
  const cents = amount % minorPerMajor;
  const eurosSaid = counted(euros, 'euro', 'euros');
  const centsSaid = counted(cents, 'centime', 'centimes');
  let everyday: string;
  const also: Phrase[] = [];
  if (!cents) everyday = eurosSaid;
  else if (!euros) everyday = centsSaid;
  else {
    everyday = `${eurosSaid} ${frenchNumber(cents)}`;
    also.push(say(`${eurosSaid} et ${centsSaid}`, 'In full'));
  }
  const thousands = String(euros).replace(/\B(?=(\d{3})+$)/g, NNBSP);
  const written = `${thousands}${cents ? `,${String(cents).padStart(2, '0')}` : ''}${NNBSP}€`;
  return { everyday: say(everyday), also: distinct([say(everyday), ...also]).slice(1), written: say(written) };
}
