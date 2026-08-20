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
  { id: 'player', skin: '#f0c8a6', hair: '#2b211c', coat: '#3d4451', accent: '#7fb2c8', trouser: '#2c3038', hat: null, scarf: '#8c3b40' , hairStyle: 'parted', eyes: '#5b86b0', extras: ['collar'] },
  // Tarot Club members.
  { id: 'hermit', skin: '#e6bb95', hair: '#b8a67e', coat: '#4a3d5c', accent: '#c9a227', trouser: '#3a3040', hat: 'top', scarf: null , hairStyle: 'short', eyes: '#7d8a6a', brow: 1, extras: ['collar'] },
  { id: 'star', skin: '#e8b48a', hair: '#8a4326', coat: '#7a4a2c', accent: '#e0b060', trouser: '#4a3020', hat: null, scarf: '#d9c27a' , hairStyle: 'ponytail', eyes: '#7a4a2c' },
  { id: 'tower', skin: '#e4ad84', hair: '#6a4a2a', coat: '#2f4636', accent: '#9fbf8a', trouser: '#28352a', hat: 'cap', scarf: null , hairStyle: 'swept', eyes: '#7fae6a', brow: -1 },
  { id: 'moon', skin: '#e8c5a4', hair: '#b9b3a6', coat: '#2b2f4a', accent: '#b39ddb', trouser: '#23263a', hat: null, scarf: '#4a4f7a' , hairStyle: 'receding', eyes: '#6f6250', extras: ['moustache', 'glasses'] },
  // Case cast.
  { id: 'constable', skin: '#e3b48d', hair: '#2b2622', coat: '#1f2b44', accent: '#c0c6d0', trouser: '#1a2236', hat: 'custodian', scarf: null , hairStyle: 'short', eyes: '#5a6472', extras: ['moustache'] },
  { id: 'widow', skin: '#f0cdb0', hair: '#9a938c', coat: '#22201f', accent: '#6e6a66', trouser: '#1a1817', hat: null, scarf: null , hairStyle: 'receding', eyes: '#6b6560', extras: ['moustache'] },
  { id: 'apprentice', skin: '#eec39c', hair: '#8a5a2b', coat: '#6b6250', accent: '#a89a76', trouser: '#4a453a', hat: 'flat', scarf: null , hairStyle: 'short', eyes: '#8a7a4a', brow: 1 },
  { id: 'landlady', skin: '#f2cdad', hair: '#8c7454', coat: '#6a3350', accent: '#d6a0b8', trouser: '#4a2438', hat: null, scarf: '#e2d2c0' , hairStyle: 'long', eyes: '#5b86b0' },
  { id: 'rival', skin: '#d9a67e', hair: '#141210', coat: '#2a1f2c', accent: '#a03a4a', trouser: '#1e1620', hat: 'top', scarf: '#5c1f28' , hairStyle: 'swept', eyes: '#a03a4a', brow: -1, extras: ['monocle'] },
  { id: 'pawnbroker', skin: '#cfae94', hair: '#5a4a38', coat: '#4a3b2a', accent: '#b09060', trouser: '#3a2f22', hat: null, scarf: null , hairStyle: 'short', eyes: '#8a8272', brow: 1 },
  { id: 'dockhand', skin: '#c08a5e', hair: '#2a2018', coat: '#40514f', accent: '#8aa8a2', trouser: '#2c3a38', hat: 'cap', scarf: null , hairStyle: 'short', eyes: '#6d8a86' },
  // Family. Appended, not inserted: the index is the frame number.
  { id: 'benson', skin: '#f0c5a2', hair: '#33251d', coat: '#4a4034', accent: '#b9a37c', trouser: '#332c24', hat: null, scarf: null , hairStyle: 'parted', eyes: '#5b86b0', extras: ['collar'] },
  // The notebook's trail, and the two who answer above the grey fog.
  { id: 'bieber', skin: '#c9bba8', hair: '#2e2a26', coat: '#3b3a30', accent: '#7d8a5a', trouser: '#2a2a22', hat: null, scarf: null , hairStyle: 'swept', eyes: '#8a9a6a', brow: 1 },
  { id: 'clown', skin: '#efe6df', hair: '#6a2030', coat: '#5a2338', accent: '#e8dcc8', trouser: '#2a1620', hat: 'top', scarf: '#c9a227' , hairStyle: 'swept', eyes: '#c9a227', face: 'paint' },
  { id: 'justice', skin: '#f7d8bf', hair: '#d9b45a', coat: '#5a4b7a', accent: '#e6d7a8', trouser: '#3c3254', hat: null, scarf: '#dcc7e0' , hairStyle: 'long', eyes: '#6aa8d8' },
  { id: 'hanged_man', skin: '#b98b60', hair: '#241d18', coat: '#2c3f4a', accent: '#8fb0bd', trouser: '#22303a', hat: 'cap', scarf: '#6a7f88' , hairStyle: 'short', eyes: '#8fb0bd', brow: 1, extras: ['beard'] },
  { id: 'daly', skin: '#e6b992', hair: '#1f1a17', coat: '#33323f', accent: '#9d86c9', trouser: '#26252f', hat: null, scarf: '#4a4560' , hairStyle: 'bob', eyes: '#9d86c9', brow: -1 },
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

