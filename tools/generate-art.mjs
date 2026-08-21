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
  // 0 — Klein Moretti. Slightly long black hair parted in the middle, brown
  // eyes, an ordinary face wearing three days it did not ask for.
  { id: 'player', skin: '#efc39f', hair: '#191518', coat: '#3a4150', accent: '#7fb2c8', trouser: '#2c3038', hat: null, scarf: '#8c3b40',
    hairStyle: 'curtain', eyes: '#6b4630', head: 'oval', eyeShape: 'level', mouth: 'set', back: '#2f3a4a', extras: ['collar', 'stubble'] },

  // Tarot Club and the Tingen Nighthawks.
  // 1 — Dunn Smith. Light brown hair over a receding hairline, sharp grey eyes.
  { id: 'hermit', skin: '#e6bb95', hair: '#a98b62', coat: '#46405c', accent: '#c9a227', trouser: '#3a3040', hat: null, scarf: null,
    hairStyle: 'receding', eyes: '#8e99a4', head: 'long', eyeShape: 'weary', mouth: 'grim', brow: 1, browThick: 2, back: '#3b3550', extras: ['collar', 'age'] },
  // 2 — Rozanne. Brown hair wound into a high bun, light brown eyes, green dress.
  { id: 'star', skin: '#eeba92', hair: '#7b4a2c', coat: '#7f9a63', accent: '#e6dcc0', trouser: '#4a5c3a', hat: null, scarf: null,
    hairStyle: 'bun', eyes: '#a9784a', head: 'soft', eyeShape: 'soft', mouth: 'smile', back: '#3d5240', extras: ['lace', 'earring'] },
  // 3 — Leonard Mitchell. Black hair and black sideburns, green pupils, a poet
  // who has never once been on time.
  { id: 'tower', skin: '#e4ad84', hair: '#1c1a1e', coat: '#2f4636', accent: '#9fbf8a', trouser: '#28352a', hat: null, scarf: '#8d5f4a',
    hairStyle: 'wavy', eyes: '#4f9f5e', head: 'oval', eyeShape: 'sharp', mouth: 'smirk', brow: -1, back: '#2b4038', extras: ['sideburns'] },
  // 4 — Old Neil. Snow-white hair and beard, dark red pupils gone cloudy, round
  // glasses, an old scar across the forehead, a deer-stalker.
  { id: 'moon', skin: '#dcb89a', hair: '#e4e0d6', coat: '#2b2f4a', accent: '#b39ddb', trouser: '#23263a', hat: 'deerstalker', scarf: '#4a4f7a',
    hairStyle: 'wispy', eyes: '#8a3b3b', head: 'gaunt', eyeShape: 'old', mouth: 'small', back: '#33304c', extras: ['fullbeard', 'roundGlasses', 'scar', 'age'] },

  // The case.
  // 5 — Sergeant Gorman.
  { id: 'constable', skin: '#e3b48d', hair: '#2b2622', coat: '#1f2b44', accent: '#c0c6d0', trouser: '#1a2236', hat: 'custodian', scarf: null,
    hairStyle: 'crop', eyes: '#5a6472', head: 'square', eyeShape: 'narrow', mouth: 'frown', browThick: 2, back: '#233048', extras: ['moustache'] },
  // 6 — Mr. Franky, the landlord: bald on top, mutton chops, a shopkeeper's smile.
  { id: 'widow', skin: '#f0cdb0', hair: '#9a938c', coat: '#5a4a3a', accent: '#a08a62', trouser: '#3d3226', hat: null, scarf: null,
    hairStyle: 'balding', eyes: '#6b6560', head: 'round', eyeShape: 'weary', mouth: 'smile', back: '#4a3d30', extras: ['mutton', 'age'] },
  // 7 — Hanass, of the Aurora Order. Ginger hair combed flat, a flat cap, and
  // an unhurriedness that ought to worry you.
  { id: 'apprentice', skin: '#eec39c', hair: '#8a5a2b', coat: '#6b6250', accent: '#a89a76', trouser: '#4a453a', hat: 'flat', scarf: null,
    hairStyle: 'slick', eyes: '#8a7a4a', head: 'long', eyeShape: 'narrow', mouth: 'smirk', brow: 1, back: '#4a4638' },
  // 8 — Melissa Moretti. Dark hair half pulled back, a thin, slightly pale face.
  { id: 'landlady', skin: '#f3d3ba', hair: '#2a2320', coat: '#6a3350', accent: '#d6a0b8', trouser: '#4a2438', hat: null, scarf: null,
    hairStyle: 'halfup', eyes: '#6b4630', head: 'soft', eyeShape: 'soft', mouth: 'small', back: '#4a2a44', extras: ['ribbon', 'lace'] },
  // 9 — Quill of Alzuhod. Never handles the goods; a bowler, a monocle, a goatee.
  { id: 'rival', skin: '#d9a67e', hair: '#141210', coat: '#2a1f2c', accent: '#a03a4a', trouser: '#1e1620', hat: 'bowler', scarf: '#5c1f28',
    hairStyle: 'slick', eyes: '#a03a4a', head: 'long', eyeShape: 'sharp', mouth: 'smirk', brow: -1, back: '#2a1c30', extras: ['monocle', 'goatee', 'cravat'] },
  // 10 — Welch McGovern. A student with untidy curls and freckles, and eight
  // days left when you meet him.
  { id: 'pawnbroker', skin: '#e7c1a0', hair: '#5a4a38', coat: '#4a3b2a', accent: '#b09060', trouser: '#3a2f22', hat: null, scarf: null,
    hairStyle: 'curly', eyes: '#8a8272', head: 'round', eyeShape: 'wide', mouth: 'small', back: '#3d3326', extras: ['freckles', 'collar'] },
  // 11 — Sil Mowbray, ferry hand: a knitted cap, a gold ring in one ear, salt.
  { id: 'dockhand', skin: '#c08a5e', hair: '#2a2018', coat: '#40514f', accent: '#8aa8a2', trouser: '#2c3a38', hat: 'cap', scarf: null,
    hairStyle: 'short', eyes: '#6d8a86', head: 'square', eyeShape: 'narrow', mouth: 'grim', browThick: 2, back: '#2f403e', extras: ['stubble', 'earring'] },
  // 12 — Benson Moretti. Klein's face, ten years older and losing the hairline.
  { id: 'benson', skin: '#f0c5a2', hair: '#33251d', coat: '#4a4034', accent: '#b9a37c', trouser: '#332c24', hat: null, scarf: null,
    hairStyle: 'receding', eyes: '#6b4630', head: 'oval', eyeShape: 'level', mouth: 'smile', back: '#3b342a', extras: ['collar'] },
  // 13 — Ray Bieber. Black hair, deep blue eyes set well back, a tall nose
  // bridge, and something reading over his shoulder.
  { id: 'bieber', skin: '#c9bba8', hair: '#171a19', coat: '#3b3a30', accent: '#7d8a5a', trouser: '#2a2a22', hat: null, scarf: null,
    hairStyle: 'messy', eyes: '#2f4f86', head: 'gaunt', eyeShape: 'sunken', mouth: 'grim', brow: 1, back: '#2a3038', extras: ['stubble'] },
  // 14 — The Clown. White paint, a red mouth, and manners.
  { id: 'clown', skin: '#efe6df', hair: '#6a2030', coat: '#5a2338', accent: '#e8dcc8', trouser: '#2a1620', hat: 'top', scarf: '#c9a227',
    hairStyle: 'swept', eyes: '#c9a227', head: 'oval', eyeShape: 'sharp', mouth: 'smile', face: 'paint', back: '#4a2036' },
  // 15 — Audrey Hall. Emerald green eyes and smooth blonde hair; the most
  // dazzling gem in Backlund, and taking notes.
  { id: 'justice', skin: '#f7d8bf', hair: '#e0c065', coat: '#5a4b7a', accent: '#e6d7a8', trouser: '#3c3254', hat: null, scarf: '#dcc7e0',
    hairStyle: 'long', eyes: '#3fae74', head: 'soft', eyeShape: 'soft', mouth: 'smile', back: '#4a3f6a', extras: ['ribbon', 'lace'] },
  // 16 — Alger Wilson. Dark blue hair so deep it reads as black, bronze weathered
  // skin, a captain's peaked cap.
  { id: 'hanged_man', skin: '#b17f52', hair: '#232c46', coat: '#2c3f4a', accent: '#8fb0bd', trouser: '#22303a', hat: 'captain', scarf: '#6a7f88',
    hairStyle: 'short', eyes: '#4a6a8a', head: 'square', eyeShape: 'narrow', mouth: 'set', brow: 1, back: '#26343f', extras: ['beard'] },
  // 17 — Daly Simone. A hooded black robe, blue eyeshadow worn to look older
  // than she is, and a white crystal on a silver chain.
  { id: 'daly', skin: '#eec6a8', hair: '#1f1a17', coat: '#33323f', accent: '#9d86c9', trouser: '#26252f', hat: null, scarf: '#4a4560',
    hairStyle: 'straightLong', eyes: '#9d86c9', head: 'soft', eyeShape: 'soft', mouth: 'small', brow: -1, back: '#2e2a3c', extras: ['hood', 'eyeshadow', 'mole'] },
];
// ---------------------------------------------------------------------------
// Chibi character rendering
// ---------------------------------------------------------------------------

