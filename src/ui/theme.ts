/** Shared look-and-feel. Gaslamp: soot, brass, lamplight, and a bruise of violet for the occult. */

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;
export const TILE_SIZE = 32;

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
