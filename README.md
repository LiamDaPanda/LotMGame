# The Tarot Club

A 2D gaslamp investigation game inspired by **Lord of the Mysteries**. You are the
newest member of a secret society, working as a private investigator while
concealing that you are a Beyonder — and climbing the Sequence ladder from 9
toward 1, one rite at a time.

**A non-commercial fan project.** Not affiliated with the author of Lord of the
Mysteries or its publishers. All code, writing and design are original; the
environment art is Kenney's CC0 tileset. See [CREDITS.md](CREDITS.md).

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
  clues, 7 deductions, 5 lines of inquiry and **five distinct endings** (clean,
  messy, partial, blackmail, failed), each with different money, trust and story
  consequences.
- **One pathway**, the Seer, across four Sequence tiers (9 → 6) with 15
  abilities — targeted ones used on things, and self-directed ones you fire from
  the powers menu whenever you like.
- **Five locations**: the Club parlour, Ashfen Row, Halloway's pawnshop, the
  coal cellar, and Crookback Alley.
- **Six random encounters** that fire on arrival — a Church watcher, three men
  in an alley, a fence's invitation, a thin place in the world.
- **Four trainable skills**, a black market, and legwork you pay for.
- **Full loop**: accept a case → search, question and pay for information →
  connect it on the deduction board → choose how to close it → spend the fee on
  tuition and the next rank-up.

### Four ways to learn something

The investigation deliberately has more than one route, so being short of one
resource never dead-ends you:

| Route | Costs | Screen |
|---|---|---|
| Search a scene | spirituality, concealment | Examine panel |
| Question a person | an ability, a clue, or a bribe | Dialogue |
| Follow a lead | money, days, a skill check | Lines of Inquiry |
| Buy your way in | money, concealment | Crookback Alley |

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

**Skills are bought, never ground.** Observation, Rhetoric, Occultism and
Streetwise are trained at the Club for money and a day each. Every level has a
stated, checkable effect — Occultism cuts spirituality costs 4% a point,
Rhetoric cuts bribes by the same, Streetwise moves a fence's price — so the fee
buys something you can watch happen rather than an abstract number.

**Every roll shows its odds before you commit.** Leads and encounter options
print the exact percentage and which skill drives it. A hidden dice roll in an
investigation game reads as the game cheating, and watching that number move is
the entire reward for training.

**Encounters are weighted by how exposed you are.** Arriving somewhere can put a
person in front of you, and the dangerous ones scale with burnt concealment. Use
power in public often enough and the city starts noticing back — which turns the
concealment meter from a number into something that happens to you.

**The black market is a real trade-off, not a second shop.** The fence sells
what the Club won't touch — picks, doubtful reagents, a forged warrant, a
cut-price copied formula — pays over the odds for awkward goods, and charges
concealment for every transaction. Streetwise moves both prices in your favour.

**The temptation is always on screen.** Rank-up needs a case closed, a formula, a
potion, and a *digested* previous potion. The shortcut — drink before the role
has finished settling — is permanently visible in the rite screen with its cost
spelled out (−18 sanity, −12 concealment, 35% chance of losing control). It
works. That's the problem.

## Layout

```
public/
  assets/          built art — tileset from Kenney (CC0), rest generated
  data/            all game content — edit these, no rebuild of logic needed
    index.json       the manifest of what to load
    pathways/ abilities/ cases/ maps/ dialogue/ encounters/ items/ characters/
src/
  systems/         GameState, Money, Skills, AbilitySystem, Progression,
                   CaseSystem, DialogueSystem, EncounterSystem, InquirySystem,
                   Content, SaveManager, EventBus
  scenes/          Boot, Preload, MainMenu, World, Hud, Dialogue, Examine,
                   Journal, CaseBoard, Shop, Ritual, Resolve, AbilityMenu,
                   Encounter, Training, Inquiry
  world/           TileGrid (ASCII → tiles + BFS pathfinding), Actor
  ui/              theme + Phaser widgets (Button, Meter, ScrollList, Typewriter)
art-src/           vendored CC0 source art (Kenney), for reproducible repacks
tools/
  generate-art.mjs   draws characters, portraits, icons, app icons
  import-tiles.mjs   repacks Kenney's CC0 tileset into the game's layout
  validate-data.mjs  content integrity checks
  playtest.mjs       drives a real browser through the whole slice
```

