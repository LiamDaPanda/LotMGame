/**
 * The game's pixel font.
 *
 * A fixed-width bitmap font, not a web font, for two reasons. It matches the
 * tile art — an anti-aliased system serif fights pixel art at every size — and,
 * more usefully, it is *measurable*. Every glyph is exactly `CELL_WIDTH * scale`
 * wide, so "will this line fit in this box" is arithmetic done before anything
 * is drawn, rather than something discovered on a phone screen.
 *
 * Wrapping is done here rather than by Phaser's `setMaxWidth` so that the
 * wrapped height is known too: a panel that has to hold its text needs to ask
 * how tall the text will be before it commits to a layout.
 */

import Phaser from 'phaser';

export const FONT_KEY = 'pixel';
export const CELL_WIDTH = 6;
export const CELL_HEIGHT = 8;

/**
 * Text is never drawn below 2x.
 *
 * The board is scaled down to fit a phone (about 0.81 on an iPhone 13), and a
 * 1x glyph has one-pixel strokes — at that ratio whole rows of a letter drop
 * out. At 2x the strokes are two board pixels and survive the downscale, so 2x
 * is the floor and every step above it is a whole number.
 */
export const SCALES = { sm: 2, md: 2, lg: 3, xl: 4 } as const;
export type TextSize = keyof typeof SCALES;

/**
 * Extra space between wrapped lines, in font pixels — Phaser multiplies it by
 * the render scale along with everything else.
 */
const LINE_GAP = 2;

/**
 * Phaser sizes a RetroFont by its cell *width* (`ParseRetroFont` sets
 * `data.size = w`), so a BitmapText renders at `fontSize / CELL_WIDTH`. Asking
 * for a scale therefore means asking for a fontSize of `CELL_WIDTH * scale` —
 * using the height here silently stretches every glyph by 8/6.
 */
function fontSizeFor(scale: number): number {
  return CELL_WIDTH * scale;
}

/** Baseline-to-baseline distance at a given scale. */
export function lineHeight(scale: number): number {
  return (CELL_HEIGHT + LINE_GAP) * scale;
}

interface FontManifest {
  cellWidth: number;
  cellHeight: number;
  charsPerRow: number;
  chars: string;
}

/**
 * Glyphs the atlas does not carry, mapped to ones it does. Prose in the data
 * files uses proper typography; the font would rather not carry four kinds of
 * dash, so they are folded on the way in.
 */
const TRANSLITERATE: Record<string, string> = {
  '—': '-',
  '–': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  ' ': ' ',
  '\t': '  ',
};

let charset = '';

/** Register the font with a scene's cache. Called once, from Preload. */
export function registerPixelFont(scene: Phaser.Scene, manifest: FontManifest): void {
  charset = manifest.chars;
  const data = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: 'font',
    width: manifest.cellWidth,
    height: manifest.cellHeight,
    chars: manifest.chars,
    charsPerRow: manifest.charsPerRow,
    // Phaser's config uses dotted keys for these, not nested objects.
    'offset.x': 0,
    'offset.y': 0,
    'spacing.x': 0,
    'spacing.y': 0,
    lineSpacing: LINE_GAP,
  });
  scene.cache.bitmapFont.add(FONT_KEY, data);
}

/** Fold text to glyphs the atlas actually has. */
export function sanitize(text: string): string {
  let out = '';
  for (const char of text) {
    if (char === '\n') {
      out += char;
      continue;
    }
    const mapped = TRANSLITERATE[char] ?? char;
    for (const piece of mapped) {
      out += charset.includes(piece) ? piece : '?';
    }
  }
  return out;
}

/** Width in board pixels of a single line at the given scale. */
export function textWidth(line: string, scale: number): number {
  return line.length * CELL_WIDTH * scale;
}

/** How many characters fit across a box at the given scale. */
export function charsAcross(width: number, scale: number): number {
  return Math.max(1, Math.floor(width / (CELL_WIDTH * scale)));
}

/**
 * Hard-wrap text to a pixel width, breaking on spaces and splitting any single
 * word too long to fit. Returns the wrapped lines.
 */
