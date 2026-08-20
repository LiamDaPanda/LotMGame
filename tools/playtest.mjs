#!/usr/bin/env node
// Drives a real browser through the vertical slice and asserts the game got
// where it should. The entire UI is a canvas, so this steers through the
// exposed Phaser instance (window.__game) rather than DOM selectors, and
// screenshots each beat for eyeballing.
//
//   npm run build && npm run preview &   # serves /LotMGame/
//   node tools/playtest.mjs [baseUrl] [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:4173/LotMGame/';
const OUT = process.argv[3] ?? '/tmp/playtest';
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  pass   ${label}`);
  } else {
    console.log(`  FAIL   ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
};

// Use the pre-installed browser rather than downloading one.
const preinstalled = fs
  .readdirSync('/opt/pw-browsers')
  .filter((name) => name.startsWith('chromium-'))
  .map((name) => `/opt/pw-browsers/${name}/chrome-linux/chrome`)
  .find((candidate) => fs.existsSync(candidate));

const browser = await chromium.launch(preinstalled ? { executablePath: preinstalled } : {});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });

const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
};

/** Run a function inside the page with the Phaser game as its argument. */
const withGame = (fn, arg) =>
  page.evaluate(
    ({ source, arg }) => {
      const game = window.__game;
      // eslint-disable-next-line no-new-func
      return new Function('game', 'arg', `return (${source})(game, arg);`)(game, arg);
    },
    { source: fn.toString(), arg },
  );

const activeScenes = () =>
  withGame((game) => game.scene.getScenes(true).map((scene) => scene.scene.key));

const waitForScene = async (key, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const scenes = await activeScenes();
    if (scenes.includes(key)) return true;
    await page.waitForTimeout(120);
  }
  return false;
};

const session = () =>
  withGame((game) => {
    const s = game.scene.getScenes(true)[0]?.registry.get('session');
    if (!s) return null;
    return {
      sequence: s.state.sequence,
      pathway: s.state.pathwayId,
      sequenceTitle: s.state.sequenceTitle,
      awakened: s.state.awakened,
      chapter: s.story.current()?.id ?? null,
      chapterWhere: s.story.current()?.where ?? null,
      chaptersDone: s.story.completed().length,
      route: s.story.routeFrom(s.state.currentMap)?.toMap ?? null,
      rankLabel: s.state.rankLabel,
      abilities: s.state.knownAbilities(),
      digestion: s.state.digestion,
      sanity: s.state.sanity,
      spirituality: s.state.spirituality,
      concealment: s.state.concealment,
      pence: s.state.pence,
      day: s.state.day,
      map: s.state.currentMap,
      clues: [...s.state.clues],
      deductions: [...s.state.deductions],
      items: [...s.state.inventory.keys()],
      flags: [...s.state.flags],
      activeCase: s.state.activeCaseId() ?? null,
      skills: { ...s.state.skills },
      spentLeads: [...s.state.spentLeads],
      caseStates: Object.fromEntries([...s.state.cases].map(([k, v]) => [k, v.state])),
    };
  });

console.log(`\nPlaytest against ${BASE}\n`);

// ---------------------------------------------------------------------------
console.log('1. Boot and load content');
check('reached the main menu', await waitForScene('MainMenu'));
await shot('01-main-menu');
const loaded = await withGame((game) => {
  const s = game.scene.getScenes(true)[0].registry.get('session');
  return {
    pathways: s.content.pathways.size,
    abilities: s.content.abilities.size,
    cases: s.content.cases.size,
    maps: s.content.maps.size,
    dialogue: s.content.dialogue.size,
    encounters: s.content.encounters.size,
    items: s.content.items.size,
    characters: s.content.characters.size,
    chapters: s.content.chapters.length,
  };
});
check(
  'content loaded from JSON',
  loaded.cases === 1 &&
    loaded.maps === 7 &&
    loaded.pathways === 1 &&
    loaded.abilities === 15 &&
    loaded.chapters === 11 &&
    loaded.encounters === 6,
  JSON.stringify(loaded),
);

// ---------------------------------------------------------------------------
console.log('\n2. Wake up in your own room');
await withGame((game) => {
  const menu = game.scene.getScene('MainMenu');
  menu.newGame(false);
});
check('world scene started', await waitForScene('World'));
check('HUD launched', await waitForScene('Hud'));
check('the prologue plays itself', await waitForScene('Dialogue'));
await page.waitForTimeout(600);
await shot('02-lodgings');
let state = await session();
check('a run opens in Klein’s lodgings', state.map === 'lodgings', state.map);
check('starts at Sequence 9', state.sequence === 9);
check('starts with £2 10s', state.pence === 600, `${state.pence}d`);
check('starts part-digested', state.digestion === 55, `${state.digestion}`);
check('starts with skills at 1', Object.values(state.skills).every((v) => v === 1), JSON.stringify(state.skills));
check('starts as a mortal, whatever the ladder says', state.awakened === false, String(state.awakened));
check('and the chrome says so', state.rankLabel === 'No sequence - mortal', String(state.rankLabel));
check('with no Beyonder powers to reach for', state.abilities.length === 0, JSON.stringify(state.abilities));
check('and the story opens on its first chapter', state.chapter === 'ch_crimson', String(state.chapter));

// ---------------------------------------------------------------------------
console.log('\n2b. The prologue: sign on, and stay mortal a while longer');
// Walk the tree by choice text, the way a player does, rather than by index.
const speak = (label) =>
  withGame((game, wanted) => {
    const scene = game.scene.getScene('Dialogue');
    const choice = scene.node.choices.find((option) => option.text.includes(wanted));
    if (!choice) return { ok: false, have: scene.node.choices.map((o) => o.text) };
    scene.choose(choice.index);
    return { ok: true };
  }, label);

