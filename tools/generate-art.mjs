#!/usr/bin/env node
// Generates every placeholder image the game loads: chibi character
// spritesheets, dialogue portraits, a 32px tileset, a UI icon sheet and the
// PWA app icons. Deterministic — rerunning it produces byte-identical files.
//
//   npm run art
//
// Style target: chibi/anime — head roughly half the body height, oversized
// eyes with a highlight, flat colours with one shade of rim light. Swap any
// output for hand-drawn or AI-generated art of the same dimensions and the
// game needs no code changes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Raster, rgba, shade, noise } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'assets');

const FRAME_W = 32;
const FRAME_H = 40;
const DIRS = ['down', 'left', 'right', 'up'];
const STEPS = 3;
const TILE = 32;

const INK = rgba('#1b1410');
const WHITE = rgba('#fdf6e8');

// ---------------------------------------------------------------------------
// Cast palettes. Order here defines the frame/portrait index used by the game
// (see src/data/characters.json), so append rather than reorder.
// ---------------------------------------------------------------------------
const CAST = [
  // The player: a young investigator in a long charcoal greatcoat.
  { id: 'player', skin: '#f2c9a8', hair: '#3a2b22', coat: '#3d4451', accent: '#7fb2c8', trouser: '#2c3038', hat: null, scarf: '#8c3b40' },
  // Tarot Club members.
  { id: 'hermit', skin: '#e8bb95', hair: '#c9c3b6', coat: '#4a3d5c', accent: '#c9a227', trouser: '#3a3040', hat: 'top', scarf: null },
  { id: 'star', skin: '#c98f63', hair: '#241b18', coat: '#7a4a2c', accent: '#e0b060', trouser: '#4a3020', hat: null, scarf: '#d9c27a' },
  { id: 'tower', skin: '#dda87c', hair: '#5a3320', coat: '#2f4636', accent: '#9fbf8a', trouser: '#28352a', hat: 'cap', scarf: null },
  { id: 'moon', skin: '#f4d4bb', hair: '#6b3f6e', coat: '#2b2f4a', accent: '#b39ddb', trouser: '#23263a', hat: null, scarf: '#4a4f7a' },
  // Case cast.
  { id: 'constable', skin: '#e3b48d', hair: '#2b2622', coat: '#1f2b44', accent: '#c0c6d0', trouser: '#1a2236', hat: 'custodian', scarf: null },
  { id: 'widow', skin: '#f0cdb0', hair: '#1e1a18', coat: '#22201f', accent: '#6e6a66', trouser: '#1a1817', hat: 'veil', scarf: null },
  { id: 'apprentice', skin: '#eec39c', hair: '#8a5a2b', coat: '#6b6250', accent: '#a89a76', trouser: '#4a453a', hat: 'flat', scarf: null },
  { id: 'landlady', skin: '#e9bd97', hair: '#7a6a58', coat: '#6a3350', accent: '#d6a0b8', trouser: '#4a2438', hat: null, scarf: '#e2d2c0' },
  { id: 'rival', skin: '#d9a67e', hair: '#141210', coat: '#2a1f2c', accent: '#a03a4a', trouser: '#1e1620', hat: 'top', scarf: '#5c1f28' },
  { id: 'pawnbroker', skin: '#dfb894', hair: '#4a4238', coat: '#4a3b2a', accent: '#b09060', trouser: '#3a2f22', hat: null, scarf: null },
  { id: 'dockhand', skin: '#c08a5e', hair: '#2a2018', coat: '#40514f', accent: '#8aa8a2', trouser: '#2c3a38', hat: 'cap', scarf: null },
  // Family. Appended, not inserted: the index is the frame number.
  { id: 'benson', skin: '#f0c5a2', hair: '#33251d', coat: '#4a4034', accent: '#b9a37c', trouser: '#332c24', hat: 'flat', scarf: null },
];

// ---------------------------------------------------------------------------
// Chibi character rendering
// ---------------------------------------------------------------------------