export function wrapLines(text: string, width: number, scale: number): string[] {
  const limit = charsAcross(width, scale);
  const lines: string[] = [];

  for (const paragraph of sanitize(text).split('\n')) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(' ')) {
      // A word longer than the box gets cut rather than pushing past the edge.
      let remaining = word;
      while (remaining.length > limit) {
        if (line.length > 0) {
          lines.push(line);
          line = '';
        }
        lines.push(remaining.slice(0, limit));
        remaining = remaining.slice(limit);
      }
      if (line.length === 0) line = remaining;
      else if (line.length + 1 + remaining.length <= limit) line += ` ${remaining}`;
      else {
        lines.push(line);
        line = remaining;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Height in board pixels of text once wrapped to a width. */
export function textHeight(text: string, width: number, scale: number): number {
  return wrapLines(text, width, scale).length * lineHeight(scale);
}

/**
 * The largest of the standard scales at which `text` fits inside `width` x
 * `height`, or the smallest scale if none do. Used by anything that must not
 * overflow its box — which, in a game made of fixed panels, is everything.
 */
export function fitScale(
  text: string,
  width: number,
  height: number,
  from: TextSize = 'lg',
): number {
  const ladder = [SCALES.xl, SCALES.lg, SCALES.md].filter((scale) => scale <= SCALES[from]);
  for (const scale of ladder) {
    if (textHeight(text, width, scale) <= height) return scale;
  }
  return SCALES.md;
}

export interface PixelTextOptions {
  /** Named size, or a raw integer scale. */
  size?: TextSize | number;
  color?: number | string;
  /** Wrap width in board pixels. Omit to leave the text on one line. */
  wrap?: number;
  align?: 'left' | 'center' | 'right';
  /**
   * Shrink a step at a time until the text fits this height. Requires `wrap`.
   * The point of the fixed-width font: this is decided before drawing.
   */
  maxHeight?: number;

  // --- Phaser Text style fields, accepted so call sites did not all have to
  // --- change shape when the game moved to a bitmap font. ---
  /** Ignored: there is one font. Kept so old style objects still compile. */
  fontFamily?: string;
  /** '15px' or 15. Collapsed onto the nearest usable pixel scale. */
  fontSize?: string | number;
  wordWrap?: { width?: number };
  /** Ignored: line spacing is baked into the font. */
  lineSpacing?: number;
}

/**
 * Point sizes collapse onto three pixel scales. A bitmap font has no
 * in-between: it can be doubled or tripled, not set to 15px. The old sizes
 * survive as a coarse ranking — label, heading, title.
 */
function scaleFor(options: PixelTextOptions): number {
  if (typeof options.size === 'number') return options.size;
  if (options.size) return SCALES[options.size];
  const raw = options.fontSize;
  const px = typeof raw === 'string' ? parseInt(raw, 10) : raw;
  if (px === undefined || Number.isNaN(px)) return SCALES.md;
  if (px <= 20) return SCALES.md;
  if (px <= 30) return SCALES.lg;
  return SCALES.xl;
}

/**
 * A line (or block) of pixel text.
 *
 * Wraps BitmapText with the parts of the old Text API this codebase used, so
 * that switching fonts did not mean rewriting every call site's colour and
 * wrapping logic.
 */
export class PixelText extends Phaser.GameObjects.BitmapText {
  private wrapWidth?: number;
  private scaleStep: number;
  private maxHeight?: number;
  private raw = '';

  constructor(scene: Phaser.Scene, x: number, y: number, content: string, options: PixelTextOptions = {}) {
    const scaleStep = scaleFor(options);
    super(scene, x, y, FONT_KEY, '', fontSizeFor(scaleStep));
    this.scaleStep = scaleStep;
    this.wrapWidth = options.wrap ?? options.wordWrap?.width;
    this.maxHeight = options.maxHeight;
    if (options.align === 'center') this.setCenterAlign();
    else if (options.align === 'right') this.setRightAlign();
    this.setColor(options.color ?? 0xe8dcc8);
    this.setText(content);
    scene.add.existing(this);
  }

  override setText(value: string | string[]): this {
    this.raw = Array.isArray(value) ? value.join('\n') : (value ?? '');
    this.reflow();
    return this;
  }

  /** Re-wrap and, if a height budget was given, shrink until it fits. */
  private reflow(): void {
    if (this.wrapWidth === undefined) {
      super.setText(sanitize(this.raw));
      return;
    }
    let scale = this.scaleStep;
    if (this.maxHeight !== undefined) {
      while (scale > SCALES.md && textHeight(this.raw, this.wrapWidth, scale) > this.maxHeight) {
        scale -= 1;
      }
    }
    if (this.fontSize !== fontSizeFor(scale)) this.setFontSize(fontSizeFor(scale));
    super.setText(wrapLines(this.raw, this.wrapWidth, scale).join('\n'));
  }

  /** Accepts a CSS hex string or a number, matching the old Text API. */
  setColor(color: number | string): this {
    const value = typeof color === 'string' ? Phaser.Display.Color.HexStringToColor(color).color : color;
    this.setTint(value);
    return this;
  }

  /** Text had a drop shadow; a bitmap font does not need one. Accepted and
   * ignored so call sites keep compiling. */
  setShadow(..._args: unknown[]): this {
    return this;
  }

  /** Re-wrap to a new width, matching the old Text API. */
  setWordWrapWidth(width: number): this {
    this.wrapWidth = width;
    this.reflow();
    return this;
  }

  /** The text as it was set, before wrapping. */
  get content(): string {
    return this.raw;
  }
}

/** Factory mirroring `scene.add.text` for the pixel font. */
export function pixelText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  content: string,
  options: PixelTextOptions = {},
): PixelText {
  return new PixelText(scene, x, y, content, options);
}