await speak('Look at what is on the desk');
await page.waitForTimeout(150);
await speak('Look at your hands');
await page.waitForTimeout(150);
await speak('Go to the window');
await page.waitForTimeout(150);
const studied = await speak('Think it through');
check('the prologue offers a considered opening', studied.ok, JSON.stringify(studied));
await page.waitForTimeout(150);
await speak('Somebody is knocking');
await page.waitForTimeout(150);
await speak('Eight days pass');
await page.waitForTimeout(150);
await speak('Read what you are signing');
await page.waitForTimeout(200);
await shot('02b-contracts');
await speak('Sign both');
await page.waitForTimeout(200);
state = await session();
check('signing on pays the first week', state.pence === 936, `${state.pence}d`);
check(
  'and he is still nobody at all',
  state.awakened === false && state.abilities.length === 0,
  `${state.awakened} / ${JSON.stringify(state.abilities)}`,
);

await speak('Quietly');
await page.waitForTimeout(300);
state = await session();
check(
  'the prologue closes the second chapter',
  state.chapter === 'ch_seventh_unit' && state.chaptersDone === 2,
  `${state.chapter} after ${state.chaptersDone}`,
);
check(
  'and the next one points at the Company',
  state.chapterWhere === 'club_hub',
  String(state.chapterWhere),
);
check(
  'and the way there is out of the front door',
  state.route === 'ashfen_row',
  String(state.route),
);
check(
  'the disposition option trained a skill',
  state.skills.streetwise === 2 && state.skills.occultism === 2,
  JSON.stringify(state.skills),
);

await withGame((game) => {
  game.scene.stop('Dialogue');
  const world = game.scene.getScene('World');
  if (world.scene.isPaused()) world.scene.resume();
});
await page.waitForTimeout(400);
await withGame((game) => {
  const s = game.scene.getScenes(true)[0].registry.get('session');
  // The rest of the run is written against a plain Sequence 9, so undo the
  // prologue's training bonuses rather than carrying them into every check.
  s.state.skills.occultism = 1;
  s.state.skills.streetwise = 1;
  const world = game.scene.getScene('World');
  if (world.scene.isPaused()) world.scene.resume();
  world.scene.restart({ mapId: 'club_hub' });
});
check('reached the club hub', await waitForScene('World'));
await page.waitForTimeout(700);
await shot('02c-club-hub');
state = await session();
check('spawned in the club hub', state.map === 'club_hub', state.map);

// ---------------------------------------------------------------------------
console.log('\n3. Accept the case from the board');
await withGame((game) => {
  const world = game.scene.getScene('World');
  world.runHotspotAction(world.map.hotspots.find((h) => h.id === 'club_board'));
});
check('case board opened', await waitForScene('CaseBoard'));
await page.waitForTimeout(300);
await shot('03-case-board');
await withGame((game) => {
  const board = game.scene.getScene('CaseBoard');
  board.session.cases.accept('case-01-notebook');
  board.close();
});
state = await session();
check('case accepted', state.activeCase === 'case-01-notebook', String(state.activeCase));
check(
  'and taking it moves the story on to the potion',
  state.chapter === 'ch_potion' && state.chapterWhere === 'club_hub',
  `${state.chapter} at ${state.chapterWhere}`,
);

// ---------------------------------------------------------------------------
console.log('\n3b. The cellar room, and the grey potion');
const talk = async (treeId, speaker) => {
  await withGame(
    (game, arg) => {
      const world = game.scene.getScene('World');
      world.openDialogue({ id: arg.speaker, x: 0, y: 0, dialogue: arg.treeId });
    },
    { treeId, speaker },
  );
  await page.waitForTimeout(400);
};
const pickChoice = async (needle) => {
  await withGame(
    (game, arg) => {
      const scene = game.scene.getScene('Dialogue');
      const choice = scene.node.choices.find((c) => c.text.includes(arg));
      if (choice) scene.choose(choice.index);
    },
    needle,
  );
  await page.waitForTimeout(250);
};

await withGame((game) => {
  const world = game.scene.getScene('World');
  world.runHotspotAction(world.map.hotspots.find((h) => h.id === 'club_potion'));
});
check('the potion scene plays at the Company', await waitForScene('Dialogue'));
await page.waitForTimeout(400);
await shot('03b-potion');
await pickChoice('Ask what happens to people');
await pickChoice('Drink it');
await pickChoice('Sit with it');
await withGame((game) => {
  const game_ = game;
  if (game_.scene.isActive('Dialogue')) game_.scene.stop('Dialogue');
  const world = game_.scene.getScene('World');
  if (world.scene.isPaused()) world.scene.resume();
});
await page.waitForTimeout(400);
state = await session();
check('the Seer potion sets the pathway', state.pathway === 'seer', String(state.pathway));
check('and its rank title with it', state.sequenceTitle === 'Seer', String(state.sequenceTitle));
check('and wakes him to the ladder', state.awakened === true, String(state.awakened));
check('and hands him the Sequence 9 powers', state.abilities.length > 0, JSON.stringify(state.abilities));
check(
  'and the story turns to the ritual he copied',
  state.chapter === 'ch_club' && state.chapterWhere === 'lodgings',
  `${state.chapter} at ${state.chapterWhere}`,
);