function drawHat(r, ox, oy, kind, pal, dir, bob) {
  const accent = rgba(pal.accent);
  const dark = rgba('#20191a');
  const y = oy + 3 + bob;
  // Tall crowns want to start above the frame; clip them, or they spill onto
  // the character in the row above on the shared sheet.
  const crown = (x, top, w, h, radius, colour) => {
    const clipped = Math.max(oy, top);
    if (h - (clipped - top) > 0) r.roundRect(x, clipped, w, h - (clipped - top), radius, colour);
  };
  switch (kind) {
    case 'top':
      r.rect(ox + 4, y + 4, 24, 2, dark); // brim
      crown(ox + 9, y - 4, 14, 9, 2, dark);
      r.rect(ox + 9, y + 2, 14, 2, accent); // band
      break;
    case 'bowler':
      r.rect(ox + 5, y + 4, 22, 2, dark); // brim, curled at the edges
      r.px(ox + 4, y + 4, shade(dark, 0.3));
      r.px(ox + 27, y + 4, shade(dark, 0.3));
      r.roundRect(ox + 10, y - 1, 12, 6, 3, dark);
      r.rect(ox + 10, y + 3, 12, 1, accent);
      break;
    case 'cap': // knitted watch cap: low, ribbed, no peak
      r.roundRect(ox + 7, y - 1, 18, 7, 3, dark);
      for (let x = 8; x < 24; x += 2) r.rect(ox + x, y, 1, 4, shade(dark, 0.22));
      r.rect(ox + 6, y + 4, 20, 2, shade(dark, 0.12));
      break;
    case 'captain': // peaked cap with a badge
      r.rect(ox + 8, y - 1, 16, 5, dark);
      r.rect(ox + 7, y + 3, 18, 2, shade(dark, 0.18)); // band
      if (dir !== 3) r.rect(ox + 5, y + 5, 22, 2, shade(dark, -0.3)); // peak
      if (dir === 0) r.rect(ox + 14, y, 4, 3, accent);
      break;
    case 'custodian': // constable's helmet
      crown(ox + 7, y - 5, 18, 12, 5, rgba('#20242e'));
      r.rect(ox + 5, y + 5, 22, 2, rgba('#20242e'));
      r.ellipse(ox + 16, Math.max(oy + 2, y - 4), 2, 2, accent);
      break;
    case 'deerstalker':
      r.roundRect(ox + 7, y - 2, 18, 8, 3, dark);
      for (let j = -2; j < 6; j++) {
        for (let i = 7; i < 25; i++) if ((i + j) % 4 === 0) r.px(ox + i, y + j, shade(dark, 0.35));
      }
      if (dir !== 3) r.rect(ox + 5, y + 5, 22, 2, shade(dark, -0.2)); // front peak
      r.rect(ox + 4, y + 1, 3, 5, dark); // ear flaps
      r.rect(ox + 25, y + 1, 3, 5, dark);
      break;
    case 'bonnet':
      r.roundRect(ox + 6, y - 1, 20, 7, 3, dark);
      r.rect(ox + 6, y + 4, 20, 2, accent);
      r.rect(ox + 24, y + 5, 3, 5, accent); // trailing ribbon
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
  const iris = rgba(pal.eyes ?? pal.accent);
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
 * Eighteen people have to be told apart from a thumbnail on a phone, which is
 * a harder problem than drawing any one of them well. So nothing here is
 * shared by default: the skull is a per-row half-width table that varies by
 * face shape, the hair is a named silhouette rather than a colour swap, and
 * the eyes, brows, mouth, facial hair and headgear are all separate axes. Two
 * characters may collide on any one of them; none collide on all of them.
 *
 * Where the book gives a description — Klein's slightly long black hair and
 * brown eyes, Dunn Smith's receding hairline and grey eyes, Old Neil's white
 * beard and dark red pupils, Audrey's emerald eyes, Alger's near-black blue
 * hair — the description wins over anything that would have looked tidier.
 */

/** How far down the chin reaches, per face shape. */
const CHIN = { oval: 44, long: 46, round: 44, square: 45, gaunt: 45, soft: 43 };

/** Half-width of the head at a given row, measured from the centre line. */
function headHalf(y, shape = 'oval') {
  const chin = CHIN[shape] ?? 44;
  if (y < 11 || y > chin) return 0;
  let half;
  if (y <= 14) half = 9 + (y - 11);          // crown
  else if (y <= 19) half = 12 + (y - 15) * 0.75; // temple
  else if (y <= 31) half = 15;                    // widest, through the eyes
  else if (y <= 36) half = 15 - (y - 31) * 0.9;   // cheek
  else if (y <= 41) half = 10.5 - (y - 36) * 1.2; // jaw
  else half = 5;                                // chin
  switch (shape) {
    case 'round':
      half *= y >= 28 ? 1.12 : 1.05;
      break;
    case 'long':
      half *= 0.9;
      if (y >= 37) half += 1.6;
      break;
    case 'square':
      if (y >= 33) half = Math.max(half, y <= 42 ? 11 : 8);
      break;
    case 'gaunt':
      half *= y >= 29 && y <= 39 ? 0.84 : 0.94;
      break;
    case 'soft':
      half *= 0.95;
      if (y >= 37) half *= 0.86;
      break;
    default:
      break;
  }
  return half;
}

function fillHead(r, ox, oy, shape, skin, shadow) {
  const chin = CHIN[shape] ?? 44;
  for (let y = 11; y <= chin; y++) {
    const half = Math.round(headHalf(y, shape));
    if (half <= 0) continue;
    r.rect(ox + 32 - half, oy + y, half * 2, 1, skin);
  }
  // Form: a soft shadow down the right-hand side and under the jaw.
  for (let y = 26; y <= chin - 4; y++) {
    const half = Math.round(headHalf(y, shape));
    if (half <= 3) continue;
    r.rect(ox + 32 + half - 1, oy + y, 1, 1, shadow);
  }
  r.rect(ox + 27, oy + chin - 2, 10, 1, shadow);
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

/** The skull cap of hair, following whichever face shape is underneath. */
function hairCap(r, ox, oy, shape, top, bottom, grow, colour) {
  for (let y = top; y <= bottom; y++) {
    const half = Math.round(headHalf(y, shape)) + (y > top + 2 ? grow : 0);
    if (half <= 0) continue;
    r.rect(ox + 32 - half, oy + y, half * 2, 1, colour);
  }
}

/**
 * The forehead band of hair: solid down to `bottom`, then a ragged edge.
 *
 * Tapering strands were tried first and read as fangs — at this size a lock of
 * hair has to be a shape with an edge, not a gradient.
 */
function fringe(r, ox, oy, shape, bottom, colour, teeth = 3) {
  for (let y = 10; y <= bottom; y++) {
    const half = Math.round(headHalf(Math.max(y, 11), shape)) + (y > 13 ? 1 : 0);
    if (half > 0) r.rect(ox + 32 - half, oy + y, half * 2, 1, colour);
  }
  if (teeth <= 0) return;
  for (let x = 17; x <= 47; x += 3) {
    const drop = (x * 7) % (teeth + 1);
    if (drop > 0) r.rect(ox + x, oy + bottom + 1, 3, drop, colour);
  }
}

/** A ring one pixel thick — spectacles, not goggles. */
function circleRing(r, ox, oy, cx, cy, radius, colour) {
  for (let a = 0; a < 64; a++) {
    const t = (a / 64) * Math.PI * 2;
    r.px(ox + cx + Math.round(Math.cos(t) * radius), oy + cy + Math.round(Math.sin(t) * radius), colour);
  }
}

/** Eye geometry per shape: where the opening starts, how tall, how heavy the lid. */
const EYE_GEOM = {
  level: { top: 31, h: 6, lash: 1 },
  wide: { top: 30, h: 7, lash: 1 },
  narrow: { top: 32, h: 4, lash: 2 },
  sunken: { top: 32, h: 5, lash: 1 },
  soft: { top: 31, h: 6, lash: 2 },
  sharp: { top: 31, h: 5, lash: 2 },
  weary: { top: 32, h: 5, lash: 1 },
  old: { top: 32, h: 4, lash: 2 },
};

function drawPortraitEyes(r, ox, oy, pal, skin, skinShade, hair, eye) {
  const shape = pal.eyeShape ?? 'level';
  const g = EYE_GEOM[shape] ?? EYE_GEOM.level;
  const brow = pal.brow ?? 0;
  const browThick = pal.browThick ?? 1;
  const extras = pal.extras ?? [];

  for (const [side, ex] of [[-1, ox + 25], [1, ox + 39]]) {
    if (shape === 'sunken') {
      // Set well back: a hollow of shadow rather than a lash line.
      r.rect(ex - 4, oy + g.top - 3, 9, 4, shade(skin, -0.34));
      r.rect(ex - 4, oy + g.top + g.h, 9, 2, shade(skin, -0.26));
    }
    if (extras.includes('eyeshadow')) {
      r.rect(ex - 4, oy + g.top - 2, 9, 3, shade(rgba(pal.accent), -0.2));
    }
    r.rect(ex - 3, oy + g.top, 7, g.h, WHITE);
    r.rect(ex - 3, oy + g.top, 7, g.lash, INK);
    r.rect(ex + side * 3, oy + g.top, 1, 2, INK); // outer corner

    const iy = oy + g.top + g.lash;
    const ih = Math.max(2, g.h - g.lash - 1);
    r.rect(ex - 2, iy, 5, ih, shade(eye, -0.45));
    r.rect(ex - 2, iy, 5, Math.max(1, ih - 1), eye);
    r.rect(ex - 1, iy + Math.max(0, ih - 3), 2, Math.min(2, ih), INK); // pupil
    r.rect(ex - 2, iy, 2, 1, WHITE); // highlight
    r.rect(ex - 3, oy + g.top + g.h, 7, 1, skinShade); // lower lid

    switch (shape) {
      case 'sharp':
        r.rect(ex + side * 3, oy + g.top - 1, 2, 1, INK);
        break;
      case 'soft':
        r.rect(ex + side * 4, oy + g.top - 1, 2, 1, INK); // lash flick
        r.rect(ex - 2, oy + g.top + g.h + 1, 5, 1, shade(skin, -0.12));
        break;
      case 'weary':
        r.rect(ex - 3, oy + g.top + g.h + 2, 6, 1, shade(skin, -0.22)); // bag
        break;
      case 'old':
        r.rect(ex + side * 4, oy + g.top + 1, 2, 1, shade(skin, -0.3)); // crow's feet
        r.rect(ex + side * 5, oy + g.top + 3, 2, 1, shade(skin, -0.3));
        break;
      default:
        break;
    }

    const lift = side * brow;
    const browY = oy + g.top - 3 - Math.max(0, lift);
    r.rect(ex - 3, browY, 4, browThick, hair);
    r.rect(ex + 1, browY + Math.max(0, -lift), 3, browThick, hair);
  }
}

const MOUTHS = {
  set: (r, x, y, dark, mid) => {
    r.rect(x + 31, y, 3, 1, dark);
    r.px(x + 30, y, mid);
    r.px(x + 34, y, mid);
    r.rect(x + 31, y + 1, 3, 1, shade(mid, 0.3));
  },
  small: (r, x, y, dark, mid) => {
    r.rect(x + 31, y, 2, 1, dark);
    r.rect(x + 31, y + 1, 2, 1, shade(mid, 0.3));
  },
  smile: (r, x, y, dark, mid) => {
    r.rect(x + 30, y, 5, 1, dark);
    r.px(x + 29, y - 1, dark);
    r.px(x + 35, y - 1, dark);
    r.rect(x + 30, y + 1, 5, 1, shade(mid, 0.3));
  },
  smirk: (r, x, y, dark, mid) => {
    r.rect(x + 30, y, 5, 1, dark);
    r.px(x + 35, y - 1, dark);
    r.px(x + 29, y + 1, mid);
  },
  frown: (r, x, y, dark, mid) => {
    r.rect(x + 30, y, 5, 1, dark);
    r.px(x + 29, y + 1, dark);
    r.px(x + 35, y + 1, dark);
    r.rect(x + 30, y - 1, 5, 1, mid);
  },
  grim: (r, x, y, dark) => {
    r.rect(x + 29, y, 7, 1, dark);
    r.rect(x + 30, y + 1, 5, 1, shade(dark, 0.25));
  },
};

function drawPortrait(r, ox, oy, pal) {
  const painted = pal.face === 'paint';
  const skin = rgba(painted ? '#f2ece7' : pal.skin);
  const skinShade = shade(skin, -0.16);
  const hair = rgba(pal.hair);
  const hairLit = shade(hair, 0.18);
  const hairDark = shade(hair, -0.35);
  const coat = rgba(pal.coat);
  const eye = rgba(pal.eyes ?? pal.accent);
  const style = pal.hairStyle ?? 'short';
  const shape = pal.head ?? 'oval';
  const chin = CHIN[shape] ?? 44;
  const extras = pal.extras ?? [];
  const behind = style === 'long' || style === 'straightLong' || style === 'halfup' || style === 'wavy';

  // Background: a vertical wash with a halo behind the head, in the character's
  // own colour so eighteen portraits do not share one backdrop.
  const back = rgba(pal.back ?? pal.coat);
  for (let y = 0; y < 64; y++) {
    const t = y / 63;
    r.rect(ox, oy + y, 64, 1, shade(rgba('#2b2530'), -0.35 * t));
  }
  for (let ring = 24; ring > 12; ring -= 3) {
    r.ellipse(ox + 32, oy + 30, ring, ring - 4, shade(back, -0.15));
  }

  // A hood is a shape behind everything, including the hair.
  if (extras.includes('hood')) {
    for (let y = 6; y < 64; y++) {
      const half = Math.min(29, 14 + Math.round((y - 6) * 0.72));
      r.rect(ox + 32 - half, oy + y, half * 2, 1, shade(coat, -0.5));
    }
  }

  // Hair that falls behind the shoulders goes down before them.
  if (behind) {
    const drop = style === 'halfup' ? 54 : 60;
    for (let y = 16; y <= drop; y++) {
      const spread = Math.min(19, 15 + Math.round((y - 16) / 7));
      r.rect(ox + 32 - spread, oy + y, spread * 2, 1, hairDark);
    }
  }

  // Neck, with the jaw's shadow across the top of it. Short and thick: a long
  // thin one turns every bust into a bird.
  r.rect(ox + 26, oy + chin - 2, 12, 55 - chin, skinShade);
  r.rect(ox + 26, oy + chin - 2, 12, 2, shade(skin, -0.34));
  for (let i = 0; i < 3; i++) r.rect(ox + 25 - i, oy + 51 + i, 14 + i * 2, 1, skinShade);
  // Shoulders: a trapezoid, not a pill, with a collar cut into it.
  for (let y = 52; y < 64; y++) {
    const half = Math.min(30, 14 + (y - 52) * 2.6);
    r.rect(ox + 32 - Math.round(half), oy + y, Math.round(half) * 2, 1, coat);
  }
  // Collar: two short lapels meeting at the throat.
  for (let i = 0; i < 5; i++) {
    r.rect(ox + 24 - i, oy + 55 + i, 5, 1, shade(coat, 0.2));
    r.rect(ox + 35 + i, oy + 55 + i, 5, 1, shade(coat, 0.2));
  }
  if (pal.scarf) r.rect(ox + 27, oy + 53, 10, 3, rgba(pal.scarf));
  if (extras.includes('collar')) {
    r.rect(ox + 27, oy + 53, 10, 2, WHITE);
    r.rect(ox + 30, oy + 55, 4, 5, rgba(pal.accent));
  }
  if (extras.includes('cravat')) {
    r.rect(ox + 26, oy + 53, 12, 4, WHITE);
    r.rect(ox + 29, oy + 54, 6, 6, rgba(pal.accent));
    r.px(ox + 32, oy + 56, shade(rgba(pal.accent), -0.4));
  }
  if (extras.includes('lace')) {
    r.rect(ox + 25, oy + 54, 14, 1, rgba('#efe6d6'));
    for (let x = 25; x < 39; x += 3) {
      r.rect(ox + x, oy + 55, 2, 1, rgba('#efe6d6'));
      r.px(ox + x + 2, oy + 55, rgba('#c0b5a2'));
    }
  }

  fillHead(r, ox, oy, shape, skin, skinShade);
  // Ears.
  const earHalf = Math.round(headHalf(30, shape));
  r.rect(ox + 32 - earHalf - 2, oy + 28, 2, 5, skinShade);
  r.rect(ox + 32 + earHalf, oy + 28, 2, 5, skinShade);
  if (extras.includes('earring')) {
    r.px(ox + 32 + earHalf + 1, oy + 33, rgba('#e0c060'));
    r.px(ox + 32 + earHalf + 1, oy + 34, rgba('#c9a227'));
  }

  // Hair. Each style is a silhouette, not a recolour of the same one.
  switch (style) {
    case 'curtain': {
      // Centre part, sweeping longer toward the temples; long at the sides.
      fringe(r, ox, oy, shape, 20, hair, 0);
      for (const side of [-1, 1]) {
        for (let d = 4; d <= 16; d++) {
          const drop = Math.round((d - 4) * 0.55);
          r.rect(ox + 32 + side * d - (side < 0 ? 0 : 1), oy + 21, 1, 1 + drop, hair);
        }
      }
      r.rect(ox + 31, oy + 11, 2, 8, hairDark); // the parting
      r.rect(ox + 22, oy + 13, 8, 2, hairLit);
      r.rect(ox + 16, oy + 18, 4, 19, hair); // long at the sides
      r.rect(ox + 44, oy + 18, 4, 19, hair);
      r.rect(ox + 16, oy + 35, 4, 2, hairDark);
      r.rect(ox + 44, oy + 35, 4, 2, hairDark);
      break;
    }
    case 'receding': {
      hairCap(r, ox, oy, shape, 10, 20, 1, hair);
      // The hairline has retreated: bare temples and a high, rounded forehead.
      r.ellipse(ox + 32, oy + 17, 13, 5, skin);
      r.rect(ox + 24, oy + 11, 16, 3, hair);
      r.rect(ox + 26, oy + 12, 8, 1, hairLit);
      r.rect(ox + 16, oy + 15, 4, 16, hair);
      r.rect(ox + 44, oy + 15, 4, 16, hair);
      r.rect(ox + 19, oy + 16, 1, 15, hairDark); // edge against the temple
      r.rect(ox + 44, oy + 16, 1, 15, hairDark);
      break;
    }
    case 'balding': {
      // Bare crown, hair only round the sides and back.
      r.rect(ox + 16, oy + 19, 4, 14, hair);
      r.rect(ox + 44, oy + 19, 4, 14, hair);
      r.rect(ox + 18, oy + 18, 4, 2, hairDark);
      r.rect(ox + 42, oy + 18, 4, 2, hairDark);
      r.rect(ox + 16, oy + 31, 4, 2, hairDark);
      r.rect(ox + 44, oy + 31, 4, 2, hairDark);
      r.ellipse(ox + 29, oy + 15, 6, 3, shade(skin, 0.12)); // shine on the scalp
      break;
    }
    case 'wispy': {
      // Thin, and there is less of it every year: nothing over the forehead.
      hairCap(r, ox, oy, shape, 11, 16, 0, shade(hair, -0.06));
      for (let x = 18; x <= 46; x += 4) {
        r.rect(ox + x, oy + 11, 2, 4 + ((x * 5) % 4), x % 8 === 2 ? hairLit : hair);
      }
      for (const side of [-1, 1]) {
        for (let y = 14; y <= 32; y++) {
          const w = 3 + ((y * 3) % 3);
          r.rect(ox + 32 + side * 17 - (side < 0 ? 0 : w), oy + y, w, 1, y % 5 === 0 ? hairLit : hair);
        }
        r.rect(ox + 32 + side * 17 - (side < 0 ? 0 : 4), oy + 32, 4, 1, shade(hair, -0.3));
      }
      break;
    }
    case 'crop': {
      // Regulation short: a flat hairline and nothing over the ears.
      fringe(r, ox, oy, shape, 21, hair, 0);
      r.rect(ox + 17, oy + 21, 30, 1, hairDark);
      r.rect(ox + 22, oy + 13, 9, 2, hairLit);
      r.rect(ox + 16, oy + 22, 3, 7, hair);
      r.rect(ox + 45, oy + 22, 3, 7, hair);
      break;
    }
    case 'short': {
      fringe(r, ox, oy, shape, 22, hair, 3);
      r.rect(ox + 22, oy + 13, 9, 2, hairLit);
      r.rect(ox + 16, oy + 19, 3, 12, hair);
      r.rect(ox + 45, oy + 19, 3, 12, hair);
      break;
    }
    case 'messy': {
      // Uncombed for days: tufts going in four directions at once.
      fringe(r, ox, oy, shape, 21, hair, 4);
      for (const [x, top] of [[19, 6], [24, 4], [30, 7], [36, 3], [42, 6]]) {
        r.rect(ox + x, oy + top, 4, 12 - top, hair);
        r.px(ox + x + 1, oy + top - 1, hair);
      }
      r.rect(ox + 16, oy + 18, 3, 14, hairDark);
      r.rect(ox + 45, oy + 18, 3, 12, hairDark);
      r.rect(ox + 24, oy + 13, 6, 1, hairLit);
      break;
    }
    case 'slick': {
      // Combed straight back with something out of a jar; the sheen is the point.
      hairCap(r, ox, oy, shape, 10, 20, 0, hair);
      for (let x = 18; x <= 46; x += 3) r.rect(ox + x, oy + 10, 1, 10, hairDark);
      r.rect(ox + 20, oy + 13, 24, 1, hairLit);
      r.rect(ox + 17, oy + 20, 30, 1, hairDark);
      r.rect(ox + 16, oy + 19, 3, 10, hair);
      r.rect(ox + 45, oy + 19, 3, 10, hair);
      break;
    }
    case 'wavy': {
      // A poet's hair: a soft fringe and S-curves down past the ear.
      fringe(r, ox, oy, shape, 21, hair, 3);
      r.rect(ox + 23, oy + 12, 9, 2, hairLit);
      for (const side of [-1, 1]) {
        for (let y = 16; y <= 36; y++) {
          const wob = Math.round(Math.sin((y - 16) / 3.4) * 2);
          r.rect(ox + 32 + side * 15 - 2 + side * wob, oy + y, 5, 1, y % 5 === 0 ? shade(hair, 0.12) : hair);
        }
      }
      break;
    }
    case 'curly': {
      // Tight curls: overlapping bumps, no straight edge anywhere.
      for (let i = 0; i < 10; i++) {
        const a = (i / 9) * Math.PI;
        r.ellipse(ox + 32 - Math.round(Math.cos(a) * 16), oy + 17 - Math.round(Math.sin(a) * 7), 5, 5, hair);
      }
      fringe(r, ox, oy, shape, 20, hair, 0);
      for (let i = 0; i < 5; i++) r.ellipse(ox + 19 + i * 6, oy + 21, 4, 3, hair);
      r.ellipse(ox + 17, oy + 26, 4, 4, hair);
      r.ellipse(ox + 47, oy + 26, 4, 4, hair);
      r.ellipse(ox + 26, oy + 14, 3, 2, hairLit);
      r.ellipse(ox + 40, oy + 21, 2, 2, hairLit);
      break;
    }
    case 'bun': {
      // Swept up and wound at the back, with two tendrils left loose.
      r.ellipse(ox + 32, oy + 7, 9, 6, hairDark);
      r.ellipse(ox + 32, oy + 6, 6, 4, hair);
      hairCap(r, ox, oy, shape, 10, 19, 1, hair);
      for (let x = 19; x <= 45; x += 4) r.rect(ox + x, oy + 11, 1, 8, hairDark);
      r.rect(ox + 24, oy + 13, 7, 1, hairLit);
      r.rect(ox + 16, oy + 19, 3, 13, hair);
      r.rect(ox + 46, oy + 19, 3, 11, hair);
      break;
    }
    case 'halfup': {
      // Long, with the top half drawn back off the face.
      fringe(r, ox, oy, shape, 22, hair, 2);
      for (let i = 0; i < 8; i++) r.rect(ox + 25 + i, oy + 12 + Math.floor(i / 3), 2, 1, hairDark);
      r.rect(ox + 15, oy + 18, 5, 33, hair);
      r.rect(ox + 44, oy + 18, 5, 33, hair);
      r.rect(ox + 22, oy + 12, 8, 2, hairLit);
      break;
    }
    case 'long': {
      // Smooth, with a soft wave in it near the ends.
      fringe(r, ox, oy, shape, 22, hair, 3);
      for (const side of [-1, 1]) {
        for (let y = 16; y <= 56; y++) {
          const wob = Math.round(Math.sin((y - 16) / 8) * 2);
          r.rect(ox + 32 + side * 17 - 3 + side * wob, oy + y, 6, 1, y % 6 === 0 ? hairLit : hair);
        }
      }
      r.rect(ox + 23, oy + 12, 10, 2, hairLit);
      break;
    }
    case 'straightLong': {
      // Dead straight, parted centre, no wave at all.
      fringe(r, ox, oy, shape, 21, hair, 0);
      r.rect(ox + 31, oy + 10, 2, 11, hairDark);
      for (const side of [-1, 1]) {
        r.rect(ox + 32 + side * 19 - (side < 0 ? 0 : 5), oy + 16, 5, 40, hair);
      }
      r.rect(ox + 24, oy + 13, 6, 1, hairLit);
      break;
    }
    case 'swept': {
      // Back and up, theatrically: a high forehead and a raised crest.
      hairCap(r, ox, oy, shape, 8, 19, 1, hair);
      for (let i = 0; i < 6; i++) {
        const x = 19 + i * 5;
        r.rect(ox + x, oy + 8 + i, 4, 12 - i, i % 2 ? hair : hairLit);
      }
      r.rect(ox + 17, oy + 19, 4, 14, hair);
      r.rect(ox + 43, oy + 19, 4, 11, hair);
      r.rect(ox + 17, oy + 18, 30, 2, hairDark);
      break;
    }
    default: {
      fringe(r, ox, oy, shape, 22, hair, 3);
      r.rect(ox + 16, oy + 18, 3, 13, hair);
      r.rect(ox + 45, oy + 18, 3, 13, hair);
    }
  }

  if (extras.includes('sideburns')) {
    for (const side of [-1, 1]) {
      const x = 32 + side * (Math.round(headHalf(24, shape)) - 1) - (side < 0 ? 0 : 2);
      r.rect(ox + x, oy + 20, 3, 13, hair);
      r.rect(ox + x + (side < 0 ? 0 : 1), oy + 32, 2, 3, hairDark);
    }
  }
  if (extras.includes('ribbon')) {
    const band = rgba(pal.accent);
    r.rect(ox + 22, oy + 14, 20, 1, band);
    r.rect(ox + 41, oy + 11, 5, 5, band);
    r.rect(ox + 44, oy + 14, 4, 4, shade(band, -0.22)); // trailing tail
    r.px(ox + 43, oy + 13, shade(band, -0.45));
  }

  drawPortraitEyes(r, ox, oy, pal, skin, skinShade, hair, eye);

  // Nose. A tall bridge is worth a pixel of its own.
  const noseTop = chin - 8;
  if (pal.eyeShape === 'sunken') r.rect(ox + 32, oy + noseTop - 3, 1, 4, shade(skin, -0.24));
  r.rect(ox + 33, oy + noseTop, 1, 2, skinShade);
  r.rect(ox + 32, oy + noseTop + 1, 2, 1, skinShade);

  // Mouth.
  const mouthY = oy + chin - 3;
  if (painted) {
    r.rect(ox + 27, oy + chin - 4, 11, 2, rgba('#b0202e'));
    r.rect(ox + 25, oy + chin - 5, 2, 3, rgba('#b0202e'));
    r.rect(ox + 38, oy + chin - 5, 2, 3, rgba('#b0202e'));
    r.rect(ox + 24, oy + 31, 1, 5, rgba('#b0202e', 0.8));
    r.rect(ox + 40, oy + 31, 1, 5, rgba('#b0202e', 0.8));
  } else {
    const draw = MOUTHS[pal.mouth ?? 'set'] ?? MOUTHS.set;
    draw(r, ox, mouthY, shade(skin, -0.5), shade(skin, -0.28));
  }

  // Age, wear and marks.
  if (extras.includes('age')) {
    const line = shade(skin, -0.24);
    r.rect(ox + 25, oy + 24, 14, 1, line);
    r.rect(ox + 27, oy + 26, 10, 1, line);
    for (let i = 0; i < 3; i++) { // nasolabial folds
      r.px(ox + 28 - i, oy + chin - 6 + i, line);
      r.px(ox + 36 + i, oy + chin - 6 + i, line);
    }
  }
  if (extras.includes('scar')) {
    const line = shade(skin, -0.42);
    for (let i = 0; i < 8; i++) r.px(ox + 23 + i, oy + 21 + Math.floor(i / 2), line);
    r.px(ox + 25, oy + 20, shade(skin, -0.2));
  }
  if (extras.includes('freckles')) {
    const dot = shade(skin, -0.3);
    for (const [x, y] of [[23, 36], [26, 38], [21, 39], [40, 36], [43, 38], [38, 39], [30, 38], [35, 39]]) {
      r.px(ox + x, oy + y, dot);
    }
  }
  if (extras.includes('mole')) r.px(ox + 37, oy + chin - 5, shade(skin, -0.55));

  // Facial hair.
  if (extras.includes('stubble')) {
    // Sparse, and never over the mouth: three days, not a beard.
    for (let y = chin - 7; y <= chin; y++) {
      const half = Math.round(headHalf(y, shape));
      if (half <= 0) continue;
      for (let x = -half + 1; x < half; x++) {
        const overMouth = y >= chin - 5 && y <= chin - 1 && Math.abs(x) < 6;
        const onJaw = y > chin - 3 || Math.abs(x) > half - 5;
        if (!overMouth && onJaw && (x * 5 + y * 3) % 4 === 0) {
          r.px(ox + 32 + x, oy + y, rgba(pal.hair, 0.3));
        }
      }
    }
  }
  if (extras.includes('moustache')) {
    r.rect(ox + 27, oy + chin - 5, 10, 2, hairDark);
    r.px(ox + 26, oy + chin - 4, hairDark);
    r.px(ox + 37, oy + chin - 4, hairDark);
  }
  if (extras.includes('goatee')) {
    r.rect(ox + 28, oy + chin - 6, 8, 1, hairDark);
    r.rect(ox + 30, oy + chin - 1, 5, 4, hairDark);
    r.rect(ox + 31, oy + chin - 2, 3, 1, hairDark);
  }
  if (extras.includes('mutton')) {
    for (const side of [-1, 1]) {
      for (let y = 21; y <= chin - 5; y++) {
        const half = Math.round(headHalf(y, shape));
        const w = y < 30 ? 2 : Math.min(5, 2 + Math.round((y - 30) * 0.6));
        const x = 32 + side * half - (side < 0 ? 0 : w);
        r.rect(ox + x, oy + y, w, 1, y % 3 === 0 ? hairDark : hair);
      }
    }
  }
  if (extras.includes('beard')) {
    // A trimmed beard: three pixels along the jaw, closing under the chin.
    for (let y = chin - 6; y <= chin + 1; y++) {
      const half = Math.max(4, Math.round(headHalf(Math.min(y, chin), shape)));
      const depth = Math.min(half, 2 + (y - (chin - 6)) * 2);
      r.rect(ox + 32 - half, oy + y, depth, 1, hair);
      r.rect(ox + 32 + half - depth, oy + y, depth, 1, hair);
      r.px(ox + 32 - half, oy + y, hairDark);
      r.px(ox + 32 + half - 1, oy + y, hairDark);
    }
    r.rect(ox + 27, oy + chin - 5, 10, 2, hair); // moustache
    r.rect(ox + 30, oy + chin - 2, 5, 1, shade(skin, -0.4)); // the mouth still reads
  }
  if (extras.includes('fullbeard')) {
    // Long and hoary: it hangs past the jaw and onto the collar.
    const mass = shade(hair, -0.28);
    for (let y = chin - 5; y <= chin + 6; y++) {
      const base = Math.round(headHalf(Math.min(y, chin), shape)) + 2;
      const half = y <= chin ? base : Math.max(3, base - Math.round((y - chin) * 1.6));
      if (half <= 0) continue;
      r.rect(ox + 32 - half, oy + y, half * 2, 1, mass);
      for (let x = -half + 1; x < half; x += 3) {
        r.px(ox + 32 + x, oy + y, shade(hair, -0.46)); // strands
      }
      r.px(ox + 32 - half, oy + y, shade(hair, -0.5));
      r.px(ox + 32 + half - 1, oy + y, shade(hair, -0.5));
    }
    r.rect(ox + 26, oy + chin - 7, 12, 2, shade(hair, -0.4)); // moustache
    r.rect(ox + 28, oy + chin - 7, 8, 1, shade(hair, -0.14));
    r.rect(ox + 29, oy + chin - 5, 6, 1, shade(hair, -0.55)); // the mouth, just
  }

  // Eyewear, over the face and under the hat.
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
  if (extras.includes('roundGlasses')) {
    const wire = rgba('#d8cfae');
    for (const ex of [25, 39]) {
      circleRing(r, ox, oy, ex, 34, 5, wire);
      r.px(ox + ex - 3, oy + 31, rgba('#ffffff', 0.55)); // glare
    }
    r.rect(ox + 30, oy + 34, 4, 1, wire);
    r.rect(ox + 15, oy + 32, 5, 1, wire);
    r.rect(ox + 44, oy + 32, 5, 1, wire);
  }
  if (extras.includes('monocle')) {
    const wire = rgba('#c9a227');
    r.rect(ox + 34, oy + 29, 11, 1, wire);
    r.rect(ox + 34, oy + 39, 11, 1, wire);
    r.rect(ox + 34, oy + 29, 1, 11, wire);
    r.rect(ox + 44, oy + 29, 1, 11, wire);
    r.rect(ox + 44, oy + 40, 1, 9, wire);
  }

  // A hood closes over the hair.
  if (extras.includes('hood')) {
    const cloth = shade(coat, -0.32);
    for (let y = 4; y <= 24; y++) {
      const half = Math.min(22, 10 + Math.round((y - 4) * 0.86));
      const inner = Math.round(headHalf(Math.max(y, 12), shape)) + 2;
      r.rect(ox + 32 - half, oy + y, Math.max(0, half - inner), 1, cloth);
      r.rect(ox + 32 + inner, oy + y, Math.max(0, half - inner), 1, cloth);
      if (y < 12) r.rect(ox + 32 - half, oy + y, half * 2, 1, cloth);
    }
    r.rect(ox + 20, oy + 8, 8, 1, shade(cloth, 0.2));
  }

  if (pal.hat) {
    const dark = rgba('#1d181c');
    if (pal.hat === 'top') {
      r.rect(ox + 8, oy + 12, 48, 3, dark);
      r.rect(ox + 17, oy + 1, 30, 12, dark);
      r.rect(ox + 17, oy + 9, 30, 3, rgba(pal.accent));
    } else if (pal.hat === 'bowler') {
      r.rect(ox + 12, oy + 13, 40, 3, dark);
      r.rect(ox + 10, oy + 14, 44, 1, shade(dark, 0.3)); // curled brim
      r.roundRect(ox + 19, oy + 4, 26, 11, 6, dark);
      r.rect(ox + 19, oy + 11, 26, 2, rgba(pal.accent));
    } else if (pal.hat === 'custodian') {
      r.rect(ox + 18, oy + 2, 28, 12, rgba('#20242e'));
      r.rect(ox + 16, oy + 6, 32, 8, rgba('#20242e'));
      r.rect(ox + 12, oy + 13, 40, 3, rgba('#191d26'));
      r.rect(ox + 30, oy + 4, 4, 4, rgba(pal.accent));
    } else if (pal.hat === 'deerstalker') {
      r.roundRect(ox + 16, oy + 3, 32, 13, 5, dark);
      for (let y = 3; y < 16; y++) {
        for (let x = 16; x < 48; x++) {
          if ((x + y) % 4 === 0) r.px(ox + x, oy + y, shade(dark, 0.35)); // tweed
        }
      }
      r.rect(ox + 12, oy + 14, 40, 3, shade(dark, -0.2)); // front peak
      r.roundRect(ox + 10, oy + 6, 7, 9, 3, dark); // ear flaps
      r.roundRect(ox + 47, oy + 6, 7, 9, 3, dark);
    } else if (pal.hat === 'captain') {
      r.rect(ox + 17, oy + 5, 30, 8, dark);
      r.rect(ox + 15, oy + 11, 34, 4, shade(dark, 0.18)); // band
      r.rect(ox + 10, oy + 15, 44, 3, shade(dark, -0.3)); // peak
      r.rect(ox + 29, oy + 6, 6, 5, rgba(pal.accent)); // badge
      r.px(ox + 32, oy + 8, shade(rgba(pal.accent), -0.5));
    } else if (pal.hat === 'bonnet') {
      r.roundRect(ox + 14, oy + 4, 36, 12, 6, dark);
      r.rect(ox + 14, oy + 13, 36, 3, rgba(pal.accent));
      r.rect(ox + 44, oy + 14, 6, 8, rgba(pal.accent)); // trailing ribbon
    } else if (pal.hat === 'veil') {
      r.rect(ox + 16, oy + 4, 32, 10, dark);
      for (let y = 0; y < 24; y++)
        for (let x = 0; x < 34; x++)
          if ((x + y) % 2 === 0) r.px(ox + 15 + x, oy + 14 + y, rgba('#000000', 0.2));
    } else if (pal.hat === 'cap') {
      // Knitted watch cap: sits low, turned up at the edge, no peak.
      r.roundRect(ox + 16, oy + 4, 32, 12, 5, dark);
      r.rect(ox + 21, oy + 6, 10, 2, shade(dark, 0.28)); // sheen on the wool
      r.rect(ox + 15, oy + 14, 34, 4, shade(dark, 0.16)); // turn-up
      r.rect(ox + 15, oy + 14, 34, 1, shade(dark, 0.34));
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
