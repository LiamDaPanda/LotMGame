# The Tarot Club

A 2D gaslamp investigation game inspired by **Lord of the Mysteries**. You are the
newest member of a secret society, working as a private investigator while
concealing that you are a Beyonder — and climbing the Sequence ladder from 9
toward 1, one rite at a time.

**A non-commercial fan project.** Not affiliated with the author of Lord of the
Mysteries or its publishers. All code and art in this repository are original.

---

## Play it

```bash
npm install
npm run dev          # http://localhost:5173/LotMGame/
```

Push to `main` and GitHub Actions builds and publishes to GitHub Pages at
`https://<user>.github.io/LotMGame/`. Enable it once under
**Settings → Pages → Source → GitHub Actions**.

On iOS, open that URL in Safari and use **Share → Add to Home Screen**. The
manifest and meta tags are already set up, so it launches full-screen with no
browser chrome, in landscape, with the notch and home indicator respected.

## What's in the vertical slice

- **One case**, *The Ninth Bell* — a locked-room death on Ashfen Row, with 19
  clues, 7 deductions and **five distinct endings** (clean, messy, partial,
  blackmail, failed), each with different money, trust and story consequences.
- **One pathway**, the Seer, written across four Sequence tiers (9 → 6) with 11
  abilities split between investigation and danger uses.
- **Four locations**: the Club parlour, Ashfen Row, Halloway's pawnshop, and the
  coal cellar.
- **Full loop**: accept a case → gather clues → connect them on the deduction
  board → choose how to close it → spend the fee on the next rank-up.

## The decisions, and why

**Top-down with tap-to-move, not point-and-click.** One input model that works
identically under a mouse and a thumb. Tap anywhere to walk (BFS pathfinding
routes around furniture); tap a person, a door or a thing to walk over and
interact. Nothing needs a hover state or a right-click, which is what makes the
iOS target work without a separate control scheme. WASD/arrows and Space also
work on desktop.

**Data-driven content, loaded at runtime.** Everything in `public/data/` is
fetched as JSON, not bundled. Adding a case, pathway, map, item or conversation
means dropping a file in and naming it in `index.json` — no TypeScript changes.
`npm run validate:data` checks the whole content graph for dangling references,
unreachable clues, deductions that can never form, and maps whose rows don't
match their legend.

**Maps are ASCII.** A room is a block of readable text plus a legend, so editing
a floor plan is editing a picture of it:

```json
"legend": { "#": { "floor": 8, "collide": true }, ".": { "floor": 3 } },
"rows":   ["####################",
           "#..................#",
           "####################"]
```

**Money is integer pence, always.** 12 pence = 1 soli, 20 soli = 1 pound. Every
amount is stored as a whole number of pence so nothing ever rounds away, and
`Money.ts` formats it for display (`£9 12s 11d`), for flavour (`nine pounds,
twelve soli and eleven pence`), and physically (`1×£5 note, 3 soli coins and 4
coppers`) for shop and reward text.

**Power is available and usually the wrong move.** Abilities cost spirituality,
sanity, and — crucially — concealment, at full price when someone can see you
and a third when the room is empty. The examine panel prints that price before
you spend it, including whether you're being watched. Investigation is the
primary verb because using power is what makes you findable.

**The temptation is always on screen.** Rank-up needs a case closed, a formula, a
potion, and a *digested* previous potion. The shortcut — drink before the role
has finished settling — is permanently visible in the rite screen with its cost
spelled out (−18 sanity, −12 concealment, 35% chance of losing control). It
works. That's the problem.

## Layout

```
public/
  assets/          generated art (see tools/generate-art.mjs)
  data/            all game content — edit these, no rebuild of logic needed
    index.json       the manifest of what to load
    pathways/ abilities/ cases/ maps/ dialogue/ items/ characters/
src/
  systems/         GameState, Money, AbilitySystem, Progression, CaseSystem,
                   DialogueSystem, Content, SaveManager, EventBus
  scenes/          Boot, Preload, MainMenu, World, Hud, Dialogue, Examine,
                   Journal, CaseBoard, Shop, Ritual, Resolve
  world/           TileGrid (ASCII → tiles + BFS pathfinding), Actor
  ui/              theme + Phaser widgets (Button, Meter, ScrollList, Typewriter)
tools/
  generate-art.mjs   regenerates every image the game loads
  validate-data.mjs  content integrity checks
  playtest.mjs       drives a real browser through the whole slice
```

`WorldScene` renders the hub and case locations alike — mechanically they are
the same thing, a tile room with people, things and exits, so there is one
scene rather than two that drift apart.

## Art

Chibi/anime placeholders — oversized heads, big eyes with a highlight, flat
colour with one rim shade — generated by a script rather than committed as
opaque binaries:

```bash
npm run art
```

`tools/generate-art.mjs` writes a 12-character walk-cycle spritesheet, 64×64
dialogue portraits, a 32-tile tileset, a 16-icon UI sheet, and the PWA icons.
It is deterministic, dependency-free (`tools/png.mjs` is a small PNG encoder and
rasterizer), and the cast palettes at the top of the file are the fastest thing
to tweak.

**Replacing them with real art** needs no code change — match the dimensions in
`public/assets/art-manifest.json`. If you'd rather draw or source than generate:

- **Kenney** (kenney.nl) — CC0, no attribution required. *Tiny Dungeon*,
  *Roguelike/RPG Pack* and *Tiny Town* have usable Victorian-adjacent interiors.
- **OpenGameArt** — filter to CC0/CC-BY. Search "LPC" for a large consistent
  32×32 top-down set with matching character generators.
- **itch.io** free asset packs — search "victorian tileset" or "gaslamp";
  check each pack's licence, as they vary.
- **LPC Character Generator** (sanderfrenken.github.io/Universal-LPC-Spritesheet-Character-Generator)
  builds layered top-down characters if you want more cast variety.

For AI-generated art, generate at the sheet dimensions above and keep frame
geometry exact — the game reads frames by index, so a sheet that is off by a
pixel will tear.

## Development

```bash
npm run dev              # dev server
npm run typecheck        # tsc, strict
npm run validate:data    # content integrity
npm run build            # typecheck + production build to dist/
npm run art              # regenerate placeholder art
npm run playtest         # drive a browser through the full slice (needs dev server)
```

`npm run playtest` boots a real Chromium, plays the case from accepting it to
advancing to Sequence 8, asserts ~50 behaviours (money deducted for a bribe,
concealment spent on a power, locked containers staying shut, the clean solve
unlocking only with all five deductions), and drops annotated screenshots in
`/tmp/playtest`.

The whole UI is canvas, so `window.__game` is exposed for the browser console:

```js
__game.scene.getScenes(true)[0].registry.get('session').state   // live game state
```

## Adding content

**A new case**: write `public/data/cases/<id>.json`, add clues to hotspots in a
map file or to dialogue node effects, list the id in `index.json`, run
`npm run validate:data`.

**A new pathway**: `public/data/pathways/<id>.json` plus an abilities file. The
sequence ladder, stat ceilings, advancement requirements and temptation costs
are all data. Set `GameState.pathwayId` to start on it.

**A new room**: `public/data/maps/<id>.json` — legend, ASCII rows, spawn,
hotspots, npcs, exits. The validator checks that every hotspot is reachable,
every exit lands on a walkable tile, and nothing shares a tile.

## Not yet built

The slice deliberately stops at one case and one pathway. Sequences 7 and 6 have
their abilities and requirements written but no content that grants their
formulae; dual-pathway at high rank, rival-faction pressure, and cases that
escalate with rank are structured for but not implemented.