// ---------------------------------------------------------------------------
console.log('\n3c. Above the grey fog');
const goTo = async (mapId, x, y) => {
  await withGame(
    (game, arg) => {
      const world = game.scene.getScene('World');
      world.scene.restart({ mapId: arg.mapId, spawn: { x: arg.x, y: arg.y } });
    },
    { mapId, x, y },
  );
  // Long enough for the scene restart plus the camera fade-in, so screenshots
  // show the room rather than the transition.
  await page.waitForTimeout(1200);
};
await goTo('lodgings', 6, 8);
await withGame((game) => {
  const world = game.scene.getScene('World');
  world.runHotspotAction(world.map.hotspots.find((h) => h.id === 'home_circle'));
});
check('the ritual plays in his own room', await waitForScene('Dialogue'));
await page.waitForTimeout(400);
await pickChoice('Say the last line');
await pickChoice('Sit still');
await shot('03c-grey-fog');
await pickChoice('Try to summon somebody');
await pickChoice('Say nothing');
await pickChoice('Give them their names');
await pickChoice('Close the gathering');
await withGame((game) => {
  if (game.scene.isActive('Dialogue')) game.scene.stop('Dialogue');
  const world = game.scene.getScene('World');
  if (world.scene.isPaused()) world.scene.resume();
});
await page.waitForTimeout(400);
state = await session();
check('the Tarot Club is founded', state.flags.includes('tarot_club_founded'), state.flags.join(','));
check(
  'and the story goes back to the rooms above the shop',
  state.chapter === 'ch_rooms' && state.chapterWhere === 'pawnshop',
  `${state.chapter} at ${state.chapterWhere}`,
);

// ---------------------------------------------------------------------------
console.log('\n4. Travel to the rooms and gather what an ordinary eye can see');
await goTo('pawnshop', 9, 11);
state = await session();
check('reached the rooms above the shop', state.map === 'pawnshop', state.map);
await shot('04-pawnshop');

const examine = async (hotspotId) => {
  await withGame(
    (game, arg) => {
      const world = game.scene.getScene('World');
      const hotspot = world.map.hotspots.find((h) => h.id === arg);
      world.openExamine(hotspot);
    },
    hotspotId,
  );
  await page.waitForTimeout(350);
};
await examine('the_body');
await shot('05-examine-body');
await withGame((game) => game.scene.getScene('Examine').close());
await page.waitForTimeout(250);

for (const id of [
  'shop_door_inside', 'shuttered_window', 'the_watch', 'the_counter',
  'the_ledger', 'cellar_stair_top', 'display_case',
]) {
  await examine(id);
  await withGame((game) => game.scene.getScene('Examine').close());
  await page.waitForTimeout(150);
}
state = await session();
check(
  'the sealed room is on the record',
  ['clue_bolted_door', 'clue_no_wounds', 'clue_nailed_shutters'].every((id) => state.clues.includes(id)),
  state.clues.join(','),
);
check('the empty shelf is noticed', state.clues.includes('clue_empty_shelf'));
check('and the receipt is in his coat pocket', state.clues.includes('clue_parcel_receipt'));
check('picked up the plumb as evidence', state.items.includes('sealed_watch'), state.items.join(','));
check('picked up the transcription', state.items.includes('forged_ledger'), state.items.join(','));

// ---------------------------------------------------------------------------
console.log('\n5. Use a Beyonder ability to surface what an ordinary eye cannot');
const before = await session();
await examine('the_watch');
await withGame((game) => {
  const scene = game.scene.getScene('Examine');
  scene.useAbility('reveal_clue', scene.session.content.ability('divination'));
});
await page.waitForTimeout(300);
await shot('06-divination');
await withGame((game) => game.scene.getScene('Examine').close());
await page.waitForTimeout(200);

// And on the coat, which is where the handwriting turns out to be his own.
await examine('display_case');
await withGame((game) => {
  const scene = game.scene.getScene('Examine');
  scene.useAbility('reveal_clue', scene.session.content.ability('divination'));
});
await page.waitForTimeout(250);
await withGame((game) => game.scene.getScene('Examine').close());
await page.waitForTimeout(200);

state = await session();
check('divination reads the plumb', state.clues.includes('clue_watch_residue'));
check('and the hand on the parcel receipt', state.clues.includes('clue_own_handwriting'));
check('spirituality was spent', state.spirituality < before.spirituality, `${before.spirituality} -> ${state.spirituality}`);
check('concealment was spent', state.concealment < before.concealment, `${before.concealment} -> ${state.concealment}`);
check('using the power advanced digestion', state.digestion > before.digestion, `${before.digestion} -> ${state.digestion}`);

// ---------------------------------------------------------------------------
console.log('\n6. Locked hotspot stays locked without the keys');
await examine('the_strongbox');
await shot('07-strongbox-locked');
await withGame((game) => game.scene.getScene('Examine').close());
await page.waitForTimeout(200);
state = await session();
check('strongbox clue withheld while locked', !state.clues.includes('clue_strongbox_intact'));

// ---------------------------------------------------------------------------
console.log('\n7. Dialogue: gated choices, money, and clue-gated follow-ups');
await talk('dlg_constable', 'constable');
await shot('08-dialogue');
const choiceLabels = await withGame((game) => {
  const scene = game.scene.getScene('Dialogue');
  return scene.node.choices.map((c) => `${c.text}${c.enabled ? '' : ` [locked: ${c.reason}]`}`);
});
check('dialogue presented choices', choiceLabels.length >= 3, choiceLabels.join(' | '));

await pickChoice('Ask what the morning looked like');
await pickChoice('Back');
await pickChoice('Ask about the hour');
await pickChoice('Back');