/**
 * Trace a dark line around whatever has been drawn in a frame.
 *
 * A 32x40 figure on a 32px tiled floor has almost no silhouette of its own —
 * the coat is one brown among several. One pixel of outline is the difference
 * between a character standing in a room and a decal on the boards.
 */
function outlineFrame(r, ox, oy, w, h, colour) {
  const filled = [];
  for (let y = 0; y < h; y++) {
    filled[y] = [];
    for (let x = 0; x < w; x++) filled[y][x] = r.get(ox + x, oy + y)[3] > 40;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (filled[y][x]) continue;
      const touching =
        (y > 0 && filled[y - 1][x]) ||
        (y < h - 1 && filled[y + 1][x]) ||
        (x > 0 && filled[y][x - 1]) ||
        (x < w - 1 && filled[y][x + 1]);
      if (touching) r.px(ox + x, oy + y, colour);
    }
  }
}

function buildCharacterSheet() {
  const cols = DIRS.length * STEPS;
  const sheet = new Raster(cols * FRAME_W, CAST.length * FRAME_H);
  CAST.forEach((pal, row) => {
    for (let d = 0; d < DIRS.length; d++) {
      for (let s = 0; s < STEPS; s++) {
        const ox = (d * STEPS + s) * FRAME_W;
        const oy = row * FRAME_H;
        drawChibi(sheet, ox, oy, d, s, pal);
        outlineFrame(sheet, ox, oy, FRAME_W, FRAME_H, rgba('#120e12', 0.85));
      }
    }
  });
  return sheet;
}

// ---------------------------------------------------------------------------
// Dialogue portraits — 64x64 chibi busts, one per cast member.
// ---------------------------------------------------------------------------

/**
 * A 64x64 bust.
 *
 * Built the way a pixel portrait has to be built at this size: an explicit
 * silhouette rather than stacked ellipses. The head is a per-row half-width
 * table (temples widest, jaw tapering to a three-pixel chin), the hair is a
 * mass plus individual strands with pointed tips, and the eye is mostly white
 * with a small iris — the previous version's four-pixel lash line read as a
 * bruise on every character at once.
 */

/** Half-width of the head at a given row, measured from the centre line. */
function headHalf(y) {
  if (y < 11) return 0;
  if (y <= 14) return 9 + (y - 11);        // crown
  if (y <= 19) return 12 + (y - 15) * 0.5; // temple
  if (y <= 31) return 14;                  // widest, through the eyes
  if (y <= 36) return 14 - (y - 31) * 0.8; // cheek
  if (y <= 41) return 10 - (y - 36) * 1.1; // jaw
  if (y <= 44) return 5;                   // chin
  return 0;
}

function fillHead(r, ox, oy, skin, shadow) {
  for (let y = 11; y <= 44; y++) {
    const half = Math.round(headHalf(y));
    if (half <= 0) continue;
    r.rect(ox + 32 - half, oy + y, half * 2, 1, skin);
  }
  // Form: a soft shadow down the right-hand side and under the jaw.
  for (let y = 26; y <= 40; y++) {
    const half = Math.round(headHalf(y));
    if (half <= 3) continue;
    r.rect(ox + 32 + half - 1, oy + y, 1, 1, shadow);
  }
  r.rect(ox + 27, oy + 42, 10, 1, shadow);
}

