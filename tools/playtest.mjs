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
    items: s.content.items.size,
    characters: s.content.characters.size,
  };
});
check('content loaded from JSON', loaded.cases === 1 && loaded.maps === 4 && loaded.abilities === 11,
  JSON.stringify(loaded));

// ---------------------------------------------------------------------------
console.log('\n2. Start a new game and land in the hub');
await withGame((game) => {
  const menu = game.scene.getScene('MainMenu');
  menu.newGame(false);
});
check('world scene started', await waitForScene('World'));
check('HUD launched', await waitForScene('Hud'));
await page.waitForTimeout(600);
await shot('02-club-hub');
let state = await session();
check('spawned in the club hub', state.map === 'club_hub', state.map);
check('starts at Sequence 9', state.sequence === 9);
check('starts with £2 10s', state.pence === 600, `${state.pence}d`);
check('starts part-digested', state.digestion === 55, `${state.digestion}`);

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
  board.session.cases.accept('case-01-ninth-bell');
  board.close();
});
state = await session();
check('case accepted', state.activeCase === 'case-01-ninth-bell', String(state.activeCase));

// ---------------------------------------------------------------------------
console.log('\n4. Travel to the pawnshop and gather mundane clues');
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
await goTo('pawnshop', 9, 11);
state = await session();
check('reached the pawnshop', state.map === 'pawnshop', state.map);
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

for (const id of ['shop_door_inside', 'shuttered_window', 'the_watch', 'the_counter', 'the_ledger', 'cellar_stair_top']) {
  await examine(id);
  await withGame((game) => game.scene.getScene('Examine').close());
  await page.waitForTimeout(150);
}
state = await session();
check('mundane scene clues collected', state.clues.includes('clue_bolted_door') && state.clues.includes('clue_no_wounds') && state.clues.includes('clue_ledger_gap'), state.clues.join(','));
check('picked up the watch as evidence', state.items.includes('sealed_watch'), state.items.join(','));
check('picked up the ledger', state.items.includes('forged_ledger'), state.items.join(','));

// ---------------------------------------------------------------------------
console.log('\n5. Use a Beyonder ability to surface a hidden clue');
const before = await session();
await examine('the_body');
await withGame((game) => {
  const scene = game.scene.getScene('Examine');
  scene.useAbility('reveal_clue', scene.session.content.ability('divination'));
});
await page.waitForTimeout(300);
await shot('06-divination');
await withGame((game) => game.scene.getScene('Examine').close());
await page.waitForTimeout(200);

// And again on the watch, which is where the artefact reveals itself.
await examine('the_watch');
await withGame((game) => {
  const scene = game.scene.getScene('Examine');
  scene.useAbility('reveal_clue', scene.session.content.ability('divination'));
});
await page.waitForTimeout(250);
await withGame((game) => game.scene.getScene('Examine').close());
await page.waitForTimeout(200);

state = await session();
check('divination revealed the hidden clues', state.clues.includes('clue_terror_echo') && state.clues.includes('clue_watch_residue'));
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
await talk('dlg_constable', 'constable');
await shot('08-dialogue');
const choiceLabels = await withGame((game) => {
  const scene = game.scene.getScene('Dialogue');
  return scene.node.choices.map((c) => `${c.text}${c.enabled ? '' : ` [locked: ${c.reason}]`}`);
});
check('dialogue presented choices', choiceLabels.length >= 3, choiceLabels.join(' | '));

// Take the constable's two testimony branches.
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
await pickChoice('Walk me through the morning');
await pickChoice('Back');
await pickChoice('Did anyone hear anything');
await pickChoice('Back');

// The keys cost money; confirm the purse actually pays.
const beforeKeys = await session();
await pickChoice("I'd like the keys");
const lockedAbilityChoice = await withGame((game) => {
  const scene = game.scene.getScene('Dialogue');
  return scene.node.choices.map((c) => ({ text: c.text, enabled: c.enabled, reason: c.reason }));
});
check(
  'ability-gated choice shows why it is locked',
  lockedAbilityChoice.some((c) => !c.enabled && c.reason),
  JSON.stringify(lockedAbilityChoice),
);
await pickChoice('Offer him something');
state = await session();
check('bribe deducted 8s from the purse', beforeKeys.pence - state.pence === 96, `${beforeKeys.pence} -> ${state.pence}`);
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
console.log('\n9. The cellar, and divination in an empty room');
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
check('cellar clues collected', state.clues.includes('clue_cellar_bolt') && state.clues.includes('clue_second_presence'));

// ---------------------------------------------------------------------------
console.log('\n10. Remaining testimony: widow, ferryman, apprentice');
await goTo('pawnshop', 9, 11);
await talk('dlg_widow', 'widow');
await pickChoice('Tell me about the last week');
await withGame((game) => game.scene.getScene('Dialogue').close());
await page.waitForTimeout(200);

await goTo('ashfen_row', 9, 2);
await talk('dlg_dockhand', 'dockhand');
await pickChoice('When is the last crossing');
await pickChoice('Back');
await pickChoice("Who's been buying odd things");
await withGame((game) => game.scene.getScene('Dialogue').close());
await page.waitForTimeout(200);
state = await session();
check('paid-for testimony obtained', state.clues.includes('clue_ferry_times') && state.clues.includes('clue_vane_offer'));

await goTo('pawnshop', 9, 11);
await talk('dlg_apprentice', 'apprentice');
await pickChoice('Where were you that night');
await pickChoice('Back');
await pickChoice('The last ferry across the Ash');
await withGame((game) => game.scene.getScene('Dialogue').close());
await page.waitForTimeout(200);
state = await session();
check('alibi broken by the ferry timetable', state.clues.includes('clue_cass_lie'));
check('all clean-solve clues in hand', [
  'clue_bolted_door', 'clue_nailed_shutters', 'clue_cellar_bolt',
  'clue_coal_dust', 'clue_constable_time', 'clue_second_presence',
  'clue_no_wounds', 'clue_watch_residue', 'clue_terror_echo',
  'clue_ledger_gap', 'clue_vane_offer', 'clue_two_cups', 'clue_cass_lie',
].every((id) => state.clues.includes(id)), state.clues.join(','));

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
  ['clue_bolted_door', 'clue_nailed_shutters', 'clue_cellar_bolt'],
  ['clue_coal_dust', 'clue_constable_time', 'clue_second_presence'],
  ['clue_no_wounds', 'clue_watch_residue', 'clue_terror_echo'],
  ['clue_ledger_gap', 'clue_vane_offer'],
  ['clue_two_cups', 'clue_cass_lie'],
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

// ---------------------------------------------------------------------------
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
check('case marked resolved', state.caseStates['case-01-ninth-bell'] === 'resolved', JSON.stringify(state.caseStates));
check('reward paid (£10 + £2 bonus)', state.pence - beforeResolve.pence === 2880, `${beforeResolve.pence} -> ${state.pence}`);
check('watch handed to the Club', !state.items.includes('sealed_watch'), state.items.join(','));
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
console.log('\n14. No runtime errors');
check('console clean', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' || '));

await browser.close();

console.log(`\nScreenshots in ${OUT}`);
if (failures.length) {
  console.error(`\n${failures.length} failing check(s):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nAll checks passed.');