// The keys cost money; confirm the purse actually pays.
const beforeKeys = await session();
await pickChoice('Ask for the keys');
await pickChoice('Put something in his glove');
state = await session();
check('bribe deducted 2s from the purse', beforeKeys.pence - state.pence === 24, `${beforeKeys.pence} -> ${state.pence}`);
check('bribe yielded the shop keys', state.items.includes('shop_keys'));
await withGame((game) => game.scene.getScene('Dialogue').close());
await page.waitForTimeout(250);

// ---------------------------------------------------------------------------
console.log('\n8. The keys open the strongbox');
await examine('the_strongbox');
await withGame((game) => game.scene.getScene('Examine').close());
await page.waitForTimeout(200);
state = await session();
check('strongbox now yields its clue', state.clues.includes('clue_strongbox_intact'));
check('strongbox yielded the ring', state.items.includes('mourning_ring'));

// ---------------------------------------------------------------------------
console.log('\n9. The cellar: nobody helped, and the room remembers');
await goTo('cellar', 6, 6);
state = await session();
check('reached the cellar', state.map === 'cellar', state.map);
await shot('09-cellar');
await examine('coal_chute');
await withGame((game) => game.scene.getScene('Examine').close());
await page.waitForTimeout(150);
await examine('hiding_place');
await withGame((game) => {
  const scene = game.scene.getScene('Examine');
  scene.useAbility('reveal_clue', scene.session.content.ability('divination'));
});
await page.waitForTimeout(250);
await withGame((game) => game.scene.getScene('Examine').close());
await page.waitForTimeout(200);
state = await session();
check('the room remembers being afraid', state.clues.includes('clue_terror_echo'), state.clues.join(','));

// ---------------------------------------------------------------------------
console.log('\n10. Testimony: the landlord, the ferry hand, and the man who sold it');
await goTo('pawnshop', 9, 11);
await talk('dlg_widow', 'widow');
await pickChoice('Ask whether anyone came or went');
await withGame((game) => game.scene.getScene('Dialogue').close());
await page.waitForTimeout(200);
state = await session();
check('the landlord saw him go out with a parcel', state.clues.includes('clue_franky_saw'));
check(
  'which is the parcel accounted for',
  state.clues.includes('clue_parcel_receipt') && state.clues.includes('clue_own_handwriting'),
  state.clues.join(','),
);

await goTo('ashfen_row', 9, 2);
await talk('dlg_dockhand', 'dockhand');
await pickChoice('Ask about Cobble Yard');
await withGame((game) => game.scene.getScene('Dialogue').close());
await page.waitForTimeout(200);
state = await session();
check('paid-for testimony obtained', state.clues.includes('clue_bieber_changed'), state.clues.join(','));

await goTo('pawnshop', 9, 11);
await talk('dlg_apprentice', 'apprentice');
await pickChoice('Ask about the sale');
await pickChoice('Back');
await pickChoice('Ask who consigned it');
const lockedAbilityChoice = await withGame((game) => {
  const scene = game.scene.getScene('Dialogue');
  return scene.node.choices.map((c) => ({ text: c.text, enabled: c.enabled, reason: c.reason }));
});
check(
  'ability-gated choice shows why it is locked',
  lockedAbilityChoice.some((c) => !c.enabled && c.reason),
  JSON.stringify(lockedAbilityChoice),
);
await pickChoice('Let it go');
await pickChoice('Ask about the transcription');
await withGame((game) => game.scene.getScene('Dialogue').close());
await page.waitForTimeout(200);

// The postal ledger is legwork rather than conversation: pay for the counter
// clerk's memory and let the roll decide, with the roll pinned so the test is
// about the plumbing rather than the dice.
const postal = await withGame((game) => {
  const session_ = game.scene.getScenes(true)[0].registry.get('session');
  const original = Math.random;
  Math.random = () => 0;
  try {
    return session_.inquiries.follow('lead_post_office');
  } finally {
    Math.random = original;
  }
});
state = await session();
check(
  'the postal ledger gives up the address',
  state.clues.includes('clue_bieber_address'),
  JSON.stringify(postal),
);
state = await session();
check(
  'all clean-solve clues in hand',
  [
    'clue_bolted_door', 'clue_nailed_shutters', 'clue_strongbox_intact',
    'clue_no_wounds', 'clue_terror_echo', 'clue_watch_residue',
    'clue_empty_shelf', 'clue_ledger_gap',
    'clue_parcel_receipt', 'clue_own_handwriting', 'clue_franky_saw',
    'clue_bieber_address', 'clue_bieber_changed', 'clue_two_cups',
  ].every((id) => state.clues.includes(id)),
  state.clues.join(','),
);

// ---------------------------------------------------------------------------
console.log('\n11. The deduction board');
await withGame((game) => {
  const world = game.scene.getScene('World');
  world.openJournal();
});
check('journal opened', await waitForScene('Journal'));
await withGame((game) => game.scene.getScene('Journal').setTab('board'));
await page.waitForTimeout(300);
await shot('10-deduction-board');

const badDeduce = await withGame((game) =>
  game.scene.getScene('Journal').session.cases.deduce(['clue_no_wounds', 'clue_two_cups']),
);
check('unrelated clues do not form a deduction', badDeduce.ok === false, JSON.stringify(badDeduce));