function drawHat(r, ox, oy, kind, pal, dir, bob) {
  const accent = rgba(pal.accent);
  const dark = rgba('#20191a');
  const y = oy + 3 + bob;
  switch (kind) {
    case 'top':
      r.rect(ox + 4, y + 4, 24, 2, dark); // brim
      r.roundRect(ox + 9, y - 4, 14, 9, 2, dark);
      r.rect(ox + 9, y + 2, 14, 2, accent); // band
      break;
    case 'cap':
      r.roundRect(ox + 6, y - 1, 20, 7, 3, dark);
      if (dir !== 3) r.rect(ox + 5, y + 5, 22, 2, shade(dark, -0.2)); // peak
      break;
    case 'custodian': // constable's helmet
      r.roundRect(ox + 7, y - 5, 18, 12, 5, rgba('#20242e'));
      r.rect(ox + 5, y + 5, 22, 2, rgba('#20242e'));
      r.ellipse(ox + 16, y - 4, 2, 2, accent);
      break;
    case 'flat':
      r.roundRect(ox + 6, y + 1, 20, 5, 2, dark);
      r.rect(ox + 5, y + 5, 10, 2, shade(dark, 0.1));
      break;
    case 'veil':
      r.roundRect(ox + 6, y - 1, 20, 8, 4, dark);
      for (let i = 0; i < 20; i++) {
        for (let j = 0; j < 10; j++) {
          if ((i + j) % 2 === 0) r.px(ox + 6 + i, y + 6 + j, rgba('#000000', 0.28));
        }
      }
      break;
    default:
      break;
  }
}

function drawEye(r, cx, cy, pal, squint) {
  const iris = rgba(pal.accent);
  if (squint) {
    r.rect(cx - 2, cy, 4, 1, INK);
    return;
  }
  r.ellipse(cx, cy, 2.2, 2.9, INK); // lash-line / sclera outline
  r.ellipse(cx, cy + 0.4, 1.5, 2.1, shade(iris, -0.35));
  r.ellipse(cx, cy + 0.9, 1.2, 1.3, iris);
  r.px(cx - 1, cy - 1, WHITE); // highlight
  r.px(cx, cy - 2, rgba('#ffffff', 0.55));
}

/**
 * Draw one 32x40 chibi frame at (ox, oy).
 * dir: 0 down, 1 left, 2 right, 3 up. step: 0 idle, 1/2 walk contact poses.
 */
