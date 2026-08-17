/** Shared look-and-feel. Gaslamp: soot, brass, lamplight, and a bruise of violet for the occult. */

/**
 * The logical canvas size. Not a constant: it is chosen at boot from the
 * viewport's aspect and re-chosen when the device rotates, so a phone held
 * upright gets a tall board rather than a 219px letterboxed strip.
 *
 * These are live ES module bindings — importers see updates. Anything that
 * reads them must do so inside `create()`, never in a class field initializer,
 * because scene instances outlive a rotation.
 */
export let GAME_WIDTH = 960;
export let GAME_HEIGHT = 540;
export const TILE_SIZE = 32;

/**
 * Logical sizes per orientation.
 *
 * The portrait board is 1:2 rather than a rotated 16:9 because phones are
 * narrow: a 2:3 board on an iPhone 13 (390x844) fits by width and letterboxes
 * away a third of the screen, and everything it does draw is scaled down to
 * 0.68 — which turns a 44px button into a 30pt one, under Apple's 44pt
 * minimum. 1:2 lands within a few percent of every iPhone's aspect, so the
 * board very nearly fills the screen and a logical pixel is very nearly a
 * point.
 */
export const LANDSCAPE = { width: 960, height: 540 } as const;
export const PORTRAIT = { width: 432, height: 864 } as const;

/** Pick the logical size that matches a viewport, and publish it. */
export function setLayoutFor(viewportWidth: number, viewportHeight: number): {
  width: number;
  height: number;
} {
  const size = viewportHeight > viewportWidth ? PORTRAIT : LANDSCAPE;
  GAME_WIDTH = size.width;
  GAME_HEIGHT = size.height;
  return size;
}

export function isPortrait(): boolean {
  return GAME_HEIGHT > GAME_WIDTH;
}

/**
 * Panel inset from the screen edge. Portrait has far less width to spare, so
 * modal panels hug the edges rather than floating in the middle.
 */
export function panelInset(): number {
  return isPortrait() ? 12 : 110;
}

/** Height of the status strip. Portrait stacks it into two rows. */
export function hudHeight(): number {
  return isPortrait() ? 80 : 48;
}

/**
 * Height of the bottom button bar. Portrait only: a phone held one-handed puts
 * the top of the screen out of a thumb's reach, so the two always-on buttons
 * live down here instead of in the status strip. In landscape they fit in the
 * strip and there is no footer.
 */
export function hudFooterHeight(): number {
  return isPortrait() ? 68 : 0;
}

/**
 * Minimum comfortable tap target. Apple's guideline is 44pt, and the portrait
 * board is sized so a logical pixel is close to a point — but it still scales
 * down a little on shorter phones, so leave headroom above 44.
 */
export function minTapHeight(): number {
  return isPortrait() ? 52 : 38;
}

export const COLORS = {
  ink: 0x14100d,
  soot: 0x1e1813,
  panel: 0x241d18,
  panelLight: 0x33291f,
  brass: 0xc9a227,
  brassDim: 0x7a6420,
  parchment: 0xe8dcc8,
  muted: 0x9a8d7a,
  good: 0x7fae6a,
  bad: 0xb04a58,
  occult: 0x9d86c9,
  info: 0x7fb2c8,
  lamp: 0xf6d06a,
  blood: 0x8a3340,
} as const;

/** Same palette as CSS strings, for text styles. */
export const CSS = {
  ink: '#14100d',
  panel: '#241d18',
  brass: '#c9a227',
  parchment: '#e8dcc8',
  muted: '#9a8d7a',
  good: '#7fae6a',
  bad: '#b04a58',
  occult: '#9d86c9',
  info: '#7fb2c8',
  lamp: '#f6d06a',
} as const;

export const FONT_BODY = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
export const FONT_UI = '"Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif';
export const FONT_MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** Indices into public/assets/ui/icons.png — must match ICON_DRAWERS order. */
export const ICONS = {
  pence: 0,
  soli: 1,
  pound: 2,
  spirituality: 3,
  sanity: 4,
  concealment: 5,
  clue: 6,
  card: 7,
  potion: 8,
  key: 9,
  candle: 10,
  document: 11,
  danger: 12,
  sequence: 13,
  trust: 14,
  lock: 15,
} as const;

export const TEXT = {
  title: { fontFamily: FONT_BODY, fontSize: '38px', color: CSS.brass },
  heading: { fontFamily: FONT_BODY, fontSize: '22px', color: CSS.parchment },
  body: { fontFamily: FONT_BODY, fontSize: '16px', color: CSS.parchment },
  small: { fontFamily: FONT_UI, fontSize: '12px', color: CSS.muted },
  label: { fontFamily: FONT_UI, fontSize: '13px', color: CSS.parchment },
  mono: { fontFamily: FONT_MONO, fontSize: '13px', color: CSS.parchment },
} as const;

/** Meter colours keyed by the stat they show. */
export const METER_COLORS = {
  sanity: COLORS.bad,
  spirituality: COLORS.info,
  concealment: COLORS.occult,
  digestion: COLORS.brass,
} as const;