const deduceSets = [
  ['clue_bolted_door', 'clue_nailed_shutters', 'clue_strongbox_intact'],
  ['clue_no_wounds', 'clue_terror_echo', 'clue_watch_residue'],
  ['clue_empty_shelf', 'clue_ledger_gap', 'clue_strongbox_intact'],
  ['clue_parcel_receipt', 'clue_own_handwriting', 'clue_franky_saw'],
  ['clue_bieber_address', 'clue_bieber_changed', 'clue_two_cups'],
];
for (const set of deduceSets) {
  const result = await withGame(
    (game, arg) => game.scene.getScene('Journal').session.cases.deduce(arg),
    set,
  );
  check(`deduction formed from ${set.length} clues`, result.ok === true, JSON.stringify(result));
}
await withGame((game) => game.scene.getScene('Journal').render());
await page.waitForTimeout(300);
await shot('11-board-concluded');
state = await session();
check('five conclusions drawn', state.deductions.length === 5, state.deductions.join(','));
check(
  'and the story is at the warehouse door',
  state.chapter === 'ch_warehouse' && state.chapterWhere === 'warehouse',
  `${state.chapter} at ${state.chapterWhere}`,
);

// ---------------------------------------------------------------------------
console.log('\n11b. Cobble Yard, Ray Bieber, and the man in the paint');
await withGame((game) => {
  if (game.scene.isActive('Journal')) game.scene.stop('Journal');
  const world = game.scene.getScene('World');
  if (world.scene.isPaused()) world.scene.resume();
});
await page.waitForTimeout(300);
await goTo('warehouse', 8, 8);
state = await session();
check('reached the warehouse', state.map === 'warehouse', state.map);
check('and the raid plays on arrival', await waitForScene('Dialogue'));
await page.waitForTimeout(500);
await shot('11c-warehouse');
await pickChoice('Go in');
await pickChoice('Ask him what it promised');
await pickChoice('Look at him properly');
await pickChoice('Get out of the circle');
await pickChoice('Get the team');
await pickChoice('Then the silence');
await pickChoice('Turn around');
await shot('11d-clown');
await pickChoice('Shoot him');
await pickChoice('Say nothing about it');
await withGame((game) => {
  if (game.scene.isActive('Dialogue')) game.scene.stop('Dialogue');
  const world = game.scene.getScene('World');
  if (world.scene.isPaused()) world.scene.resume();
});
await page.waitForTimeout(400);
state = await session();
check('the notebook is recovered', state.items.includes('antigonus_notebook'), state.items.join(','));
check('and the name of Sequence 8 with it', state.flags.includes('knows_sequence_8'), state.flags.join(','));
check(
  'which turns the story to closing the file',
  state.chapter === 'ch_clown',
  String(state.chapter),
);

console.log('\n12. Resolution — the clean solve should now be unlocked');
await withGame((game) => game.scene.getScene('Journal').openResolve());
check('resolve screen opened', await waitForScene('Resolve'));
await page.waitForTimeout(400);
await shot('12-resolutions');
const options = await withGame((game) =>
  game.scene
    .getScene('Resolve')
    .session.cases.resolutionOptions()
    .map((o) => ({ id: o.resolution.id, grade: o.resolution.grade, unlocked: o.unlocked, reason: o.reason })),
);
check('clean resolution unlocked', options.find((o) => o.id === 'res_clean')?.unlocked === true, JSON.stringify(options));
check('all five outcomes are offered', options.length === 5, String(options.length));

const beforeResolve = await session();
await withGame((game) => game.scene.getScene('Resolve').confirm('res_clean'));
await page.waitForTimeout(600);
await shot('13-epilogue');
state = await session();
check('case marked resolved', state.caseStates['case-01-notebook'] === 'resolved', JSON.stringify(state.caseStates));
check('reward paid (£10 + £2 bonus)', state.pence - beforeResolve.pence === 2880, `${beforeResolve.pence} -> ${state.pence}`);
check(
  'the notebook goes into the Church’s cupboard',
  state.flags.includes('notebook_secured'),
  state.flags.join(','),
);
check('a day passed writing it up', state.day > beforeResolve.day, `${beforeResolve.day} -> ${state.day}`);

await withGame((game) => game.scene.getScene('Resolve').finish());
await page.waitForTimeout(800);
check('returned to the hub', (await session()).map === 'club_hub');
await shot('14-back-at-club');

// ---------------------------------------------------------------------------
console.log('\n13. Shop, advancement requirements, and the temptation route');
await withGame((game) => {
  const world = game.scene.getScene('World');
  world.runHotspotAction(world.map.hotspots.find((h) => h.id === 'club_requisition'));
});
check('shop opened', await waitForScene('Shop'));
await page.waitForTimeout(300);
await shot('15-shop');
const canBuyFormula = await withGame((game) => {
  const shop = game.scene.getScene('Shop');
  const item = shop.session.content.item('formula_clown');
  return { gate: shop.session.state.check(item.requires), price: item.pricePence };
});
check('Clown formula unlocked by closing the case', canBuyFormula.gate === true);

await withGame((game) => {
  const shop = game.scene.getScene('Shop');
  shop.session.state.addPence(6000); // stand in for a few more cases' work
  shop.buy('formula_clown');
  shop.buy('potion_clown');
  shop.close();
});
await page.waitForTimeout(300);
state = await session();
check('formula and potion acquired', state.items.includes('formula_clown') && state.items.includes('potion_clown'));

await withGame((game) => {
  const world = game.scene.getScene('World');
  world.runHotspotAction(world.map.hotspots.find((h) => h.id === 'club_circle'));
});
check('ritual opened', await waitForScene('Ritual'));
await page.waitForTimeout(300);
await shot('16-ritual');
const advancement = await withGame((game) => {
  const ritual = game.scene.getScene('Ritual');
  return {
    requirements: ritual.session.progression.requirements().map((r) => ({ label: r.requirement.label, met: r.met, detail: r.detail })),
    canAdvance: ritual.session.progression.canAdvance(),
    canForce: ritual.session.progression.canForceAdvance(),
  };
});
check('clean advance blocked by undigested potion', advancement.canAdvance === false, JSON.stringify(advancement.requirements));
check('temptation route available instead', advancement.canForce === true);