function drawChibi(r, ox, oy, dir, step, pal) {
  const skin = rgba(pal.skin);
  const skinShade = shade(skin, -0.18);
  const hair = rgba(pal.hair);
  const hairLit = shade(hair, 0.22);
  const coat = rgba(pal.coat);
  const coatDark = shade(coat, -0.25);
  const coatLit = shade(coat, 0.16);
  const trouser = rgba(pal.trouser);
  const boot = rgba('#241c18');

  const bob = step === 0 ? 0 : -1; // lift the whole body on stride frames
  const legA = step === 1 ? 1 : step === 2 ? -1 : 0;
  const legB = -legA;

  // Ground shadow (never bobs).
  r.ellipse(ox + 16, oy + 37, 8, 2.4, rgba('#000000', 0.3));

  const bodyTop = oy + 23 + bob;
  const narrow = dir === 1 || dir === 2;
  const bx = narrow ? ox + 11 : ox + 10;
  const bw = narrow ? 10 : 12;

  // Legs.
  const legY = oy + 31 + bob;
  r.rect(ox + 12, legY + Math.max(0, legA), 3, 6 - Math.max(0, legA), trouser);
  r.rect(ox + 17, legY + Math.max(0, legB), 3, 6 - Math.max(0, legB), trouser);
  r.rect(ox + 12, oy + 36, 3, 2, boot);
  r.rect(ox + 17, oy + 36, 3, 2, boot);

  // Coat.
  r.roundRect(bx, bodyTop, bw, 11, 3, coat);
  r.rect(bx, bodyTop + 8, bw, 3, coatDark); // hem shadow
  if (dir === 0) {
    r.rect(ox + 15, bodyTop + 1, 2, 10, coatDark); // centre seam
    r.rect(ox + 12, bodyTop, 3, 3, coatLit); // lapels
    r.rect(ox + 17, bodyTop, 3, 3, coatLit);
    if (pal.scarf) r.rect(ox + 12, bodyTop - 1, 8, 2, rgba(pal.scarf));
  } else if (dir === 3) {
    r.rect(bx + 1, bodyTop + 1, bw - 2, 2, coatLit); // yoke
  } else {
    r.rect(dir === 1 ? bx : bx + bw - 3, bodyTop + 1, 3, 9, coatDark);
    if (pal.scarf) r.rect(bx, bodyTop - 1, bw, 2, rgba(pal.scarf));
  }

  // Arms — swing opposite the legs.
  const armSwing = step === 0 ? 0 : legA;
  if (narrow) {
    r.rect(dir === 1 ? bx - 1 : bx + bw - 1, bodyTop + 2 + armSwing, 2, 7, coatLit);
    r.rect(dir === 1 ? bx - 1 : bx + bw - 1, bodyTop + 9 + armSwing, 2, 2, skin);
  } else {
    r.rect(ox + 8, bodyTop + 2 - armSwing, 2, 7, coat);
    r.rect(ox + 22, bodyTop + 2 + armSwing, 2, 7, coat);
    r.rect(ox + 8, bodyTop + 9 - armSwing, 2, 2, skin);
    r.rect(ox + 22, bodyTop + 9 + armSwing, 2, 2, skin);
  }

  // Neck.
  r.rect(ox + 14, oy + 20 + bob, 4, 4, skinShade);

  // Head — deliberately oversized for the chibi read. On side views the whole
  // head shifts toward the facing direction and the fringe sweeps back, so the
  // visible eye is not buried under hair.
  const lean = dir === 1 ? -1 : dir === 2 ? 1 : 0;
  const hx = ox + 16 + lean;
  const hy = oy + 13 + bob;
  const hrx = narrow ? 9 : 10;
  r.ellipse(hx, hy, hrx, 9.5, skin);
  r.ellipse(hx, hy + 4, hrx - 1, 5, skin);

  if (dir === 3) {
    // Back of the head: hair covers the full skull, no skin showing at the jaw.
    r.ellipse(hx, hy + 1, hrx, 9.5, hair);
    r.ellipse(hx, hy + 4, hrx - 1, 5, hair);
    r.ellipse(hx, hy - 4, hrx - 2, 4, hairLit);
  } else {
    // Hair cap sits high enough to leave the eye line clear.
    r.ellipse(hx, hy - 4, hrx, 6.5, hair);
    r.rect(hx - hrx, hy - 4, 2, 8, hair); // side locks
    r.rect(hx + hrx - 2, hy - 4, 2, 8, hair);
    r.ellipse(hx - 3, hy - 6, 4, 2.5, hairLit); // highlight

    // Fringe teeth so the hairline is not a flat arc. On side views they sweep
    // toward the back of the head instead of covering the face.
    const fringeFrom = dir === 1 ? -1 : -hrx + 1;
    const fringeTo = dir === 2 ? 2 : hrx - 1;
    for (let i = fringeFrom; i < fringeTo; i += 3) {
      r.rect(hx + i, hy, 2, 1 + ((i + hrx) % 2), hair);
    }

    const eyeY = hy + 4;
    if (dir === 0) {
      drawEye(r, ox + 12, eyeY, pal, false);
      drawEye(r, ox + 20, eyeY, pal, false);
      r.px(ox + 16, eyeY + 4, shade(skin, -0.4)); // mouth
      r.rect(ox + 9, eyeY + 2, 2, 1, rgba('#e08a80', 0.5)); // blush
      r.rect(ox + 21, eyeY + 2, 2, 1, rgba('#e08a80', 0.5));
    } else {
      drawEye(r, hx + lean * 3, eyeY, pal, false);
      const nx = hx + lean * 8;
      r.px(nx, eyeY, skinShade); // nose nub
      r.px(nx - lean, eyeY + 1, skinShade);
      r.rect(hx + lean * 5 - 1, eyeY + 4, 2, 1, shade(skin, -0.4)); // mouth
      r.rect(hx + lean * 2, eyeY + 2, 2, 1, rgba('#e08a80', 0.45)); // blush
    }
  }

  if (pal.hat) drawHat(r, ox, oy, pal.hat, pal, dir, bob);
}

function buildCharacterSheet() {
  const cols = DIRS.length * STEPS;
  const sheet = new Raster(cols * FRAME_W, CAST.length * FRAME_H);
  CAST.forEach((pal, row) => {
    for (let d = 0; d < DIRS.length; d++) {
      for (let s = 0; s < STEPS; s++) {
        drawChibi(sheet, (d * STEPS + s) * FRAME_W, row * FRAME_H, d, s, pal);
      }
    }
  });
  return sheet;
}