/** One lock of hair: a tapering strand with a pointed tip. */
function strand(r, ox, oy, x, top, bottom, width, colour) {
  const span = Math.max(1, bottom - top);
  for (let y = top; y <= bottom; y++) {
    const t = (y - top) / span;
    const w = Math.max(1, Math.round(width * (1 - t * 0.8)));
    r.rect(ox + x - Math.floor(w / 2), oy + y, w, 1, colour);
  }
}

function drawPortrait(r, ox, oy, pal) {
  const painted = pal.face === 'paint';
  const skin = rgba(painted ? '#f2ece7' : pal.skin);
  const skinShade = shade(skin, -0.16);
  const hair = rgba(pal.hair);
  const hairLit = shade(hair, 0.16);
  const hairDark = shade(hair, -0.35);
  const coat = rgba(pal.coat);
  const eye = rgba(pal.eyes ?? pal.accent);
  const style = pal.hairStyle ?? 'short';
  const extras = pal.extras ?? [];
  const long = style === 'long' || style === 'ponytail' || style === 'bob';

  // Background: a vertical wash with a halo behind the head, tinted towards
  // the character's own colour so nine portraits do not share one backdrop.
  for (let y = 0; y < 64; y++) {
    const t = y / 63;
    r.rect(ox, oy + y, 64, 1, shade(rgba('#2b2530'), -0.35 * t));
  }
  for (let ring = 24; ring > 12; ring -= 3) {
    r.ellipse(ox + 32, oy + 30, ring, ring - 4, shade(eye, -0.62));
  }

  // Hair that falls behind the shoulders goes down first.
  if (long) {
    const drop = style === 'bob' ? 42 : 56;
    for (let y = 16; y <= drop; y++) {
      const spread = style === 'bob' ? 15 : 16 + Math.round((y - 16) / 8);
      r.rect(ox + 32 - spread, oy + y, spread * 2, 1, hairDark);
    }
  }

  // Shoulders: a trapezoid, not a pill, with a collar cut into it.
  for (let y = 51; y < 64; y++) {
    const half = Math.min(30, 12 + (y - 51) * 2.4);
    r.rect(ox + 32 - Math.round(half), oy + y, Math.round(half) * 2, 1, coat);
  }
  // Neck, with the jaw's shadow across the top of it.
  r.rect(ox + 28, oy + 43, 8, 10, skinShade);
  r.rect(ox + 28, oy + 43, 8, 2, shade(skin, -0.34));
  r.rect(ox + 27, oy + 50, 10, 3, skinShade);
  // Collar: two short lapels meeting at the throat.
  for (let i = 0; i < 5; i++) {
    r.rect(ox + 25 - i, oy + 54 + i, 4, 1, shade(coat, 0.2));
    r.rect(ox + 35 + i, oy + 54 + i, 4, 1, shade(coat, 0.2));
  }
  if (pal.scarf) r.rect(ox + 27, oy + 53, 10, 3, rgba(pal.scarf));
  if (extras.includes('collar')) {
    r.rect(ox + 27, oy + 53, 10, 2, WHITE);
    r.rect(ox + 30, oy + 55, 4, 5, rgba(pal.accent));
  }

  fillHead(r, ox, oy, skin, skinShade);
  // Ears.
  r.rect(ox + 18, oy + 28, 2, 5, skinShade);
  r.rect(ox + 44, oy + 28, 2, 5, skinShade);

  // Hair mass over the skull, then the fringe, then side locks.
  for (let y = 11; y <= 20; y++) {
    const half = Math.round(headHalf(y)) + (y > 13 ? 1 : 0);
    if (half <= 0) continue;
    r.rect(ox + 32 - half, oy + y, half * 2, 1, hair);
  }
  r.rect(ox + 22, oy + 13, 9, 2, hairLit); // sheen

  switch (style) {
    case 'receding':
      r.rect(ox + 24, oy + 14, 16, 5, skin);
      strand(r, ox, oy, 20, 16, 30, 5, hair);
      strand(r, ox, oy, 44, 16, 30, 5, hair);
      break;
    case 'parted':
      // A parting off-centre: the heavy side sweeps across the brow.
      for (let i = 0; i < 8; i++) r.rect(ox + 27 + i, oy + 14 + i, 1, 1, hairDark);
      strand(r, ox, oy, 24, 18, 27, 6, hair);
      strand(r, ox, oy, 30, 19, 25, 5, hair);
      strand(r, ox, oy, 37, 18, 27, 7, hair);
      strand(r, ox, oy, 19, 18, 32, 5, hair);
      strand(r, ox, oy, 45, 18, 32, 5, hair);
      break;
    case 'swept':
      for (let i = 0; i < 5; i++) {
        strand(r, ox, oy, 22 + i * 5, 20 - i, 27 - i, 6, i % 2 ? hair : hairLit);
      }
      strand(r, ox, oy, 19, 18, 33, 5, hair);
      strand(r, ox, oy, 45, 18, 30, 5, hair);
      break;
    case 'long':
      strand(r, ox, oy, 24, 18, 26, 7, hair);
      strand(r, ox, oy, 32, 19, 24, 6, hairLit);
      strand(r, ox, oy, 40, 18, 26, 7, hair);
      strand(r, ox, oy, 17, 18, 46, 7, hair);
      strand(r, ox, oy, 47, 18, 46, 7, hair);
      break;
    case 'ponytail':
      strand(r, ox, oy, 25, 18, 26, 7, hair);
      strand(r, ox, oy, 38, 18, 26, 6, hair);
      strand(r, ox, oy, 19, 18, 34, 5, hair);
      strand(r, ox, oy, 45, 18, 34, 5, hair);
      for (let y = 24; y < 44; y++) r.rect(ox + 48, oy + y, 5, 1, hair);
      r.rect(ox + 47, oy + 22, 7, 3, hairDark);
      break;
    case 'bob':
      r.rect(ox + 19, oy + 20, 26, 3, hairDark); // blunt fringe
      strand(r, ox, oy, 18, 18, 40, 7, hair);
      strand(r, ox, oy, 46, 18, 40, 7, hair);
      break;
    default:
      strand(r, ox, oy, 23, 18, 27, 6, hair);
      strand(r, ox, oy, 29, 19, 25, 5, hairLit);
      strand(r, ox, oy, 35, 18, 26, 6, hair);
      strand(r, ox, oy, 41, 19, 27, 5, hair);
      strand(r, ox, oy, 19, 18, 31, 5, hair);
      strand(r, ox, oy, 45, 18, 31, 5, hair);
  }

  // Eyes: mostly white, small dark rim, iris large enough to carry a colour.
  const brow = pal.brow ?? 0;
  for (const [side, ex] of [[-1, ox + 25], [1, ox + 39]]) {
    r.rect(ex - 3, oy + 31, 7, 6, WHITE);
    r.rect(ex - 3, oy + 31, 7, 1, INK);              // upper lash
    r.rect(ex + side * 3, oy + 32, 1, 2, INK);        // outer corner
    r.rect(ex - 2, oy + 32, 5, 5, shade(eye, -0.45)); // iris rim
    r.rect(ex - 2, oy + 32, 5, 4, eye);               // iris
    r.rect(ex - 1, oy + 34, 2, 2, INK);               // pupil
    r.rect(ex - 2, oy + 32, 2, 1, WHITE);             // highlight
    r.rect(ex - 3, oy + 37, 7, 1, skinShade);         // lower lid
    const lift = side * brow;
    const browY = oy + 28 - Math.max(0, lift);
    r.rect(ex - 3, browY, 4, 1, hair);
    r.rect(ex + 1, browY + Math.max(0, -lift), 3, 1, hair);
  }

  // Nose and mouth: two or three pixels each. Anything more is a moustache.
  r.rect(ox + 33, oy + 37, 1, 2, skinShade);
  r.rect(ox + 32, oy + 38, 2, 1, skinShade);
  if (painted) {
    r.rect(ox + 27, oy + 40, 11, 2, rgba('#b0202e'));
    r.rect(ox + 25, oy + 39, 2, 3, rgba('#b0202e'));
    r.rect(ox + 38, oy + 39, 2, 3, rgba('#b0202e'));
    r.rect(ox + 24, oy + 31, 1, 5, rgba('#b0202e', 0.8));
    r.rect(ox + 40, oy + 31, 1, 5, rgba('#b0202e', 0.8));
  } else {
    r.rect(ox + 31, oy + 41, 3, 1, shade(skin, -0.5));
    r.rect(ox + 30, oy + 41, 1, 1, shade(skin, -0.28));
    r.rect(ox + 34, oy + 41, 1, 1, shade(skin, -0.28));
    r.rect(ox + 31, oy + 42, 3, 1, shade(skin, -0.14));
  }

  if (extras.includes('moustache')) {
    r.rect(ox + 27, oy + 39, 10, 2, hairDark);
    r.rect(ox + 26, oy + 40, 1, 1, hairDark);
    r.rect(ox + 37, oy + 40, 1, 1, hairDark);
  }
  if (extras.includes('beard')) {
    for (let y = 38; y <= 46; y++) {
      const half = Math.max(4, Math.round(headHalf(Math.min(y, 44))) + 1);
      r.rect(ox + 32 - half, oy + y, half * 2, 1, hairDark);
    }
    r.rect(ox + 31, oy + 41, 3, 1, shade(skin, -0.42));
  }
  if (extras.includes('glasses')) {
    const wire = rgba('#cfc8bb');
    for (const ex of [ox + 25, ox + 39]) {
      r.rect(ex - 5, oy + 30, 10, 1, wire);
      r.rect(ex - 5, oy + 38, 10, 1, wire);
      r.rect(ex - 5, oy + 30, 1, 9, wire);
      r.rect(ex + 4, oy + 30, 1, 9, wire);
    }
    r.rect(ox + 30, oy + 33, 4, 1, wire);
    r.rect(ox + 15, oy + 31, 5, 1, wire);
    r.rect(ox + 44, oy + 31, 5, 1, wire);
  }
  if (extras.includes('monocle')) {
    const wire = rgba('#c9a227');
    r.rect(ox + 34, oy + 29, 11, 1, wire);
    r.rect(ox + 34, oy + 39, 11, 1, wire);
    r.rect(ox + 34, oy + 29, 1, 11, wire);
    r.rect(ox + 44, oy + 29, 1, 11, wire);
    r.rect(ox + 44, oy + 40, 1, 9, wire);
  }

  if (pal.hat) {
    const dark = rgba('#1d181c');
    if (pal.hat === 'top') {
      r.rect(ox + 8, oy + 12, 48, 3, dark);
      r.rect(ox + 17, oy + 1, 30, 12, dark);
      r.rect(ox + 17, oy + 9, 30, 3, rgba(pal.accent));
    } else if (pal.hat === 'custodian') {
      r.rect(ox + 18, oy + 2, 28, 12, rgba('#20242e'));
      r.rect(ox + 16, oy + 6, 32, 8, rgba('#20242e'));
      r.rect(ox + 12, oy + 13, 40, 3, rgba('#191d26'));
      r.rect(ox + 30, oy + 4, 4, 4, rgba(pal.accent));
    } else if (pal.hat === 'veil') {
      r.rect(ox + 16, oy + 4, 32, 10, dark);
      for (let y = 0; y < 24; y++)
        for (let x = 0; x < 34; x++)
          if ((x + y) % 2 === 0) r.px(ox + 15 + x, oy + 14 + y, rgba('#000000', 0.2));
    } else if (pal.hat === 'cap') {
      r.rect(ox + 17, oy + 6, 30, 9, dark);
      r.rect(ox + 12, oy + 14, 40, 3, shade(dark, -0.25));
    } else if (pal.hat === 'flat') {
      r.rect(ox + 17, oy + 8, 30, 7, dark);
      r.rect(ox + 13, oy + 14, 38, 3, shade(dark, -0.2));
    }
  }

  // Frame.
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