const beforeAdvance = await session();
await withGame((game) => game.scene.getScene('Ritual').perform(true));
await page.waitForTimeout(700);
await shot('17-advanced');
state = await session();
check('advanced to Sequence 8', state.sequence === 8, String(state.sequence));
check('the shortcut cost sanity', state.sanity < beforeAdvance.sanity, `${beforeAdvance.sanity} -> ${state.sanity}`);
check('the shortcut cost concealment', state.concealment < beforeAdvance.concealment, `${beforeAdvance.concealment} -> ${state.concealment}`);
check('potion consumed', !state.items.includes('potion_clown'));
const newAbilities = await withGame((game) => {
  const s = game.scene.getScenes(true)[0].registry.get('session');
  return s.state.knownAbilities();
});
check('Clown abilities granted', newAbilities.includes('sleight_of_hand') && newAbilities.includes('mocking_barb'), newAbilities.join(','));

// ---------------------------------------------------------------------------
console.log('\n14. Powers menu — abilities used on purpose');
// The rite is still on screen from the last step; close it so the world is
// interactive again (WorldScene refuses overlays while one is already open).
await withGame((game) => game.scene.getScene('Ritual').close());
await page.waitForTimeout(400);
await withGame((game) => {
  const world = game.scene.getScene('World');
  world.openAbilityMenu();
});
check('powers menu opened', await waitForScene('AbilityMenu'));
await page.waitForTimeout(400);
await shot('18-powers-menu');

const before1 = await session();
const invoked = await withGame((game) => {
  const menu = game.scene.getScene('AbilityMenu');
  const ability = menu.session.content.ability('read_the_cards');
  return menu.session.abilities.invoke(ability.id, { context: 'hub', witnessed: false });
});
state = await session();
check('acting-method power fired from the menu', invoked.ok === true, JSON.stringify(invoked));
check('it raised digestion', state.digestion > before1.digestion, `${before1.digestion} -> ${state.digestion}`);
check('it spent spirituality', state.spirituality < before1.spirituality);

const targeted = await withGame((game) => {
  const menu = game.scene.getScene('AbilityMenu');
  return menu.session.abilities.invoke('divination', { context: 'investigation', witnessed: false });
});
check('targeted powers refuse to fire from the menu', targeted.ok === false, JSON.stringify(targeted));

const before2 = await session();
const steadied = await withGame((game) =>
  game.scene.getScene('AbilityMenu').session.abilities.invoke('steady_the_thread', {
    context: 'hub',
    witnessed: false,
  }),
);
state = await session();
check('self-directed power restored sanity', steadied.ok === true && state.sanity > before2.sanity,
  `${before2.sanity} -> ${state.sanity}`);
await withGame((game) => game.scene.getScene('AbilityMenu').close());
await page.waitForTimeout(300);

// ---------------------------------------------------------------------------
console.log('\n15. Training — skills bought with money and days');
await goTo('club_hub', 11, 8);
await withGame((game) => {
  const world = game.scene.getScene('World');
  world.runHotspotAction(world.map.hotspots.find((h) => h.id === 'club_lectern'));
});
check('tuition opened', await waitForScene('Training'));
await page.waitForTimeout(300);
await shot('19-training');

const beforeTrain = await session();
await withGame((game) => game.scene.getScene('Training').train('streetwise'));
await page.waitForTimeout(200);
state = await session();
check('streetwise raised', state.skills.streetwise === beforeTrain.skills.streetwise + 1,
  `${beforeTrain.skills.streetwise} -> ${state.skills.streetwise}`);
check('tuition cost money', state.pence < beforeTrain.pence, `${beforeTrain.pence} -> ${state.pence}`);
check('tuition cost a day', state.day > beforeTrain.day, `${beforeTrain.day} -> ${state.day}`);

// Occultism must actually make powers cheaper — the stated benefit, verified.
const discountBefore = await withGame((game) =>
  game.scene.getScene('Training').session.abilities.spiritCostOf(
    game.scene.getScene('Training').session.content.ability('divination'),
  ),
);
await withGame((game) => {
  const training = game.scene.getScene('Training');
  training.session.state.addPence(20000);
  for (let i = 0; i < 5; i++) training.train('occultism');
});
const discountAfter = await withGame((game) =>
  game.scene.getScene('Training').session.abilities.spiritCostOf(
    game.scene.getScene('Training').session.content.ability('divination'),
  ),
);
check('occultism made powers cheaper', discountAfter < discountBefore, `${discountBefore} -> ${discountAfter}`);
await withGame((game) => game.scene.getScene('Training').close());
await page.waitForTimeout(300);

// ---------------------------------------------------------------------------
console.log('\n16. Lines of inquiry — buying a clue with money, days and skill');
await withGame((game) => {
  const session = game.scene.getScenes(true)[0].registry.get('session');
  // Reopen the closed case so leads have something to attach to.
  session.state.setCaseState('case-01-notebook', 'active');
  session.state.clues.delete('clue_ferry_times');
  session.state.spentLeads.clear();
});
await withGame((game) => {
  const world = game.scene.getScene('World');
  world.runHotspotAction(world.map.hotspots.find((h) => h.id === 'club_inquiry_desk'));
});
check('inquiry desk opened', await waitForScene('Inquiry'));
await page.waitForTimeout(300);
await shot('20-inquiry');