// ---------------------------------------------------------------------------
// Dialogue portraits — 64x64 chibi busts, one per cast member.
// ---------------------------------------------------------------------------

function drawPortrait(r, ox, oy, pal) {
  const skin = rgba(pal.skin);
  const hair = rgba(pal.hair);
  const hairLit = shade(hair, 0.25);
  const coat = rgba(pal.coat);

  // Vignette backdrop so portraits read against any panel colour.
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const d = Math.hypot(x - 32, y - 34) / 45;
      r.px(ox + x, oy + y, shade(rgba('#2a2028'), Math.min(0.35, 0.35 - d * 0.5)));
    }
  }

  // Layout budget for the 64px frame: hat 0-14, head 10-42, neck 42-48,
  // shoulders 48-64. Nothing may exceed it or the bust reads as cropped.

  // Shoulders / coat.
  r.rect(ox + 27, oy + 40, 10, 9, shade(skin, -0.22)); // neck
  r.roundRect(ox + 6, oy + 48, 52, 16, 7, coat);
  r.roundRect(ox + 11, oy + 51, 42, 13, 5, shade(coat, 0.12));
  if (pal.scarf) r.roundRect(ox + 20, oy + 46, 24, 6, 3, rgba(pal.scarf));

  // Head.
  r.ellipse(ox + 32, oy + 26, 17, 16, skin);
  r.ellipse(ox + 32, oy + 33, 14, 10, skin);

  // Hair — cap sits above the eye line, fringe points stop at y+30.
  r.ellipse(ox + 32, oy + 17, 18, 12, hair);
  r.rect(ox + 14, oy + 16, 4, 20, hair);
  r.rect(ox + 46, oy + 16, 4, 20, hair);
  r.ellipse(ox + 23, oy + 11, 7, 3.5, hairLit);
  for (let i = -15; i <= 15; i += 6) {
    r.ellipse(ox + 32 + i, oy + 25, 3, 4 + ((i + 15) % 4), hair);
  }

  // Big anime eyes, seated just below the fringe.
  for (const ex of [ox + 23, ox + 41]) {
    r.ellipse(ex, oy + 33, 4.6, 5.8, WHITE);
    r.ellipse(ex, oy + 34, 3.6, 4.8, shade(rgba(pal.accent), -0.45));
    r.ellipse(ex, oy + 35, 2.7, 3.6, rgba(pal.accent));
    r.ellipse(ex, oy + 36.5, 1.4, 1.6, INK); // pupil
    r.ellipse(ex - 1.4, oy + 31.5, 1.5, 1.9, WHITE); // highlight
    r.px(ex + 2, oy + 37, WHITE);
    r.rect(ex - 5, oy + 27, 10, 2, INK); // lash line
    r.rect(ex - 5, oy + 26, 3, 1, INK);
  }

  r.rect(ox + 31, oy + 39, 2, 1, shade(skin, -0.3)); // nose
  r.rect(ox + 29, oy + 43, 6, 1, shade(skin, -0.45)); // mouth
  r.px(ox + 28, oy + 42, shade(skin, -0.45));
  r.px(ox + 35, oy + 42, shade(skin, -0.45));
  r.ellipse(ox + 17, oy + 39, 4, 2, rgba('#e08a80', 0.4)); // blush
  r.ellipse(ox + 47, oy + 39, 4, 2, rgba('#e08a80', 0.4));

  if (pal.hat) {
    const dark = rgba('#20191a');
    if (pal.hat === 'top') {
      r.rect(ox + 7, oy + 11, 50, 4, dark); // brim
      r.roundRect(ox + 17, oy + 1, 30, 12, 3, dark);
      r.rect(ox + 17, oy + 8, 30, 3, rgba(pal.accent)); // band
    } else if (pal.hat === 'custodian') {
      r.roundRect(ox + 15, oy, 34, 16, 8, rgba('#20242e'));
      r.rect(ox + 10, oy + 12, 44, 4, rgba('#20242e'));
      r.ellipse(ox + 32, oy + 6, 4, 4, rgba(pal.accent));
    } else if (pal.hat === 'veil') {
      r.roundRect(ox + 14, oy + 3, 36, 12, 6, dark);
      for (let y = 0; y < 26; y++)
        for (let x = 0; x < 36; x++)
          if ((x + y) % 2 === 0) r.px(ox + 14 + x, oy + 13 + y, rgba('#000000', 0.22));
    } else {
      r.roundRect(ox + 15, oy + 4, 34, 11, 5, dark);
      r.rect(ox + 10, oy + 12, 22, 3, shade(dark, 0.12)); // peak
    }
  }

  // Frame border.
  r.rect(ox, oy, 64, 1, rgba('#c9a227', 0.7));
  r.rect(ox, oy + 63, 64, 1, rgba('#c9a227', 0.7));
  r.rect(ox, oy, 1, 64, rgba('#c9a227', 0.7));
  r.rect(ox + 63, oy, 1, 64, rgba('#c9a227', 0.7));
}

