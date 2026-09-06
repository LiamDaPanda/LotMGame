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

  // ---- Volume I closes on the Aurora Order ---------------------------------
  // 18 — Ince Zangwill. Dark blonde, pupils so blue they read as black, a face
  // like a sculpture that has never once frowned, and blind in one eye.
  { id: 'zangwill', skin: '#e8c39c', hair: '#b09456', coat: '#2b2a38', accent: '#c8b06a', trouser: '#22212c', hat: null, scarf: null,
    hairStyle: 'slick', eyes: '#1d2a52', head: 'long', eyeShape: 'sharp', mouth: 'small', brow: 1, back: '#2a2836', extras: ['blindEye', 'collar'] },

  // ---- Volume II: Backlund ------------------------------------------------
  // 19 — Ian Wright, who brings the commission that starts everything.
  { id: 'wright', skin: '#f1cba8', hair: '#4a3a2c', coat: '#3f4a3a', accent: '#c2b48a', trouser: '#333c2e', hat: 'bowler', scarf: null,
    hairStyle: 'parted', eyes: '#5f7a4e', head: 'oval', eyeShape: 'weary', mouth: 'frown', back: '#333e30', extras: ['collar', 'moustache'] },
  // 20 — Old Kohler of the East Borough, who has worked since he was nine.
  { id: 'kohler', skin: '#d8ab84', hair: '#8e8880', coat: '#4a4038', accent: '#8a7a60', trouser: '#38302a', hat: 'flat', scarf: '#6a5a48',
    hairStyle: 'balding', eyes: '#6a6258', head: 'square', eyeShape: 'weary', mouth: 'grim', back: '#3c342c', extras: ['stubble', 'age'] },
  // 21 — Liz, who is eleven and keeping the accounts.
  { id: 'liz', skin: '#f2cfb2', hair: '#a06a38', coat: '#6a5a72', accent: '#e0b8c8', trouser: '#4a3f52', hat: null, scarf: null,
    hairStyle: 'halfup', eyes: '#7a5a38', head: 'soft', eyeShape: 'wide', mouth: 'small', back: '#4a4058', extras: ['freckles', 'ribbon'] },
  // 22 — Capim, who sells people and keeps a ledger of it.
  { id: 'capim', skin: '#b98a60', hair: '#221c18', coat: '#4a2a2a', accent: '#a86a4a', trouser: '#2e1e1e', hat: null, scarf: null,
    hairStyle: 'slick', eyes: '#3a2a1e', head: 'round', eyeShape: 'narrow', mouth: 'smirk', brow: -1, browThick: 2, back: '#3a2424', extras: ['goatee', 'earring'] },
  // 23 — Lanevus, who would like to introduce the world to its Creator.
  { id: 'lanevus', skin: '#e0c8b4', hair: '#3a3242', coat: '#2c2438', accent: '#8a6ac0', trouser: '#241e30', hat: null, scarf: '#5a4a80',
    hairStyle: 'straightLong', eyes: '#8a6ac0', head: 'gaunt', eyeShape: 'sunken', mouth: 'set', back: '#2e2640', extras: ['hood'] },

  // ---- Volume III: the sea ------------------------------------------------
  // 24 — Cattleya, Admiral of Stars, who is owed favours by four flags.
  { id: 'cattleya', skin: '#eec6a4', hair: '#d8d2c0', coat: '#2f4258', accent: '#9fc4dc', trouser: '#26364a', hat: 'captain', scarf: '#6a8aa8',
    hairStyle: 'long', eyes: '#4a7a9a', head: 'soft', eyeShape: 'sharp', mouth: 'smirk', back: '#2a3c50', extras: ['earring'] },
  // 25 — Bernadette Gustav, with her ancestor's chestnut curls.
  { id: 'bernadette', skin: '#f4d2b6', hair: '#8a5a34', coat: '#5a2a3a', accent: '#e0c078', trouser: '#42202c', hat: null, scarf: null,
    hairStyle: 'curly', eyes: '#4a6ea8', head: 'soft', eyeShape: 'soft', mouth: 'smile', back: '#4a2634', extras: ['lace', 'ribbon'] },
  // 26 — Frank Lee, who keeps things in jars and is delighted about all of it.
  { id: 'franklee', skin: '#eec9a8', hair: '#3a4a3a', coat: '#5a6a4a', accent: '#b8c88a', trouser: '#3f4a36', hat: null, scarf: null,
    hairStyle: 'messy', eyes: '#6a9a5a', head: 'long', eyeShape: 'wide', mouth: 'smile', back: '#3e4a36', extras: ['glasses'] },
  // 27 — Anderson Hood, who hunts what other people run from.
  { id: 'anderson', skin: '#c4915f', hair: '#4a2a18', coat: '#4a3a28', accent: '#a88a5a', trouser: '#382c1e', hat: 'flat', scarf: '#7a5a3a',
    hairStyle: 'short', eyes: '#8a6a3a', head: 'square', eyeShape: 'narrow', mouth: 'set', browThick: 2, back: '#3c3024', extras: ['beard'] },

  // ---- Volume IV: the Foggy Town and the Southern Continent ----------------
  // 28 — Zaratul: a black hooded robe, eyes like water with no light in it, and
  // a long dense white beard.
  { id: 'zaratul', skin: '#cdb49c', hair: '#e8e4dc', coat: '#1e1c26', accent: '#7a6a9a', trouser: '#171620', hat: null, scarf: null,
    hairStyle: 'wispy', eyes: '#1a1a24', head: 'gaunt', eyeShape: 'sunken', mouth: 'set', back: '#232030', extras: ['hood', 'fullbeard', 'age'] },
  // 29 — Mr. A, of the Numinous Episcopate, who has no other name on file.
  { id: 'mister_a', skin: '#d6bfae', hair: '#1a1a1a', coat: '#3a2c3a', accent: '#c0392b', trouser: '#2a2028', hat: 'top', scarf: null,
    hairStyle: 'slick', eyes: '#8a2a2a', head: 'long', eyeShape: 'sharp', mouth: 'smirk', brow: -1, back: '#332632', extras: ['monocle'] },

  // ---- Volume V: the Crown ------------------------------------------------
  // 30 — George III of Loen, giving the speech of his life, for once literally.
  { id: 'george', skin: '#f0cba6', hair: '#9a8a6a', coat: '#5a2030', accent: '#d4b046', trouser: '#421823', hat: 'crown', scarf: '#c9a227',
    hairStyle: 'wavy', eyes: '#5a7a9a', head: 'round', eyeShape: 'level', mouth: 'set', browThick: 2, back: '#4a1e2c', extras: ['moustache', 'cravat', 'age'] },

  // ---- Volumes VI and VII -------------------------------------------------
  // 31 — Amon. Short semi-curly black hair, pure black eyes, a pointed hat, a
  // classical mage's robe, and a crystal monocle he does not need.
  { id: 'amon', skin: '#f4e2d0', hair: '#141218', coat: '#2a2440', accent: '#c8a8e0', trouser: '#221e34', hat: 'pointed', scarf: null,
    hairStyle: 'curly', eyes: '#0d0d12', head: 'long', eyeShape: 'sharp', mouth: 'smile', back: '#2e2748', extras: ['monocle'] },
  // 32 — Emperor Roselle Gustav: long chestnut curls, blue eyes, a high bridge,
  // thin lips, and a moustache he plainly had opinions about.
  { id: 'roselle', skin: '#eec5a2', hair: '#7a4a28', coat: '#5a2018', accent: '#c9a227', trouser: '#3f1810', hat: null, scarf: null,
    hairStyle: 'curly', eyes: '#3a6ab0', head: 'long', eyeShape: 'level', mouth: 'smirk', back: '#4a2018', extras: ['moustache', 'cravat'] },
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