const leads = await withGame((game) =>
  game.scene.getScene('Inquiry').session.inquiries.available().map((o) => ({
    id: o.lead.id,
    enabled: o.enabled,
    cost: o.costPence,
    chance: o.chance,
  })),
);
check('leads offered for the open case', leads.length === 5, JSON.stringify(leads));
check('leads show their odds', leads.every((l) => l.chance === undefined || l.chance > 0));

// Rhetoric discounts paid information — verify the price actually moves.
const priceBefore = leads.find((l) => l.id === 'lead_vane_informant')?.cost;
await withGame((game) => {
  const scene = game.scene.getScene('Inquiry');
  scene.session.state.addSkill('rhetoric', 5);
});
const priceAfter = await withGame((game) => {
  const scene = game.scene.getScene('Inquiry');
  return scene.session.inquiries.available().find((o) => o.lead.id === 'lead_vane_informant')?.costPence;
});
check('rhetoric cut the informant price', priceAfter < priceBefore, `${priceBefore} -> ${priceAfter}`);

// Force the check to succeed so the clue-granting path is exercised deterministically.
const beforeLead = await session();
const leadResult = await withGame((game) => {
  const scene = game.scene.getScene('Inquiry');
  const original = Math.random;
  Math.random = () => 0; // guarantee the roll passes
  try {
    return scene.session.inquiries.follow('lead_vane_informant');
  } finally {
    Math.random = original;
  }
});
state = await session();
check(
  'following a lead granted its clue',
  state.clues.includes('clue_order_watching'),
  JSON.stringify(leadResult),
);
check('the lead cost money', state.pence < beforeLead.pence, `${beforeLead.pence} -> ${state.pence}`);
check('the lead is spent afterwards', state.spentLeads.includes('lead_vane_informant'));
await withGame((game) => game.scene.getScene('Inquiry').close());
await page.waitForTimeout(300);

// ---------------------------------------------------------------------------
console.log('\n17. Random encounters');
const encounterOptions = await withGame((game) => {
  const session = game.scene.getScenes(true)[0].registry.get('session');
  const encounter = session.content.encounter('enc_fence_invitation');
  return session.encounters.present(encounter).map((o) => ({ text: o.text, enabled: o.enabled, chance: o.chance }));
});
check('encounter options presented with odds', encounterOptions.length >= 2, JSON.stringify(encounterOptions));

await withGame((game) => {
  const world = game.scene.getScene('World');
  world.openModal('Encounter', { encounterId: 'enc_fence_invitation' });
});
check('encounter scene opened', await waitForScene('Encounter'));
await page.waitForTimeout(900);
await shot('21-encounter');
await withGame((game) => {
  const scene = game.scene.getScene('Encounter');
  scene.typewriter.finish();
  scene.renderOptions();
});
await page.waitForTimeout(300);
await withGame((game) => game.scene.getScene('Encounter').choose(0));
await page.waitForTimeout(500);
await shot('22-encounter-outcome');
state = await session();
check('encounter outcome applied its effect', state.flags.includes('knows_crookback'), state.flags.join(','));
await withGame((game) => game.scene.getScene('Encounter').close());
await page.waitForTimeout(400);

const weighting = await withGame((game) => {
  const session = game.scene.getScenes(true)[0].registry.get('session');
  return {
    eligibleOnRow: session.encounters.eligible('ashfen_row').map((e) => e.id),
    onceIsSpent: session.state.seenEncounters.includes
      ? false
      : [...session.state.seenEncounters].includes('enc_fence_invitation'),
  };
});
check('one-shot encounter no longer eligible', !weighting.eligibleOnRow.includes('enc_fence_invitation'),
  weighting.eligibleOnRow.join(','));

// ---------------------------------------------------------------------------
console.log('\n18. The black market');
await goTo('crookback_alley', 2, 3);
state = await session();
check('reached Crookback Alley', state.map === 'crookback_alley', state.map);
await shot('23-alley');
// The alley rolls encounters on arrival; clear one if the dice produced it.
if ((await activeScenes()).includes('Encounter')) {
  await withGame((game) => game.scene.getScene('Encounter').close());
  await page.waitForTimeout(500);
}
await withGame((game) => {
  const world = game.scene.getScene('World');
  world.runHotspotAction(world.map.hotspots.find((h) => h.id === 'market_counter'));
});
check('fence opened', await waitForScene('Shop'));
await page.waitForTimeout(300);
await shot('24-black-market');

const marketStock = await withGame((game) => {
  const shop = game.scene.getScene('Shop');
  return [...shop.session.content.items.values()]
    .filter((i) => i.pricePence !== undefined && shop.stocks(i))
    .map((i) => ({ id: i.id, list: i.pricePence, asked: shop.priceOf(i), heat: i.heat ?? 0 }));
});
check('fence stocks its own goods', marketStock.some((i) => i.id === 'lockpicks'), JSON.stringify(marketStock.map((i) => i.id)));
check('club-only goods are not on the fence table', !marketStock.some((i) => i.id === 'formula_clown'));
check('streetwise discounts the asking price', marketStock.every((i) => i.asked <= i.list),
  JSON.stringify(marketStock));

const beforeBuy = await session();
await withGame((game) => game.scene.getScene('Shop').buy('lockpicks'));
state = await session();
check('bought from the fence', state.items.includes('lockpicks'));
check('buying illicit goods cost concealment', state.concealment < beforeBuy.concealment,
  `${beforeBuy.concealment} -> ${state.concealment}`);
await withGame((game) => game.scene.getScene('Shop').close());
await page.waitForTimeout(300);

