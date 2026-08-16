#!/usr/bin/env node
// Repacks Kenney's Roguelike/RPG pack (CC0) into this project's tileset layout.
//
//   npm run tiles
//
// The game reads tiles by index out of a 32px, 8-per-row sheet. Kenney's sheet
// is 16px with a 1px margin and no relationship to our ordering, so this maps
// each of our slots to a source tile, scales it 2x (nearest neighbour, which is
// lossless for pixel art), optionally layers and tints it, and writes
// public/assets/tiles/tileset.png.
//
// Nothing downstream changes: map JSON still refers to slot 8 for "brick wall".
// To restyle the world, edit SLOTS here — not the maps, not the code.
//
// Source: kenney.nl/assets/roguelike-rpg-pack — Creative Commons Zero (CC0).
// The sheet is vendored at art-src/kenney_roguelike-rpg-pack/ so this is
// reproducible offline; see CREDITS.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Raster, readPng, rgba, shade } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(
  ROOT,
  'art-src',
  'kenney_roguelike-rpg-pack',
  'roguelikeSheet_transparent.png',
);
const OUT = path.join(ROOT, 'public', 'assets', 'tiles', 'tileset.png');

const SRC_TILE = 16;
const SRC_MARGIN = 1;
const TILE = 32;
const SCALE = TILE / SRC_TILE;
const COLUMNS = 8;

/**
 * Our 32 tile slots, in the order the game indexes them.
 *
 * - `from`: [column, row] in Kenney's sheet.
 * - `under`: an optional tile drawn beneath (for props that need a floor, and
 *   for wall faces that need an opaque backing).
 * - `over`: an optional tile drawn on top.
 * - `tint`: [hex, alpha] wash applied after composition — how the same grey
 *   stone becomes a dank cellar and a gaslit street.
 * - `shade`: brighten (>0) or darken (<0) toward white/black.
 * - `opaque`: fill transparent pixels with this colour first.
 *
 * Anything with no `from` is drawn procedurally by `draw`.
 */
const SLOTS = [
  // 0 void
  { name: 'void', opaque: '#0d0b09' },
  // 1 cobblestone street
  { name: 'cobblestone', from: [6, 3], shade: -0.08 },
  // 2 wet cobblestone
  { name: 'wet cobblestone', from: [6, 3], tint: ['#2c4a5e', 0.42], shade: -0.12 },
  // 3 wood floor
  { name: 'wood floor', from: [8, 3] },
  // 4 dark parquet (the Club)
  { name: 'parquet', from: [9, 5], shade: -0.14 },
  // 5 crimson rug
  { name: 'crimson rug', from: [11, 14], tint: ['#7a1c2c', 0.72] },
  // 6 tarot circle — Kenney's carpet, bruised violet, with a rune laid over it
  { name: 'tarot rug', from: [11, 17], tint: ['#3a2a6a', 0.72], shade: -0.05 },
  // 7 flagstone (cellar)
  { name: 'flagstone', from: [6, 2], tint: ['#4a463c', 0.42], shade: -0.12 },
  // 8 brick wall
  { name: 'brick wall', from: [5, 2], tint: ['#241a20', 0.3], shade: -0.34 },
  // 9 stone wall (cellar)
  { name: 'stone wall', from: [21, 15], tint: ['#2a2f38', 0.45], shade: -0.2 },
  // 10 wall cap — the dark band that reads as "solid, not floor"
  { name: 'wall cap', from: [21, 15], shade: -0.62 },
  // 11 wainscot panelling (the Club)
  { name: 'wainscot', from: [16, 16], tint: ['#4a3218', 0.62], shade: -0.16 },
  // 12 sash window
  { name: 'window', from: [40, 4], under: [5, 2], underShade: -0.34 },
  // 13 closed door
  { name: 'door', from: [31, 5], under: [5, 2], underShade: -0.34 },
  // 14 open doorway
  { name: 'doorway', from: [36, 1], opaque: '#0d0b09' },
  // 15 iron railing
  { name: 'railing', from: [38, 8], tint: ['#20222a', 0.55] },
  // --- props: transparent background, drawn above the floor by the game ---
  // 16 table
  { name: 'table', from: [19, 6] },
  // 17 chair
  { name: 'chair', from: [19, 2] },
  // 18 bookshelf
  { name: 'bookshelf', from: [44, 14] },
  // 19 crate
  { name: 'crate', from: [22, 0] },
  // 20 barrel
  { name: 'barrel', from: [26, 0] },
  // 21 shop counter
  { name: 'counter', from: [28, 0] },
  // 22 fireplace
  { name: 'fireplace', from: [14, 0] },
  // 23 bed
  { name: 'bed', from: [14, 2] },
  // 24 gas lamp
  { name: 'gas lamp', from: [17, 7] },
  // 25 writing desk — a table with a ledger open on it
  { name: 'desk', from: [19, 6], over: [44, 15] },
  // 26 display cabinet
  { name: 'cabinet', from: [26, 5] },
  // 27 memorial stone
  { name: 'gravestone', from: [51, 11] },
  // 28 canal water
  { name: 'water', from: [0, 1], tint: ['#16333f', 0.45] },
  // 29 bare earth
  { name: 'mud', from: [6, 0], shade: -0.12 },
  // 30 grass verge
  { name: 'grass', from: [5, 0], shade: -0.2 },
  // 31 longcase clock
  { name: 'clock', from: [26, 8] },
  // 32 the sigil at the centre of the Circle — one tile, not a repeat
  { name: 'tarot sigil', from: [11, 17], tint: ['#3a2a6a', 0.72], over: [50, 9], shade: -0.05 },
];