function buildPortraitSheet() {
  const sheet = new Raster(64 * CAST.length, 64);
  CAST.forEach((pal, i) => drawPortrait(sheet, i * 64, 0, pal));
  return sheet;
}

// ---------------------------------------------------------------------------
// The 32px tileset is NOT generated here — it is repacked from Kenney's
// Roguelike/RPG pack (CC0) by tools/import-tiles.mjs. Two scripts writing the
// same file would mean whichever ran last wins; the tiles have exactly one
// source. Run `npm run tiles` to rebuild them.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// UI icons — 16x16, 8 per row. Index order matches ICONS in src/ui/theme.ts.
// ---------------------------------------------------------------------------

const ICON_DRAWERS = [
  // 0 pence (small copper coin)
  (r, o) => {
    r.ellipse(o.x + 8, o.y + 8, 5, 5, rgba('#8a5a32'));
    r.ellipse(o.x + 8, o.y + 8, 3.5, 3.5, rgba('#b57a44'));
  },
  // 1 soli (silver coin)
  (r, o) => {
    r.ellipse(o.x + 8, o.y + 8, 6, 6, rgba('#8d949c'));
    r.ellipse(o.x + 8, o.y + 8, 4.5, 4.5, rgba('#c3ccd4'));
    r.rect(o.x + 7, o.y + 5, 2, 6, rgba('#8d949c'));
  },
  // 2 pound (paper note)
  (r, o) => {
    r.rect(o.x + 1, o.y + 4, 14, 8, rgba('#cfc7a6'));
    r.rect(o.x + 2, o.y + 5, 12, 6, rgba('#e3dcbd'));
    r.ellipse(o.x + 8, o.y + 8, 2.5, 2.5, rgba('#8a7a4a'));
  },
  // 3 spirituality (eye)
  (r, o) => {
    r.ellipse(o.x + 8, o.y + 8, 7, 4.5, rgba('#dfe6f0'));
    r.ellipse(o.x + 8, o.y + 8, 3.2, 3.2, rgba('#5a7fb0'));
    r.ellipse(o.x + 8, o.y + 8, 1.6, 1.6, INK);
    r.px(o.x + 6, o.y + 6, WHITE);
  },
  // 4 sanity (cracked heart-mind)
  (r, o) => {
    r.ellipse(o.x + 5.5, o.y + 6, 3.5, 3.5, rgba('#b04a58'));
    r.ellipse(o.x + 10.5, o.y + 6, 3.5, 3.5, rgba('#b04a58'));
    r.ellipse(o.x + 8, o.y + 10, 5, 4.5, rgba('#b04a58'));
    r.line(o.x + 8, o.y + 3, o.x + 6, o.y + 8, rgba('#2b1418'));
    r.line(o.x + 6, o.y + 8, o.x + 9, o.y + 12, rgba('#2b1418'));
  },
  // 5 concealment (mask)
  (r, o) => {
    r.roundRect(o.x + 1, o.y + 4, 14, 8, 4, rgba('#d8cdb8'));
    r.ellipse(o.x + 5, o.y + 8, 2, 1.6, INK);
    r.ellipse(o.x + 11, o.y + 8, 2, 1.6, INK);
    r.rect(o.x + 7, o.y + 7, 2, 1, rgba('#a8998a'));
  },
  // 6 clue (magnifier)
  (r, o) => {
    r.ellipse(o.x + 6.5, o.y + 6.5, 5, 5, rgba('#c9a227'));
    r.ellipse(o.x + 6.5, o.y + 6.5, 3.5, 3.5, rgba('#3d5a6b'));
    r.px(o.x + 5, o.y + 5, WHITE);
    r.line(o.x + 10, o.y + 10, o.x + 14, o.y + 14, rgba('#7a5a2a'));
    r.line(o.x + 11, o.y + 10, o.x + 15, o.y + 14, rgba('#7a5a2a'));
  },
  // 7 tarot card
  (r, o) => {
    r.roundRect(o.x + 3, o.y + 1, 10, 14, 2, rgba('#2b2440'));
    r.roundRect(o.x + 4, o.y + 2, 8, 12, 1, rgba('#3a3157'));
    r.ellipse(o.x + 8, o.y + 8, 2.5, 3, rgba('#c9a227'));
    r.px(o.x + 8, o.y + 8, INK);
  },
  // 8 potion
  (r, o) => {
    r.rect(o.x + 6, o.y + 1, 4, 4, rgba('#8d949c'));
    r.roundRect(o.x + 3, o.y + 5, 10, 10, 4, rgba('#7fb2c8', 0.55));
    r.roundRect(o.x + 4, o.y + 8, 8, 6, 3, rgba('#5a8fb0'));
    r.px(o.x + 5, o.y + 7, WHITE);
  },
  // 9 key
  (r, o) => {
    r.ellipse(o.x + 4, o.y + 5, 3, 3, rgba('#c9a227'));
    r.ellipse(o.x + 4, o.y + 5, 1.4, 1.4, rgba('#0d0b09', 0));
    r.line(o.x + 6, o.y + 7, o.x + 13, o.y + 13, rgba('#c9a227'));
    r.rect(o.x + 11, o.y + 10, 3, 2, rgba('#c9a227'));
  },
  // 10 candle
  (r, o) => {
    r.rect(o.x + 6, o.y + 6, 4, 9, rgba('#e6dcc4'));
    r.ellipse(o.x + 8, o.y + 4, 2, 3, rgba('#f6d06a'));
    r.ellipse(o.x + 8, o.y + 5, 1, 1.6, rgba('#fdf6e8'));
    r.ellipse(o.x + 8, o.y + 4, 4, 5, rgba('#f6d06a', 0.15));
  },
  // 11 document / case file
  (r, o) => {
    r.rect(o.x + 3, o.y + 1, 10, 14, rgba('#e6dcc4'));
    r.rect(o.x + 3, o.y + 1, 10, 3, rgba('#a89a76'));
    for (let i = 0; i < 4; i++) r.rect(o.x + 5, o.y + 6 + i * 2, 6, 1, rgba('#8a8070'));
  },
  // 12 danger (skull)
  (r, o) => {
    r.ellipse(o.x + 8, o.y + 7, 5, 5, rgba('#ded4c0'));
    r.rect(o.x + 5, o.y + 10, 6, 4, rgba('#ded4c0'));
    r.ellipse(o.x + 6, o.y + 7, 1.6, 2, INK);
    r.ellipse(o.x + 10, o.y + 7, 1.6, 2, INK);
    r.rect(o.x + 7, o.y + 11, 2, 3, rgba('#a89a86'));
  },
  // 13 sequence star
  (r, o) => {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
      const b = a + (Math.PI * 4) / 5;
      r.line(
        o.x + 8 + Math.cos(a) * 6,
        o.y + 8 + Math.sin(a) * 6,
        o.x + 8 + Math.cos(b) * 6,
        o.y + 8 + Math.sin(b) * 6,
        rgba('#c9a227'),
      );
    }
  },
  // 14 trust (clasped hands)
  (r, o) => {
    r.roundRect(o.x + 1, o.y + 6, 8, 5, 2, rgba('#f2c9a8'));
    r.roundRect(o.x + 7, o.y + 5, 8, 5, 2, rgba('#d9a67e'));
    r.rect(o.x + 7, o.y + 6, 2, 4, rgba('#b98a63'));
  },
  // 15 lock (concealment breach)
  (r, o) => {
    r.rect(o.x + 3, o.y + 7, 10, 8, rgba('#8d949c'));
    r.rect(o.x + 5, o.y + 3, 6, 5, rgba('#6b7178'));
    r.rect(o.x + 7, o.y + 4, 2, 4, rgba('#3a3f45'));
    r.ellipse(o.x + 8, o.y + 11, 1.6, 1.6, rgba('#3a3f45'));
  },
];

