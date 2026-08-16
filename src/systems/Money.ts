/**
 * Loenese currency, modelled on the Lord of the Mysteries system.
 *
 *   12 pence (d) = 1 soli (s)
 *   20 soli      = 1 pound (£)   → 240 pence to the pound
 *
 * Every amount in the game is stored as an integer number of pence. Nothing
 * anywhere holds a fractional or floating-point money value, so change never
 * evaporates to rounding.
 *
 * Physical form (used for shop and reward flavour):
 *   pounds are paper notes in 1 / 5 / 10 denominations,
 *   soli are coins, pence are the smallest coins.
 */

export const PENCE_PER_SOLI = 12;
export const SOLI_PER_POUND = 20;
export const PENCE_PER_POUND = PENCE_PER_SOLI * SOLI_PER_POUND; // 240

/** Paper note denominations, in pounds, largest first. */
export const NOTE_DENOMINATIONS = [10, 5, 1] as const;

export interface MoneyParts {
  pounds: number;
  soli: number;
  pence: number;
  /** True when the original amount was negative (a debt). */
  negative: boolean;
}

/** Split a pence total into pounds / soli / pence. */
export function split(totalPence: number): MoneyParts {
  const negative = totalPence < 0;
  let rest = Math.abs(Math.trunc(totalPence));
  const pounds = Math.floor(rest / PENCE_PER_POUND);
  rest -= pounds * PENCE_PER_POUND;
  const soli = Math.floor(rest / PENCE_PER_SOLI);
  const pence = rest - soli * PENCE_PER_SOLI;
  return { pounds, soli, pence, negative };
}

/** Build a pence total from parts. */
export function toPence(pounds = 0, soli = 0, pence = 0): number {
  return Math.trunc(pounds) * PENCE_PER_POUND + Math.trunc(soli) * PENCE_PER_SOLI + Math.trunc(pence);
}

/**
 * Full ledger form: "£9 12s 11d".
 * Zero-value units are dropped unless the whole amount is zero.
 */
export function format(totalPence: number): string {
  const { pounds, soli, pence, negative } = split(totalPence);
  const parts: string[] = [];
  if (pounds) parts.push(`£${pounds.toLocaleString('en-GB')}`);
  if (soli) parts.push(`${soli}s`);
  if (pence) parts.push(`${pence}d`);
  if (parts.length === 0) parts.push('0d');
  return (negative ? '−' : '') + parts.join(' ');
}

/**
 * Compact form for tight UI: the single largest unit, e.g. "£9" or "12s".
 * Use `format` anywhere the exact figure matters (prices, rewards, the purse).
 */
export function formatShort(totalPence: number): string {
  const { pounds, soli, pence, negative } = split(totalPence);
  const sign = negative ? '−' : '';
  if (pounds) return `${sign}£${pounds.toLocaleString('en-GB')}`;
  if (soli) return `${sign}${soli}s`;
  return `${sign}${pence}d`;
}

/** Spoken/flavour form: "nine pounds, twelve soli and eleven pence". */
export function formatLong(totalPence: number): string {
  const { pounds, soli, pence, negative } = split(totalPence);
  const parts: string[] = [];
  if (pounds) parts.push(`${pounds.toLocaleString('en-GB')} pound${pounds === 1 ? '' : 's'}`);
  if (soli) parts.push(`${soli} sol${soli === 1 ? 'i' : 'i'}`);
  if (pence) parts.push(`${pence} pence`);
  if (parts.length === 0) return 'nothing at all';
  const last = parts.pop() as string;
  const body = parts.length ? `${parts.join(', ')} and ${last}` : last;
  return (negative ? 'a debt of ' : '') + body;
}

/**
 * How an amount is physically handed over — notes, then coins. Used for shop
 * and reward flavour ("three notes and a handful of coppers").
 */
export function tender(totalPence: number): { notes: number[]; soliCoins: number; penceCoins: number } {
  const { pounds, soli, pence } = split(totalPence);
  const notes: number[] = [];
  let remainingPounds = pounds;
  for (const denom of NOTE_DENOMINATIONS) {
    while (remainingPounds >= denom) {
      notes.push(denom);
      remainingPounds -= denom;
    }
  }
  return { notes, soliCoins: soli, penceCoins: pence };
}

/** Flavour description of the physical money changing hands. */
export function describeTender(totalPence: number): string {
  const { notes, soliCoins, penceCoins } = tender(totalPence);
  const bits: string[] = [];
  if (notes.length) {
    const counts = new Map<number, number>();
    for (const n of notes) counts.set(n, (counts.get(n) ?? 0) + 1);
    const noteText = [...counts.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([denom, count]) => `${count}×£${denom} note${count === 1 ? '' : 's'}`)
      .join(', ');
    bits.push(noteText);
  }
  if (soliCoins) bits.push(`${soliCoins} soli coin${soliCoins === 1 ? '' : 's'}`);
  if (penceCoins) bits.push(`${penceCoins} copper${penceCoins === 1 ? '' : 's'}`);
  return bits.length ? bits.join(' and ') : 'an empty palm';
}

/** Parse "£9 12s 11d", "12s", "144d" or a bare number of pence. */
export function parse(text: string): number {
  const trimmed = text.trim();
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  let total = 0;
  let matched = false;
  const pounds = trimmed.match(/£\s*(\d+)/);
  if (pounds?.[1]) {
    total += Number(pounds[1]) * PENCE_PER_POUND;
    matched = true;
  }
  const soli = trimmed.match(/(\d+)\s*s\b/);
  if (soli?.[1]) {
    total += Number(soli[1]) * PENCE_PER_SOLI;
    matched = true;
  }
  const pence = trimmed.match(/(\d+)\s*d\b/);
  if (pence?.[1]) {
    total += Number(pence[1]);
    matched = true;
  }
  if (!matched) throw new Error(`Unparseable money value: "${text}"`);
  return trimmed.startsWith('-') ? -total : total;
}
