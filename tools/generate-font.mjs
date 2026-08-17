#!/usr/bin/env node
// Bakes the game's pixel font into public/assets/ui/font.png.
//
// Two reasons this is a bitmap font rather than a web font. First, the game is
// pixel art and a hinted, anti-aliased system serif fights that at every size.
// Second — and this is the one that matters — a fixed-width bitmap font makes
// text measurable before it is drawn: a string is exactly `length * CELL_W`
// wide at 1x. Every panel in this game is a fixed box, and "does this line fit"
// has to be answerable in advance, not discovered on a phone screen.
//
// Glyphs are 5x7 inside a 6x8 cell (one column and one row of spacing), laid
// out 16 per row in codepoint order, which is what Phaser's RetroFont wants.
//
//   node tools/generate-font.mjs
import fs from 'node:fs';
import path from 'node:path';
import { encodePng } from './png.mjs';

const CELL_W = 6;
const CELL_H = 8;
const PER_ROW = 16;

// Each glyph is seven rows of five bits, MSB leftmost, as hex byte pairs.
// Order here defines the atlas order and must match CHARS in src/ui/pixelFont.ts.
const GLYPHS = {
  ' ': '00000000000000',
  '!': '04040404040004',
  '"': '0A0A0A00000000',
  '#': '0A0A1F0A1F0A0A',
  '$': '040F140E051E04',
  '%': '18190204081303',
  '&': '0C12140815120D',
  "'": '04040800000000',
  '(': '02040808080402',
  ')': '08040202020408',
  '*': '0004150E150400',
  '+': '0004041F040400',
  ',': '000000000C0408',
  '-': '0000001F000000',
  '.': '00000000000C0C',
  '/': '00010204081000',
  '0': '0E11131519110E',
  '1': '040C040404040E',
  '2': '0E11010204081F',
  '3': '1F02040201110E',
  '4': '02060A121F0202',
  '5': '1F101E0101110E',
  '6': '0608101E11110E',
  '7': '1F010204080808',
  '8': '0E11110E11110E',
  '9': '0E11110F01020C',
  ':': '000C0C000C0C00',
  ';': '000C0C000C0408',
  '<': '02040810080402',
  '=': '00001F001F0000',
  '>': '08040201020408',
  '?': '0E110102040004',
  '@': '0E11010D15150E',
  'A': '0E11111F111111',
  'B': '1E11111E11111E',
  'C': '0E11101010110E',
  'D': '1C12111111121C',
  'E': '1F10101E10101F',
  'F': '1F10101E101010',
  'G': '0E11101711110F',
  'H': '1111111F111111',
  'I': '0E04040404040E',
  'J': '0702020202120C',
  'K': '11121418141211',
  'L': '1010101010101F',
  'M': '111B1515111111',
  'N': '11111915131111',
  'O': '0E11111111110E',
  'P': '1E11111E101010',
  'Q': '0E11111115120D',
  'R': '1E11111E141211',
  'S': '0F10100E01011E',
  'T': '1F040404040404',
  'U': '1111111111110E',
  'V': '11111111110A04',
  'W': '1111111515150A',
  'X': '11110A040A1111',
  'Y': '11110A04040404',
  'Z': '1F01020408101F',
  '[': '0E08080808080E',
  '\\': '00100804020100',
  ']': '0E02020202020E',
  '^': '040A1100000000',
  '_': '0000000000001F',
  '`': '08040200000000',
  'a': '00000E010F110F',
  'b': '10101E1111111E',
  'c': '00000E1110110E',
  'd': '01010F1111110F',
  'e': '00000E111F100E',
  'f': '0609081C080808',
  'g': '000F11110F010E',
  'h': '10101E11111111',
  'i': '04000C0404040E',
  'j': '0200060202120C',
  'k': '10101214181412',
  'l': '0C04040404040E',
  'm': '00001A15151515',
  'n': '00001E11111111',
  'o': '00000E1111110E',
  'p': '001E11111E1010',
  'q': '000F11110F0101',
  'r': '00001619101010',
  's': '00000F100E011E',
  't': '08081C08080906',
  'u': '0000111111130D',
  'v': '00001111110A04',
  'w': '0000111515150A',
  'x': '0000110A040A11',
  'y': '001111110F010E',
  'z': '00001F0204081F',
  '{': '02040408040402',
  '|': '04040404040404',
  '}': '08040402040408',
  '~': '00000815020000',
  '£': '0609081C08081F',
  '·': '00000004000000',
  '→': '0004021F020400',
  '✓': '00000102140800',
  '✗': '00110A040A1100',
  '●': '000E1F1F1F0E00',
  '○': '000E1111110E00',
  '▾': '00001F0E040000',
  '×': '0000110A040A11',
  '…': '00000000001500',
};

const chars = Object.keys(GLYPHS);
const columns = PER_ROW;
const rows = Math.ceil(chars.length / PER_ROW);
const width = columns * CELL_W;
const height = rows * CELL_H;
const pixels = new Uint8Array(width * height * 4);

chars.forEach((char, index) => {
  const hex = GLYPHS[char];
  if (hex.length !== 14) throw new Error(`Glyph "${char}" is ${hex.length / 2} rows, expected 7`);
  const originX = (index % PER_ROW) * CELL_W;
  const originY = Math.floor(index / PER_ROW) * CELL_H;

  for (let row = 0; row < 7; row++) {
    const bits = parseInt(hex.slice(row * 2, row * 2 + 2), 16);
    for (let column = 0; column < 5; column++) {
      if (!(bits & (1 << (4 - column)))) continue;
      const offset = ((originY + row) * width + originX + column) * 4;
      // White, so a tint can colour it to anything.
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = 255;
    }
  }
});

const out = path.join(process.cwd(), 'public/assets/ui/font.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng(width, height, pixels));

// The character order is the font's contract with the game; write it out so
// src/ui/pixelFont.ts cannot drift from the atlas.
const manifest = path.join(process.cwd(), 'public/assets/ui/font.json');
fs.writeFileSync(
  manifest,
  `${JSON.stringify({ cellWidth: CELL_W, cellHeight: CELL_H, charsPerRow: PER_ROW, chars: chars.join('') }, null, 2)}\n`,
);

console.log(`font.png  ${width}x${height}  ${chars.length} glyphs`);