function buildIconSheet() {
  const cols = 8;
  const rows = Math.ceil(ICON_DRAWERS.length / cols);
  const sheet = new Raster(cols * 16, rows * 16);
  ICON_DRAWERS.forEach((draw, i) => {
    draw(sheet, { x: (i % cols) * 16, y: Math.floor(i / cols) * 16 });
  });
  return sheet;
}

// ---------------------------------------------------------------------------
// App icons — a tarot card back with the Seer's eye.
// ---------------------------------------------------------------------------

function buildAppIcon(size) {
  const r = new Raster(size, size);
  const u = size / 16; // design on a 16-unit grid, then scale
  r.rect(0, 0, size, size, rgba('#14100d'));
  r.roundRect(2 * u, 1 * u, 12 * u, 14 * u, 1.5 * u, rgba('#2b2440'));
  r.roundRect(2.7 * u, 1.7 * u, 10.6 * u, 12.6 * u, u, rgba('#372e52'));

  // Gilt border.
  const gold = rgba('#c9a227');
  r.rect(3.4 * u, 2.4 * u, 9.2 * u, 0.3 * u, gold);
  r.rect(3.4 * u, 13.3 * u, 9.2 * u, 0.3 * u, gold);
  r.rect(3.4 * u, 2.4 * u, 0.3 * u, 11.2 * u, gold);
  r.rect(12.3 * u, 2.4 * u, 0.3 * u, 11.2 * u, gold);

  // The eye.
  const cx = size / 2;
  const cy = size / 2;
  r.ellipse(cx, cy, 3.6 * u, 2.3 * u, rgba('#e8dcc8'));
  r.ellipse(cx, cy, 1.9 * u, 1.9 * u, rgba('#5a7fb0'));
  r.ellipse(cx, cy, 1.0 * u, 1.0 * u, rgba('#14100d'));
  r.ellipse(cx - 0.7 * u, cy - 0.7 * u, 0.5 * u, 0.5 * u, WHITE);

  // Rays.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    r.line(
      cx + Math.cos(a) * 4.4 * u,
      cy + Math.sin(a) * 4.4 * u,
      cx + Math.cos(a) * 5.2 * u,
      cy + Math.sin(a) * 5.2 * u,
      gold,
    );
  }
  return r;
}