/**
 * Every frame has to be drawable on its own.
 *
 * A sheet is one big raster, so a draw call that reaches past a frame's edge
 * lands on the neighbour instead of being clipped — which is how the
 * constable's helmet ended up under Old Neil's boots. Redraw each frame alone
 * and compare against the packed sheet: any difference is a spill.
 */
function assertNoFrameBleed(label, sheet, w, h, cols, rows, draw) {
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const solo = new Raster(w, h);
      draw(solo, 0, 0, col, row);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const packed = sheet.get(col * w + x, row * h + y);
          const alone = solo.get(x, y);
          for (let c = 0; c < 4; c++) {
            if (packed[c] === alone[c]) continue;
            throw new Error(
              `${label}: frame (${col}, ${row}) differs from its isolated render at ` +
                `${x},${y} — a draw call is reaching outside the frame`,
            );
          }
        }
      }
    }
  }
}

function buildCharacterSheet() {
  const cols = DIRS.length * STEPS;
  const frame = (target, ox, oy, col, row) => {
    const pal = CAST[row];
    if (!pal) return;
    drawChibi(target, ox, oy, Math.floor(col / STEPS), col % STEPS, pal);
    outlineFrame(target, ox, oy, FRAME_W, FRAME_H, rgba('#120e12', 0.85));
  };
  const sheet = new Raster(cols * FRAME_W, CAST.length * FRAME_H);
  for (let row = 0; row < CAST.length; row++) {
    for (let col = 0; col < cols; col++) frame(sheet, col * FRAME_W, row * FRAME_H, col, row);
  }
  assertNoFrameBleed('characters', sheet, FRAME_W, FRAME_H, cols, CAST.length, frame);
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

/**
 * Vertical layout of the face, in rows of the 64x64 frame.
 *
 * One place, because the proportions only work as a set: the crown, the eye
 * line and the chin have to move together, or the head turns into a forehead
 * with a face hanging off the bottom of it. Everything below is measured from
 * these three numbers — hair from the crown, brows and ears from the eye line,
 * nose, mouth, beard and neck from the chin — so the whole cast keeps its
 * proportions when any one of them is tuned.
 *
 * The eye line sits a little under halfway down the skull: lower than life,
 * which is what makes a face read as drawn rather than measured, but not so
 * low that there is no room left underneath for a nose, a mouth and a jaw.
 */
const HEAD_TOP = 10;
const EYE_LINE = 28; // top of the eye opening for a level eye
const SHOULDER_TOP = 49;

/** How far down the chin reaches, per face shape. */
const CHIN = { oval: 44, long: 46, round: 44, square: 45, gaunt: 45, soft: 43 };

/**
 * Half-width of the head at a given row, measured from the centre line.
 *
 * The bands below the temples are measured back from the chin rather than
 * fixed, so a long face lengthens the jaw instead of stretching the skull.
 */
function headHalf(y, shape = 'oval') {
  const chin = CHIN[shape] ?? 44;
  if (y < HEAD_TOP || y > chin) return 0;
  let half;
  if (y <= 14) half = 8 + (y - HEAD_TOP);                      // crown
  else if (y <= 19) half = 12 + (y - 15) * 0.5;                // temple
  else if (y <= chin - 15) half = 14;                          // widest, at the eyes
  else if (y <= chin - 9) half = 14 - (y - (chin - 15)) * 0.7; // cheek
  else if (y <= chin - 3) half = 9.8 - (y - (chin - 9)) * 0.8; // jaw
  else half = 5;                                               // chin
  switch (shape) {
    case 'round':
      half *= y >= chin - 18 ? 1.12 : 1.05;
      break;
    case 'long':
      half *= 0.9;
      if (y >= chin - 9) half += 1.4;
      break;
    case 'square':
      if (y >= chin - 13) half = Math.max(half, y <= chin - 4 ? 11 : 8);
      break;
    case 'gaunt':
      half *= y >= chin - 17 && y <= chin - 7 ? 0.84 : 0.94;
      break;
    case 'soft':
      half *= 0.95;
      if (y >= chin - 9) half *= 0.86;
      break;
    default:
      break;
  }
  return half;
}

function fillHead(r, ox, oy, shape, skin, shadow) {
  const chin = CHIN[shape] ?? 44;
  for (let y = HEAD_TOP; y <= chin; y++) {
    const half = Math.round(headHalf(y, shape));
    if (half <= 0) continue;
    r.rect(ox + 32 - half, oy + y, half * 2, 1, skin);
  }
  // Form: a soft shadow down the right-hand side and under the jaw.
  for (let y = EYE_LINE - 3; y <= chin - 4; y++) {
    const half = Math.round(headHalf(y, shape));
    if (half <= 3) continue;
    r.rect(ox + 32 + half - 1, oy + y, 1, 1, shadow);
  }
  const jaw = Math.round(headHalf(chin - 2, shape));
  r.rect(ox + 32 - jaw, oy + chin - 2, jaw * 2, 1, shadow);
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
  for (let y = Math.max(top, HEAD_TOP); y <= bottom; y++) {
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
  for (let y = HEAD_TOP; y <= bottom; y++) {
    const half = Math.round(headHalf(y, shape)) + (y > HEAD_TOP + 3 ? 1 : 0);
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
  level: { top: EYE_LINE, h: 6, lash: 1 },
  wide: { top: EYE_LINE - 1, h: 7, lash: 1 },
  narrow: { top: EYE_LINE + 1, h: 4, lash: 2 },
  sunken: { top: EYE_LINE + 1, h: 5, lash: 1 },
  soft: { top: EYE_LINE, h: 6, lash: 2 },
  sharp: { top: EYE_LINE, h: 5, lash: 2 },
  weary: { top: EYE_LINE + 1, h: 5, lash: 1 },
  old: { top: EYE_LINE + 1, h: 4, lash: 2 },
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
    r.ellipse(ox + 32, oy + 28, ring, ring - 4, shade(back, -0.15));
  }

  // A hood is a shape behind everything, including the hair.
  if (extras.includes('hood')) {
    for (let y = 5; y < 64; y++) {
      const half = Math.min(29, 14 + Math.round((y - 5) * 0.72));
      r.rect(ox + 32 - half, oy + y, half * 2, 1, shade(coat, -0.5));
    }
  }

  // Hair that falls behind the shoulders goes down before them.
  if (behind) {
    const drop = style === 'halfup' ? 54 : 60;
    for (let y = 15; y <= drop; y++) {
      const spread = Math.min(19, 15 + Math.round((y - 15) / 7));
      r.rect(ox + 32 - spread, oy + y, spread * 2, 1, hairDark);
    }
  }

  // Neck: about half the width of the head, and short — a long thin one turns
  // every bust into a bird. Lit like the face, so it reads as part of the same
  // person rather than a dark column holding the head up.
  // It leaves the head as wide as the jaw and spreads as it goes, so there is
  // no step where the two meet; a straight column reads as a plinth with a
  // head balanced on it. The row just below the chin is in its shadow.
  for (let y = chin - 2; y <= SHOULDER_TOP + 1; y++) {
    const half = Math.round(Math.min(7, 5 + (y - (chin - 2)) * 0.35));
    const x = ox + 32 - half;
    r.rect(x, oy + y, half * 2, 1, y <= chin ? shade(skin, -0.28) : skin);
    r.px(x, oy + y, skinShade);
    r.px(x + half * 2 - 1, oy + y, shade(skin, -0.26));
  }

  // Shoulders: a trapezoid, not a pill, with a collar cut into it.
  for (let y = SHOULDER_TOP; y < 64; y++) {
    const half = Math.min(30, 13 + (y - SHOULDER_TOP) * 2.4);
    r.rect(ox + 32 - Math.round(half), oy + y, Math.round(half) * 2, 1, coat);
  }
  // Collar: two short lapels meeting at the throat.
  for (let i = 0; i < 5; i++) {
    r.rect(ox + 24 - i, oy + SHOULDER_TOP + 3 + i, 5, 1, shade(coat, 0.2));
    r.rect(ox + 35 + i, oy + SHOULDER_TOP + 3 + i, 5, 1, shade(coat, 0.2));
  }
  if (pal.scarf) r.rect(ox + 26, oy + SHOULDER_TOP + 1, 12, 3, rgba(pal.scarf));
  if (extras.includes('collar')) {
    r.rect(ox + 26, oy + SHOULDER_TOP + 1, 12, 2, WHITE);
    r.rect(ox + 30, oy + SHOULDER_TOP + 3, 4, 5, rgba(pal.accent));
  }
  if (extras.includes('cravat')) {
    r.rect(ox + 25, oy + SHOULDER_TOP + 1, 14, 4, WHITE);
    r.rect(ox + 29, oy + SHOULDER_TOP + 2, 6, 6, rgba(pal.accent));
    r.px(ox + 32, oy + SHOULDER_TOP + 4, shade(rgba(pal.accent), -0.4));
  }
  if (extras.includes('lace')) {
    r.rect(ox + 25, oy + SHOULDER_TOP + 2, 14, 1, rgba('#efe6d6'));
    for (let x = 25; x < 39; x += 3) {
      r.rect(ox + x, oy + SHOULDER_TOP + 3, 2, 1, rgba('#efe6d6'));
      r.px(ox + x + 2, oy + SHOULDER_TOP + 3, rgba('#c0b5a2'));
    }
  }

  fillHead(r, ox, oy, shape, skin, skinShade);
  // Ears, straddling the eye line.
  const earHalf = Math.round(headHalf(EYE_LINE + 2, shape));
  r.rect(ox + 32 - earHalf - 2, oy + EYE_LINE - 1, 2, 6, skinShade);
  r.rect(ox + 32 + earHalf, oy + EYE_LINE - 1, 2, 6, skinShade);
  if (extras.includes('earring')) {
    r.px(ox + 32 + earHalf + 1, oy + EYE_LINE + 5, rgba('#e0c060'));
    r.px(ox + 32 + earHalf + 1, oy + EYE_LINE + 6, rgba('#c9a227'));
  }

  // Hair. Each style is a silhouette, not a recolour of the same one.
  switch (style) {
    case 'curtain': {
      // Centre part, sweeping longer toward the temples; long at the sides.
      fringe(r, ox, oy, shape, 19, hair, 0);
      for (const side of [-1, 1]) {
        for (let d = 4; d <= 16; d++) {
          const drop = Math.round((d - 4) * 0.55);
          r.rect(ox + 32 + side * d - (side < 0 ? 0 : 1), oy + 20, 1, 1 + drop, hair);
        }
      }
      r.rect(ox + 31, oy + HEAD_TOP, 2, 9, hairDark); // the parting
      r.rect(ox + 22, oy + 12, 8, 2, hairLit);
      r.rect(ox + 16, oy + 17, 4, 19, hair); // long at the sides
      r.rect(ox + 44, oy + 17, 4, 19, hair);
      r.rect(ox + 16, oy + 34, 4, 2, hairDark);
      r.rect(ox + 44, oy + 34, 4, 2, hairDark);
      break;
    }
    case 'receding': {
      hairCap(r, ox, oy, shape, HEAD_TOP, 18, 1, hair);
      // The hairline has retreated: bare temples and a high, rounded forehead.
      r.ellipse(ox + 32, oy + 15, 12, 4, skin);
      r.rect(ox + 24, oy + HEAD_TOP, 16, 3, hair);
      r.rect(ox + 26, oy + 11, 8, 1, hairLit);
      r.rect(ox + 16, oy + 14, 4, 16, hair);
      r.rect(ox + 44, oy + 14, 4, 16, hair);
      r.rect(ox + 19, oy + 15, 1, 15, hairDark); // edge against the temple
      r.rect(ox + 44, oy + 15, 1, 15, hairDark);
      break;
    }
    case 'balding': {
      // Bare crown, hair only round the sides and back.
      r.rect(ox + 16, oy + 18, 4, 14, hair);
      r.rect(ox + 44, oy + 18, 4, 14, hair);
      r.rect(ox + 19, oy + 17, 4, 2, hairDark);
      r.rect(ox + 41, oy + 17, 4, 2, hairDark);
      r.rect(ox + 16, oy + 30, 4, 2, hairDark);
      r.rect(ox + 44, oy + 30, 4, 2, hairDark);
      r.ellipse(ox + 29, oy + 14, 6, 3, shade(skin, 0.12)); // shine on the scalp
      break;
    }
    case 'wispy': {
      // Thin, and there is less of it every year: nothing over the forehead.
      hairCap(r, ox, oy, shape, HEAD_TOP, 15, 0, shade(hair, -0.06));
      for (let x = 18; x <= 46; x += 4) {
        r.rect(ox + x, oy + HEAD_TOP, 2, 4 + ((x * 5) % 4), x % 8 === 2 ? hairLit : hair);
      }
      for (const side of [-1, 1]) {
        for (let y = 13; y <= 31; y++) {
          const w = 3 + ((y * 3) % 3);
          r.rect(ox + 32 + side * 17 - (side < 0 ? 0 : w), oy + y, w, 1, y % 5 === 0 ? hairLit : hair);
        }
        r.rect(ox + 32 + side * 17 - (side < 0 ? 0 : 4), oy + 31, 4, 1, shade(hair, -0.3));
      }
      break;
    }
    case 'crop': {
      // Regulation short: a flat hairline and nothing over the ears.
      fringe(r, ox, oy, shape, 19, hair, 0);
      r.rect(ox + 17, oy + 19, 30, 1, hairDark);
      r.rect(ox + 22, oy + 12, 9, 2, hairLit);
      r.rect(ox + 16, oy + 20, 3, 7, hair);
      r.rect(ox + 45, oy + 20, 3, 7, hair);
      break;
    }
    case 'short': {
      fringe(r, ox, oy, shape, 20, hair, 3);
      r.rect(ox + 22, oy + 12, 9, 2, hairLit);
      r.rect(ox + 16, oy + 18, 3, 12, hair);
      r.rect(ox + 45, oy + 18, 3, 12, hair);
      break;
    }
    case 'messy': {
      // Uncombed for days: tufts going in four directions at once.
      fringe(r, ox, oy, shape, 19, hair, 4);
      for (const [x, top] of [[19, 5], [24, 3], [30, 6], [36, 2], [42, 5]]) {
        r.rect(ox + x, oy + top, 4, 11 - top, hair);
        r.px(ox + x + 1, oy + top - 1, hair);
      }
      r.rect(ox + 16, oy + 17, 3, 14, hairDark);
      r.rect(ox + 45, oy + 17, 3, 12, hairDark);
      r.rect(ox + 24, oy + 12, 6, 1, hairLit);
      break;
    }
    case 'slick': {
      // Combed straight back with something out of a jar; the sheen is the point.
      hairCap(r, ox, oy, shape, HEAD_TOP, 18, 0, hair);
      // Comb marks, not railings: at this contrast a dark line every three
      // pixels reads as a fence rather than as hair.
      for (let x = 19; x <= 45; x += 4) r.rect(ox + x, oy + HEAD_TOP + 1, 1, 7, shade(hair, -0.16));
      r.rect(ox + 20, oy + 12, 24, 1, hairLit);
      r.rect(ox + 17, oy + 18, 30, 1, hairDark);
      r.rect(ox + 16, oy + 17, 3, 10, hair);
      r.rect(ox + 45, oy + 17, 3, 10, hair);
      break;
    }
    case 'wavy': {
      // A poet's hair: a soft fringe and S-curves down past the ear.
      fringe(r, ox, oy, shape, 19, hair, 3);
      r.rect(ox + 23, oy + 11, 9, 2, hairLit);
      for (const side of [-1, 1]) {
        for (let y = 15; y <= 34; y++) {
          const wob = Math.round(Math.sin((y - 15) / 3.4) * 2);
          r.rect(ox + 32 + side * 15 - 2 + side * wob, oy + y, 5, 1, y % 5 === 0 ? shade(hair, 0.12) : hair);
        }
      }
      break;
    }
    case 'curly': {
      // Tight curls: overlapping bumps, no straight edge anywhere.
      for (let i = 0; i < 10; i++) {
        const a = (i / 9) * Math.PI;
        r.ellipse(ox + 32 - Math.round(Math.cos(a) * 16), oy + 15 - Math.round(Math.sin(a) * 7), 5, 5, hair);
      }
      fringe(r, ox, oy, shape, 18, hair, 0);
      for (let i = 0; i < 5; i++) r.ellipse(ox + 19 + i * 6, oy + 19, 4, 3, hair);
      r.ellipse(ox + 17, oy + 25, 4, 4, hair);
      r.ellipse(ox + 47, oy + 25, 4, 4, hair);
      r.ellipse(ox + 26, oy + 13, 3, 2, hairLit);
      r.ellipse(ox + 40, oy + 20, 2, 2, hairLit);
      break;
    }
    case 'bun': {
      // Swept up and wound at the back, with two tendrils left loose.
      r.ellipse(ox + 32, oy + 6, 9, 6, hairDark);
      r.ellipse(ox + 32, oy + 5, 6, 4, hair);
      hairCap(r, ox, oy, shape, HEAD_TOP, 17, 1, hair);
      for (let x = 19; x <= 45; x += 4) r.rect(ox + x, oy + HEAD_TOP, 1, 8, hairDark);
      r.rect(ox + 24, oy + 12, 7, 1, hairLit);
      r.rect(ox + 16, oy + 18, 3, 13, hair);
      r.rect(ox + 46, oy + 18, 3, 11, hair);
      break;
    }
    case 'halfup': {
      // Long, with the top half drawn back off the face.
      fringe(r, ox, oy, shape, 20, hair, 2);
      for (let i = 0; i < 8; i++) r.rect(ox + 25 + i, oy + 11 + Math.floor(i / 3), 2, 1, hairDark);
      r.rect(ox + 15, oy + 17, 5, 33, hair);
      r.rect(ox + 44, oy + 17, 5, 33, hair);
      r.rect(ox + 22, oy + 11, 8, 2, hairLit);
      break;
    }
    case 'long': {
      // Smooth, with a soft wave in it near the ends.
      fringe(r, ox, oy, shape, 20, hair, 3);
      for (const side of [-1, 1]) {
        for (let y = 15; y <= 56; y++) {
          const wob = Math.round(Math.sin((y - 15) / 8) * 2);
          r.rect(ox + 32 + side * 17 - 3 + side * wob, oy + y, 6, 1, y % 6 === 0 ? hairLit : hair);
        }
      }
      r.rect(ox + 23, oy + 11, 10, 2, hairLit);
      break;
    }
    case 'straightLong': {
      // Dead straight, parted centre, no wave at all.
      fringe(r, ox, oy, shape, 19, hair, 0);
      r.rect(ox + 31, oy + HEAD_TOP, 2, 10, hairDark);
      for (const side of [-1, 1]) {
        r.rect(ox + 32 + side * 19 - (side < 0 ? 0 : 5), oy + 15, 5, 40, hair);
      }
      r.rect(ox + 24, oy + 12, 6, 1, hairLit);
      break;
    }
    case 'swept': {
      // Back and up, theatrically: a high forehead and a raised crest.
      hairCap(r, ox, oy, shape, 7, 17, 1, hair);
      for (let i = 0; i < 6; i++) {
        const x = 19 + i * 5;
        r.rect(ox + x, oy + 7 + i, 4, 11 - i, i % 2 ? hair : hairLit);
      }
      r.rect(ox + 17, oy + 17, 4, 14, hair);
      r.rect(ox + 43, oy + 17, 4, 11, hair);
      r.rect(ox + 17, oy + 16, 30, 2, hairDark);
      break;
    }
    default: {
      fringe(r, ox, oy, shape, 20, hair, 3);
      r.rect(ox + 16, oy + 17, 3, 13, hair);
      r.rect(ox + 45, oy + 17, 3, 13, hair);
    }
  }

  if (extras.includes('sideburns')) {
    for (const side of [-1, 1]) {
      const x = 32 + side * (Math.round(headHalf(EYE_LINE - 4, shape)) - 1) - (side < 0 ? 0 : 2);
      r.rect(ox + x, oy + EYE_LINE - 8, 3, 13, hair);
      r.rect(ox + x + (side < 0 ? 0 : 1), oy + EYE_LINE + 5, 2, 3, hairDark);
    }
  }
  if (extras.includes('ribbon')) {
    const band = rgba(pal.accent);
    r.rect(ox + 22, oy + 13, 20, 1, band);
    r.rect(ox + 41, oy + 10, 5, 5, band);
    r.rect(ox + 44, oy + 13, 4, 4, shade(band, -0.22)); // trailing tail
    r.px(ox + 43, oy + 12, shade(band, -0.45));
  }

  drawPortraitEyes(r, ox, oy, pal, skin, skinShade, hair, eye);

  if (extras.includes('blindEye')) {
    // Blind in one eye: clouded over, with the scar that took it.
    const g = EYE_GEOM[pal.eyeShape ?? 'level'] ?? EYE_GEOM.level;
    const milk = rgba('#d8d2c6');
    r.rect(ox + 22, oy + g.top, 7, g.h, milk);
    r.rect(ox + 23, oy + g.top + g.lash, 5, Math.max(1, g.h - g.lash - 1), shade(milk, -0.12));
    r.rect(ox + 22, oy + g.top, 7, g.lash, INK);
    for (let i = 0; i < 7; i++) r.px(ox + 21 + i, oy + g.top - 3 + i, shade(skin, -0.45));
  }

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
    r.rect(ox + 24, oy + EYE_LINE, 1, 5, rgba('#b0202e', 0.8));
    r.rect(ox + 40, oy + EYE_LINE, 1, 5, rgba('#b0202e', 0.8));
  } else {
    const draw = MOUTHS[pal.mouth ?? 'set'] ?? MOUTHS.set;
    draw(r, ox, mouthY, shade(skin, -0.5), shade(skin, -0.28));
  }

  // Age, wear and marks.
  if (extras.includes('age')) {
    const line = shade(skin, -0.24);
    r.rect(ox + 25, oy + EYE_LINE - 6, 14, 1, line);
    r.rect(ox + 27, oy + EYE_LINE - 4, 10, 1, line);
    for (let i = 0; i < 3; i++) { // nasolabial folds
      r.px(ox + 28 - i, oy + chin - 6 + i, line);
      r.px(ox + 36 + i, oy + chin - 6 + i, line);
    }
  }
  if (extras.includes('scar')) {
    const line = shade(skin, -0.42);
    for (let i = 0; i < 8; i++) r.px(ox + 23 + i, oy + EYE_LINE - 8 + Math.floor(i / 2), line);
    r.px(ox + 25, oy + EYE_LINE - 9, shade(skin, -0.2));
  }
  if (extras.includes('freckles')) {
    const dot = shade(skin, -0.3);
    for (const [dx, dy] of [[-9, -8], [-6, -6], [-11, -5], [8, -8], [11, -6], [6, -5], [-2, -6], [3, -5]]) {
      r.px(ox + 32 + dx, oy + chin + dy, dot);
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
    r.rect(ox + 27, oy + chin - 6, 10, 2, hairDark);
    r.px(ox + 26, oy + chin - 5, hairDark);
    r.px(ox + 37, oy + chin - 5, hairDark);
  }
  if (extras.includes('goatee')) {
    r.rect(ox + 28, oy + chin - 6, 8, 1, hairDark);
    r.rect(ox + 30, oy + chin - 1, 5, 4, hairDark);
    r.rect(ox + 31, oy + chin - 2, 3, 1, hairDark);
  }
  if (extras.includes('mutton')) {
    for (const side of [-1, 1]) {
      for (let y = EYE_LINE - 7; y <= chin - 5; y++) {
        const half = Math.round(headHalf(y, shape));
        const w = y < EYE_LINE + 2 ? 2 : Math.min(5, 2 + Math.round((y - EYE_LINE - 2) * 0.6));
        const x = 32 + side * half - (side < 0 ? 0 : w);
        r.rect(ox + x, oy + y, w, 1, y % 3 === 0 ? hairDark : hair);
      }
    }
  }
  if (extras.includes('beard')) {
    // A trimmed beard: it hugs the jaw and closes under the chin.
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
  const lensY = EYE_LINE + 3;
  if (extras.includes('glasses')) {
    const wire = rgba('#cfc8bb');
    for (const ex of [ox + 25, ox + 39]) {
      r.rect(ex - 5, oy + lensY - 4, 10, 1, wire);
      r.rect(ex - 5, oy + lensY + 4, 10, 1, wire);
      r.rect(ex - 5, oy + lensY - 4, 1, 9, wire);
      r.rect(ex + 4, oy + lensY - 4, 1, 9, wire);
    }
    r.rect(ox + 30, oy + lensY - 1, 4, 1, wire);
    r.rect(ox + 15, oy + lensY - 3, 5, 1, wire);
    r.rect(ox + 44, oy + lensY - 3, 5, 1, wire);
  }
  if (extras.includes('roundGlasses')) {
    const wire = rgba('#d8cfae');
    for (const ex of [25, 39]) {
      circleRing(r, ox, oy, ex, lensY, 5, wire);
      r.px(ox + ex - 3, oy + lensY - 3, rgba('#ffffff', 0.55)); // glare
    }
    r.rect(ox + 30, oy + lensY, 4, 1, wire);
    r.rect(ox + 15, oy + lensY - 2, 5, 1, wire);
    r.rect(ox + 44, oy + lensY - 2, 5, 1, wire);
  }
  if (extras.includes('monocle')) {
    const wire = rgba('#c9a227');
    r.rect(ox + 34, oy + lensY - 5, 11, 1, wire);
    r.rect(ox + 34, oy + lensY + 5, 11, 1, wire);
    r.rect(ox + 34, oy + lensY - 5, 1, 11, wire);
    r.rect(ox + 44, oy + lensY - 5, 1, 11, wire);
    r.rect(ox + 44, oy + lensY + 6, 1, 9, wire);
  }

  // A hood closes over the hair.
  if (extras.includes('hood')) {
    const cloth = shade(coat, -0.32);
    for (let y = 3; y <= 23; y++) {
      const half = Math.min(22, 10 + Math.round((y - 3) * 0.86));
      const inner = Math.round(headHalf(Math.max(y, HEAD_TOP + 1), shape)) + 2;
      r.rect(ox + 32 - half, oy + y, Math.max(0, half - inner), 1, cloth);
      r.rect(ox + 32 + inner, oy + y, Math.max(0, half - inner), 1, cloth);
      if (y < HEAD_TOP + 1) r.rect(ox + 32 - half, oy + y, half * 2, 1, cloth);
    }
    r.rect(ox + 20, oy + 7, 8, 1, shade(cloth, 0.2));
  }

  if (pal.hat) {
    const dark = rgba('#1d181c');
    if (pal.hat === 'top') {
      r.rect(ox + 8, oy + 11, 48, 3, dark);
      r.rect(ox + 17, oy + 1, 30, 11, dark);
      r.rect(ox + 17, oy + 8, 30, 3, rgba(pal.accent));
    } else if (pal.hat === 'bowler') {
      r.rect(ox + 12, oy + 12, 40, 3, dark);
      r.rect(ox + 10, oy + 13, 44, 1, shade(dark, 0.3)); // curled brim
      r.roundRect(ox + 19, oy + 3, 26, 11, 6, dark);
      r.rect(ox + 19, oy + 10, 26, 2, rgba(pal.accent));
    } else if (pal.hat === 'custodian') {
      r.rect(ox + 18, oy + 1, 28, 12, rgba('#20242e'));
      r.rect(ox + 16, oy + 5, 32, 8, rgba('#20242e'));
      r.rect(ox + 12, oy + 12, 40, 3, rgba('#191d26'));
      r.rect(ox + 30, oy + 3, 4, 4, rgba(pal.accent));
    } else if (pal.hat === 'deerstalker') {
      r.roundRect(ox + 16, oy + 2, 32, 13, 5, dark);
      for (let y = 2; y < 15; y++) {
        for (let x = 16; x < 48; x++) {
          if ((x + y) % 4 === 0) r.px(ox + x, oy + y, shade(dark, 0.35)); // tweed
        }
      }
      r.rect(ox + 12, oy + 13, 40, 3, shade(dark, -0.2)); // front peak
      r.roundRect(ox + 10, oy + 5, 7, 9, 3, dark); // ear flaps
      r.roundRect(ox + 47, oy + 5, 7, 9, 3, dark);
    } else if (pal.hat === 'captain') {
      r.rect(ox + 17, oy + 4, 30, 8, dark);
      r.rect(ox + 15, oy + 10, 34, 4, shade(dark, 0.18)); // band
      r.rect(ox + 10, oy + 14, 44, 3, shade(dark, -0.3)); // peak
      r.rect(ox + 29, oy + 5, 6, 5, rgba(pal.accent)); // badge
      r.px(ox + 32, oy + 7, shade(rgba(pal.accent), -0.5));
    } else if (pal.hat === 'bonnet') {
      r.roundRect(ox + 14, oy + 3, 36, 12, 6, dark);
      r.rect(ox + 14, oy + 12, 36, 3, rgba(pal.accent));
      r.rect(ox + 44, oy + 13, 6, 8, rgba(pal.accent)); // trailing ribbon
    } else if (pal.hat === 'veil') {
      r.rect(ox + 16, oy + 3, 32, 10, dark);
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 34; x++) {
          if ((x + y) % 2 === 0) r.px(ox + 15 + x, oy + 13 + y, rgba('#000000', 0.2));
        }
      }
    } else if (pal.hat === 'cap') {
      // Knitted watch cap: sits low, turned up at the edge, no peak.
      r.roundRect(ox + 16, oy + 3, 32, 12, 5, dark);
      r.rect(ox + 21, oy + 5, 10, 2, shade(dark, 0.28)); // sheen on the wool
      r.rect(ox + 15, oy + 13, 34, 4, shade(dark, 0.16)); // turn-up
      r.rect(ox + 15, oy + 13, 34, 1, shade(dark, 0.34));
    } else if (pal.hat === 'flat') {
      r.rect(ox + 17, oy + 7, 30, 7, dark);
      r.rect(ox + 13, oy + 13, 38, 3, shade(dark, -0.2));
    } else if (pal.hat === 'pointed') {
      // A classical mage's hat: a wide brim and a cone that leans.
      r.rect(ox + 8, oy + 12, 48, 3, dark);
      for (let y = 0; y <= 11; y++) {
        // Narrow at the point, widening to the brim, and leaning as it goes.
        const half = Math.round(1 + y * 1.25);
        r.rect(ox + 32 - half + Math.round((11 - y) * 0.45), oy + y + 1, half * 2, 1, dark);
      }
      r.rect(ox + 18, oy + 9, 28, 3, rgba(pal.accent));
      r.px(ox + 30, oy + 2, shade(dark, 0.4));
    } else if (pal.hat === 'crown') {
      // Points, and a band of stones, and no attempt at modesty.
      const gold = rgba('#d4b046');
      r.rect(ox + 18, oy + 10, 28, 4, gold);
      r.rect(ox + 18, oy + 13, 28, 1, shade(gold, -0.35));
      for (let i = 0; i < 5; i++) {
        const x = 19 + i * 6;
        for (let h = 0; h <= 5; h++) {
          const w = Math.max(1, 4 - h);
          r.rect(ox + x + Math.floor((4 - w) / 2), oy + 9 - h, w, 1, gold);
        }
        r.px(ox + x + 1, oy + 11, rgba(pal.accent));
      }
    }
  }

  // Frame.
  r.rect(ox, oy, 64, 1, rgba('#c9a227', 0.7));
  r.rect(ox, oy + 63, 64, 1, rgba('#c9a227', 0.7));
  r.rect(ox, oy, 1, 64, rgba('#c9a227', 0.7));
  r.rect(ox + 63, oy, 1, 64, rgba('#c9a227', 0.7));
}

function buildPortraitSheet() {
  const frame = (target, ox, oy, col) => {
    const pal = CAST[col];
    if (pal) drawPortrait(target, ox, oy, pal);
  };
  const sheet = new Raster(64 * CAST.length, 64);
  for (let i = 0; i < CAST.length; i++) frame(sheet, i * 64, 0, i);
  assertNoFrameBleed('portraits', sheet, 64, 64, CAST.length, 1, frame);
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