const source = readPng(SOURCE);

/** Copy one 16x16 Kenney tile into a 32x32 raster, scaled 2x. */
function stamp(target, [column, row], options = {}) {
  const sx = column * (SRC_TILE + SRC_MARGIN);
  const sy = row * (SRC_TILE + SRC_MARGIN);
  for (let y = 0; y < SRC_TILE; y++) {
    for (let x = 0; x < SRC_TILE; x++) {
      const i = ((sy + y) * source.width + (sx + x)) * 4;
      let color = [source.data[i], source.data[i + 1], source.data[i + 2], source.data[i + 3]];
      if (color[3] === 0) continue;
      if (options.shade) color = shade(color, options.shade);
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          target.px(x * SCALE + dx, y * SCALE + dy, color);
        }
      }
    }
  }
}

function buildSlot(slot) {
  const tile = new Raster(TILE, TILE);

  if (slot.opaque) tile.rect(0, 0, TILE, TILE, rgba(slot.opaque));
  if (slot.under) stamp(tile, slot.under, { shade: slot.underShade });
  if (slot.from) stamp(tile, slot.from, { shade: slot.shade });
  if (slot.over) stamp(tile, slot.over);

  // Tint only where something was actually drawn, so props keep clean edges.
  if (slot.tint) {
    const [hex, alpha] = slot.tint;
    const wash = rgba(hex, alpha);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (tile.get(x, y)[3] === 0) continue;
        tile.px(x, y, wash);
      }
    }
  }

  return tile;
}

const rows = Math.ceil(SLOTS.length / COLUMNS);
const sheet = new Raster(COLUMNS * TILE, rows * TILE);

SLOTS.forEach((slot, index) => {
  const tile = buildSlot(slot);
  sheet.blit(tile, (index % COLUMNS) * TILE, Math.floor(index / COLUMNS) * TILE);
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, sheet.toPng());

console.log(`Repacked ${SLOTS.length} tiles from Kenney's Roguelike/RPG pack (CC0)`);
console.log(`  ${path.relative(ROOT, OUT)}  ${sheet.width}x${sheet.height}  ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
SLOTS.forEach((slot, index) => {
  const origin = slot.from ? `kenney ${slot.from[0]},${slot.from[1]}` : 'procedural';
  console.log(`  ${String(index).padStart(2)}  ${slot.name.padEnd(18)} ${origin}`);
});