// ---------------------------------------------------------------------------

function write(relPath, raster) {
  const full = path.join(OUT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, raster.toPng());
  const kb = (fs.statSync(full).size / 1024).toFixed(1);
  console.log(`  ${relPath.padEnd(28)} ${raster.width}x${raster.height}  ${kb} KB`);
}

console.log('Generating placeholder art into public/assets ...');
write('sprites/characters.png', buildCharacterSheet());
write('sprites/portraits.png', buildPortraitSheet());
write('ui/icons.png', buildIconSheet());
for (const size of [180, 192, 512]) write(`icons/icon-${size}.png`, buildAppIcon(size));

// Emit a manifest so the game (and future tooling) can assert the frame
// geometry it was generated with instead of hard-coding it twice.
const manifest = {
  generatedBy: 'tools/generate-art.mjs',
  style: 'chibi-anime placeholder, flat colour + single rim shade',
  characters: {
    file: 'sprites/characters.png',
    frameWidth: FRAME_W,
    frameHeight: FRAME_H,
    directions: DIRS,
    stepsPerDirection: STEPS,
    order: CAST.map((c) => c.id),
  },
  portraits: { file: 'sprites/portraits.png', size: 64, order: CAST.map((c) => c.id) },
  tileset: {
    file: 'tiles/tileset.png',
    tileSize: TILE,
    source: "Kenney Roguelike/RPG pack (CC0), repacked by tools/import-tiles.mjs",
  },
  icons: { file: 'ui/icons.png', size: 16, count: ICON_DRAWERS.length },
};
fs.writeFileSync(path.join(OUT, 'art-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`  art-manifest.json            ${CAST.length} characters`);
console.log('Done.');