// The picks are a second honest key to the strongbox.
const strongboxOpen = await withGame((game) => {
  const session = game.scene.getScenes(true)[0].registry.get('session');
  const map = session.content.map('pawnshop');
  const hotspot = map.hotspots.find((h) => h.id === 'the_strongbox');
  return session.state.check(hotspot.locked.bypass);
});
check('picks open what the keys opened', strongboxOpen === true);

// ---------------------------------------------------------------------------
console.log('\n19. Usable items, and the ladder past Sequence 8');

// Laudanum: bought, then actually consumed for an effect.
await withGame((game) => {
  const s = game.scene.getScenes(true)[0].registry.get('session');
  s.state.addPence(60000);
  s.state.addItem('laudanum');
  s.state.addSanity(-40);
});
const beforeDose = await session();
const dose = await withGame((game) =>
  game.scene.getScenes(true)[0].registry.get('session').state.useItem('laudanum'),
);
state = await session();
check('a consumable can be used', dose.ok === true, JSON.stringify(dose));
check('using it restored sanity', state.sanity > beforeDose.sanity, `${beforeDose.sanity} -> ${state.sanity}`);
check('using it consumed the item', !state.items.includes('laudanum'));

// The grey-market formula must satisfy the rung the Club's formula satisfies —
// which is the 9 -> 8 rite, so evaluate it at that rank.
const substitution = await withGame((game) => {
  const s = game.scene.getScenes(true)[0].registry.get('session');
  const actualSequence = s.state.sequence;
  s.state.inventory.delete('formula_clown');
  s.state.inventory.delete('potion_clown');
  try {
    s.state.sequence = 9;
    const withoutAny = s.progression
      .requirements()
      .find((r) => r.requirement.itemAnyOf)?.met;
    s.state.addItem('grey_formula_clown');
    const withCopy = s.progression.requirements().find((r) => r.requirement.itemAnyOf);
    return { withoutAny, met: withCopy?.met, label: withCopy?.requirement.label };
  } finally {
    s.state.sequence = actualSequence;
  }
});
check(
  'the formula requirement is unmet with neither formula',
  substitution.withoutAny === false,
  JSON.stringify(substitution),
);
check(
  'a fence-copied formula satisfies it',
  substitution.met === true,
  JSON.stringify(substitution),
);

// Brewing from doubtful reagents produces the potion the rite wants — and
// "the rite" means the player's own next rung, whichever pathway they walk.
const brewed = await withGame((game) => {
  const s = game.scene.getScenes(true)[0].registry.get('session');
  const actual = s.state.sequence;
  try {
    // Sequence 9 is the rung the fence-copied Clown formula belongs to.
    s.state.sequence = 9;
    s.state.addItem('cheap_reagents');
    const result = s.state.useItem('cheap_reagents');
    return { result, has: s.state.hasItem('potion_clown') };
  } finally {
    s.state.sequence = actual;
  }
});
check('reagents plus a formula brew the potion', brewed.result.ok && brewed.has, JSON.stringify(brewed));

// The same reagents refuse to brew when nothing on hand fits the next rung.
const brewedWrongRung = await withGame((game) => {
  const s = game.scene.getScenes(true)[0].registry.get('session');
  s.state.addItem('cheap_reagents');
  // At the actual rung the player holds a Clown-era formula and needs a later
  // one, so the same item must decline rather than brew the wrong potion.
  return { result: s.state.useItem('cheap_reagents') };
});
check(
  'reagents refuse a formula from the wrong rung',
  brewedWrongRung.result.ok === false,
  JSON.stringify(brewedWrongRung),
);

// Now the previously dead-ended rung: Sequence 8 -> 7.
const ladder = await withGame((game) => {
  const s = game.scene.getScenes(true)[0].registry.get('session');
  // Everything the tier asks for except the public performance.
  s.state.addItem('formula_magician');
  s.state.addItem('potion_magician');
  s.state.addTrust('hermit', 60);
  s.state.digestion = 100;
  const before = s.progression.requirements().map((r) => ({ label: r.requirement.label, met: r.met }));

  // The acting method, performed where somebody can see it.
  const acted = s.abilities.invoke('read_the_cards', { context: 'hub', witnessed: true });
  const after = s.progression.requirements().map((r) => ({ label: r.requirement.label, met: r.met }));
  return { before, after, acted, flags: [...s.state.flags].filter((f) => f.startsWith('act_')) };
});
check(
  'the public-performance requirement starts unmet',
  ladder.before.some((r) => !r.met),
  JSON.stringify(ladder.before),
);
check('performing the role in company sets the flag', ladder.flags.includes('act_clown_public'),
  ladder.flags.join(','));
check('every Sequence 7 requirement is now met', ladder.after.every((r) => r.met), JSON.stringify(ladder.after));

const advanced = await withGame((game) => {
  const s = game.scene.getScenes(true)[0].registry.get('session');
  const result = s.progression.advance(false);
  return { result, sequence: s.state.sequence, abilities: s.state.knownAbilities() };
});
check('advanced cleanly to Sequence 7', advanced.sequence === 7, JSON.stringify(advanced.result));
check('Magician abilities granted', advanced.abilities.includes('paper_mask') && advanced.abilities.includes('stage_presence'),
  advanced.abilities.join(','));

// ---------------------------------------------------------------------------
console.log('\n20. No runtime errors');
check('console clean', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' || '));

await browser.close();

console.log(`\nScreenshots in ${OUT}`);
if (failures.length) {
  console.error(`\n${failures.length} failing check(s):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nAll checks passed.');