`WorldScene` renders the hub and case locations alike — mechanically they are
the same thing, a tile room with people, things and exits, so there is one
scene rather than two that drift apart.

## Art

**Environment — real, downloaded, CC0.** Every floor, wall, door, window and
prop comes from [Kenney's Roguelike/RPG pack](https://kenney.nl/assets/roguelike-rpg-pack),
which is Creative Commons Zero: free to use, modify and redistribute, no
attribution required (credited in [CREDITS.md](CREDITS.md) regardless).

The upstream 16px sheet is vendored at `art-src/` and repacked into the game's
32px layout by an importer:

```bash
npm run tiles
```

`tools/import-tiles.mjs` holds a table mapping each of the game's tile slots to
a source tile, with optional layering, tinting and shading — that's how one grey
stone becomes both a gaslit street and a dank cellar. **To restyle the world,
edit that table.** Not the maps, not the code: map JSON keeps referring to slot
8 for "brick wall" whatever you point slot 8 at.

**Characters, portraits, icons — generated for this project.**

```bash
npm run art
```

`tools/generate-art.mjs` draws the 12-character walk-cycle spritesheet, the
64×64 dialogue portraits, the UI icon sheet and the PWA icons: chibi/anime
proportions, oversized heads, big eyes with a highlight, flat colour with one
rim shade. It is deterministic and dependency-free (`tools/png.mjs` is a small
PNG codec and rasterizer), and the cast palette table at the top is the fastest
thing to tweak.

These are placeholders in *quality*, not in licence — which is why they are
still here. No free pack supplies what this cast needs: twelve distinguishable
Victorian characters (a constable's helmet, a widow's veil, top hats) with
4-direction walk cycles *and* matching 64×64 portraits, under a licence that
permits committing the files to a public repo. Most "free" anime/chibi packs on
itch.io allow use but forbid redistribution, which rules them out.

**Replacing them needs no code change** — match the dimensions in
`public/assets/art-manifest.json`; the game reads frames by index. Options:

- **AI generation** — generate at the sheet dimensions above and keep frame
  geometry exact; a sheet off by a pixel will tear.
- **[LPC / Liberated Pixel Cup](https://sanderfrenken.github.io/Universal-LPC-Spritesheet-Character-Generator/)** —
  a layered generator with Victorian coats and hats, redistributable under
  CC-BY-SA 3.0 / GPL 3.0. Realistic proportions, not chibi, and the share-alike
  terms carry through.
- **[OpenGameArt](https://opengameart.org)** — filter to CC0; licence varies per
  submission.

Whatever you add, record its licence in [CREDITS.md](CREDITS.md).

## Development

```bash
npm run dev              # dev server
npm run typecheck        # tsc, strict
npm run validate:data    # content integrity
npm run build            # typecheck + production build to dist/
npm run art              # regenerate characters, portraits, icons
npm run tiles            # repack the Kenney tileset
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

## Adding an encounter or a lead

**An encounter**: append to `public/data/encounters/street.json` (or add a file
and name it in `index.json`). Give it a `weight`, the `maps` it can occur on,
and options — each option may need an ability, cost money, or roll a
`check: { skill, base, perPoint }`. Set `suspicionWeighted: true` to make it
scale with exposure. The validator refuses an encounter where every option is
gated, because a player with nothing must always be able to leave.

**A lead**: add to the case's `leads` array — a `method`, a cost in money and/or
days, a skill check, and the clues it grants. The validator warns if a lead
costs nothing and cannot fail, since that is a free clue rather than legwork.

## Not yet built

The slice deliberately stops at one case and one pathway. Sequences 7 and 6 have
their abilities and requirements written but no content that grants their
formulae; dual-pathway at high rank, rival-faction pressure, and cases that
escalate with rank are structured for but not implemented.
