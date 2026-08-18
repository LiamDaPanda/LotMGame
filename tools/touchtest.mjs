#!/usr/bin/env node
// Touch regression test: portrait first, then landscape and back.
//
// The bug this exists to catch: Phaser hit-tests a Container as though it were
// a centre-origin sprite (it adds `displayOriginX/Y` to the local point), while
// a Container draws its children from its own top-left. Get that wrong and
// every button's live area sits half a button up and to the left of the plate
// you can see — which reads on a phone as "nothing is pressable", and on a
// desktop as "sometimes it works", because a mouse aimed at a corner still
// lands inside by a pixel.
//
// So this drives real touch events at the visible centre of real widgets, and
// separately asserts that every interactive container's hit area agrees with
// its rendered bounds.
//
// It also checks that no text leaves the box it belongs to — the board, a
// scrolling list's viewport, or a button's own plate. That last one is the case
// that bites: a label wrapping onto a second line inside a 38px button is not
// off the screen, it is printed across the button's border, and nothing about
// the board's bounds notices.
//
//   npm run build && npm run preview &
//   node tools/touchtest.mjs [baseUrl]
import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  collectCollisions,
  collectOverflows,
  openPanel,
  panelFixtures,
  panelList,
} from './lib/text-fit.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173/LotMGame/';

const failures = [];
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  pass   ${label}`);
  } else {
    console.log(`  FAIL   ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
};

const preinstalled = fs
  .readdirSync('/opt/pw-browsers')
  .filter((name) => name.startsWith('chromium-'))
  .map((name) => `/opt/pw-browsers/${name}/chrome-linux/chrome`)
  .find((candidate) => fs.existsSync(candidate));

const browser = await chromium.launch(preinstalled ? { executablePath: preinstalled } : {});
// An iPhone 13's CSS viewport, with a real touchscreen and no mouse.
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

// `domcontentloaded`, not `networkidle`: the real readiness signal is the game
// booting, which is waited on below, and networkidle can hang behind a proxy.
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => window.__game?.scene.getScenes(true).some((scene) => scene.scene.key === 'MainMenu'),
  null,
  { timeout: 20000 },
);
await page.waitForTimeout(500);

const scenes = () =>
  page.evaluate(() => window.__game.scene.getScenes(true).map((scene) => scene.scene.key));

const geometry = await page.evaluate(() => {
  const game = window.__game;
  const rect = game.canvas.getBoundingClientRect();
  return {
    rx: rect.x,
    ry: rect.y,
    rw: rect.width,
    rh: rect.height,
    gw: game.scale.gameSize.width,
    gh: game.scale.gameSize.height,
  };
});

/** Every interactive container in a scene: label, rendered bounds, hit bounds. */
const widgets = (key) =>
  page.evaluate((sceneKey) => {
    const scene = window.__game.scene.getScene(sceneKey);
    if (!scene || !scene.scene.isActive()) return [];
    return scene.input._list
      .filter((object) => object.type === 'Container' && object.input?.hitArea)
      .map((object) => {
        const matrix = object.getWorldTransformMatrix();
        const hit = object.input.hitArea;
        return {
          label: object.list.filter((child) => child.type === 'BitmapText').map((child) => child.text)[0] ?? '',
          // Where the plate is drawn: children start at the container's origin.
          drawX: matrix.tx,
          drawY: matrix.ty,
          width: object.width,
          height: object.height,
          // Where taps actually land, once Phaser's displayOrigin shift is undone.
          hitX: matrix.tx + hit.x - object.displayOriginX,
          hitY: matrix.ty + hit.y - object.displayOriginY,
          hitW: hit.width,
          hitH: hit.height,
        };
      });
  }, key);

const tapWidget = async (sceneKey, match) => {
  const list = await widgets(sceneKey);
  const widget = list.find((item) => item.label.includes(match));
  if (!widget) return { found: false, have: list.map((item) => item.label.split('\n')[0]) };
  const pageX = geometry.rx + ((widget.drawX + widget.width / 2) / geometry.gw) * geometry.rw;
  const pageY = geometry.ry + ((widget.drawY + widget.height / 2) / geometry.gh) * geometry.rh;
  await page.touchscreen.tap(pageX, pageY);
  await page.waitForTimeout(450);
  return { found: true };
};

const tapStep = async (label, sceneKey, match, expect) => {
  const result = await tapWidget(sceneKey, match);
  if (!result.found) {
    check(label, false, `no widget "${match}" in ${sceneKey}; have: ${result.have.join(' | ')}`);
    return;
  }
  const after = await scenes();
  check(label, expect(after), `scenes: ${after.join(',')}`);
};

/** Hit area and plate must describe the same box, or thumbs miss. */
const checkAlignment = async (sceneKey) => {
  for (const widget of await widgets(sceneKey)) {
    const aligned =
      Math.abs(widget.hitX - widget.drawX) < 1 &&
      Math.abs(widget.hitY - widget.drawY) < 1 &&
      Math.abs(widget.hitW - widget.width) < 1 &&
      Math.abs(widget.hitH - widget.height) < 1;
    check(
      `${sceneKey}: "${widget.label.split('\n')[0]}" hit area covers its plate`,
      aligned,
      `plate ${widget.drawX},${widget.drawY} ${widget.width}x${widget.height} vs hit ${widget.hitX},${widget.hitY} ${widget.hitW}x${widget.hitH}`,
    );
  }
};

/**
 * Nothing may draw text outside the box it belongs to — see tools/lib/text-fit.
 */
const checkTextFits = async (sceneKey, label) => {
  const overflows = await page.evaluate(collectOverflows, sceneKey);
  check(
    `${label}: all text inside its box`,
    overflows !== null && overflows.length === 0,
    overflows === null ? `${sceneKey} was not active` : overflows.join(' | '),
  );
  // Fitting each label in its own box does not stop two boxes being placed on
  // top of each other, which is what "the text overlaps" looks like in the hand.
  const collisions = await page.evaluate(collectCollisions, sceneKey);
  check(
    `${label}: no text drawn over other text`,
    collisions !== null && collisions.length === 0,
    collisions === null ? `${sceneKey} was not active` : collisions.join(' | '),
  );
};

console.log(`iPhone-sized viewport 390x844 — board ${geometry.gw}x${geometry.gh}, canvas ${geometry.rw}x${geometry.rh} at y=${geometry.ry}`);

console.log('\n1. The board turns upright');
check('portrait viewport gets a portrait board', geometry.gh > geometry.gw, `${geometry.gw}x${geometry.gh}`);
check(
  'canvas covers most of the screen',
  (geometry.rw * geometry.rh) / (390 * 844) > 0.6,
  `${Math.round(((geometry.rw * geometry.rh) / (390 * 844)) * 100)}% of the screen`,
);

console.log('\n2. Hit areas agree with what is drawn');
await checkAlignment('MainMenu');
await checkTextFits('MainMenu', 'Main menu');

console.log('\n3. Touch reaches the menu, and the prologue plays');
await tapStep('Begin wakes you in your room', 'MainMenu', 'Begin', (list) => list.includes('World'));
// The room fades in before the prologue takes the screen, so wait for it
// rather than assuming it is up the instant the tap lands.
await page.waitForFunction(
  () => window.__game.scene.getScenes(true).some((scene) => scene.scene.key === 'Dialogue'),
  null,
  { timeout: 8000 },
);
check('the prologue plays itself', true);

/** Tap the speech panel to finish the line, the way a player does. */
const finishTyping = async () => {
  const point = await page.evaluate(() => {
    const game = window.__game;
    const dialogue = game.scene.getScene('Dialogue');
    if (!dialogue || !dialogue.scene.isActive()) return null;
    return { x: game.scale.gameSize.width / 2, y: game.scale.gameSize.height * 0.88 };
  });
  if (!point) return;
  await page.touchscreen.tap(
    geometry.rx + (point.x / geometry.gw) * geometry.rw,
    geometry.ry + (point.y / geometry.gh) * geometry.rh,
  );
  await page.waitForTimeout(350);
};

const say = async (label, match) => {
  await finishTyping();
  const result = await tapWidget('Dialogue', match);
  check(label, result.found, result.found ? '' : `have: ${(result.have ?? []).join(' | ')}`);
};

await checkTextFits('Dialogue', 'Prologue');
await say('the prologue takes a considered opening', 'Think it through');
await say('and reaches the pathway question', 'Turn the three formulas');
await checkTextFits('Dialogue', 'Pathway question');
await say('a speech option picks a pathway', 'the dead will answer');
const chosen = await page.evaluate(
  () => window.__game.registry.get('session').state.pathwayId,
);
check('the tapped pathway took', chosen === 'corpse_collector', String(chosen));
await say('and asks how it will be carried', 'Sit with it');
await say('the disposition option is takeable', 'Quietly');
await finishTyping();
await finishTyping();
await page.waitForTimeout(600);
const afterPrologue = await scenes();
check(
  'the prologue hands the room back and closes itself',
  afterPrologue.includes('World') && !afterPrologue.includes('Dialogue'),
  afterPrologue.join(','),
);
await page.waitForTimeout(400);

console.log('\n4. Touch reaches the HUD, and its targets are thumb-sized');
const hud = await widgets('Hud');
check('HUD has its buttons', hud.length >= 2, hud.map((w) => w.label).join(' | '));
// 44pt is Apple's minimum; the board is scaled down to fit, so measure in real
// device pixels rather than board units.
const scale = geometry.rh / geometry.gh;
for (const button of hud) {
  check(
    `HUD "${button.label}" is at least 40pt tall (${Math.round(button.height * scale)}pt)`,
    button.height * scale >= 40,
  );
}
await checkAlignment('Hud');

console.log('\n5. Overlays open and close by touch');
await tapStep('Notes opens', 'Hud', 'NOTES', (list) => list.includes('Journal'));
await checkAlignment('Journal');
await tapStep('Notes closes again', 'Hud', 'NOTES', (list) => !list.includes('Journal'));
await tapStep('Powers opens', 'Hud', 'POWER', (list) => list.includes('AbilityMenu'));
await checkAlignment('AbilityMenu');
await tapStep('Powers closes again', 'Hud', 'POWER', (list) => !list.includes('AbilityMenu'));

console.log('\n6. Text stays inside its box');
await checkTextFits('Hud', 'HUD');
await tapWidget('Hud', 'NOTES');
await page.waitForTimeout(400);
await checkTextFits('Journal', 'Journal');
await tapWidget('Hud', 'NOTES');
await page.waitForTimeout(300);
await tapWidget('Hud', 'CASE');
await page.waitForTimeout(400);
await checkTextFits('CaseBoard', 'Case board');
await tapWidget('Hud', 'CASE');
await page.waitForTimeout(300);
await tapWidget('Hud', 'POWER');
await page.waitForTimeout(400);
await checkTextFits('AbilityMenu', 'Powers');
await tapWidget('Hud', 'POWER');
await page.waitForTimeout(300);

console.log('\n7. Every panel keeps its text inside the pane');
const fixtures = await page.evaluate(panelFixtures);
for (const [key, data] of panelList(fixtures)) {
  await page.evaluate(openPanel, { key, data });
  // Dialogue types its line out; give every panel time to settle.
  await page.waitForTimeout(1200);
  await checkTextFits(key, key);
  await checkAlignment(key);
}
await page.evaluate(() => {
  const game = window.__game;
  for (const scene of game.scene.getScenes(true)) {
    if (!['World', 'Hud'].includes(scene.scene.key)) scene.scene.stop();
  }
});

console.log('\n8. Turning the phone sideways, and back');
const boardSize = () =>
  page.evaluate(() => [window.__game.scale.gameSize.width, window.__game.scale.gameSize.height]);
const runState = () =>
  page.evaluate(() => {
    const state = window.__game.registry.get('session').state;
    return { map: state.currentMap, day: state.day, pence: state.pence };
  });

const before = await runState();
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(900);
const landscape = await boardSize();
check('rotating gives a landscape board', landscape[0] > landscape[1], landscape.join('x'));

// Landscape re-lays-out from the same code, and has its own boxes to fit.
await checkTextFits('Hud', 'Landscape HUD');
for (const [key, data] of panelList(fixtures)) {
  await page.evaluate(openPanel, { key, data });
  await page.waitForTimeout(900);
  await checkTextFits(key, `Landscape ${key}`);
}
await page.evaluate(() => {
  const game = window.__game;
  for (const scene of game.scene.getScenes(true)) {
    if (!['World', 'Hud'].includes(scene.scene.key)) scene.scene.stop();
  }
  const world = game.scene.getScene('World');
  if (world.scene.isPaused()) world.scene.resume();
});

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(900);
const returned = await boardSize();
check('rotating back gives a portrait board', returned[1] > returned[0], returned.join('x'));

// Every scene is rebuilt on rotation; the run itself lives on the registry and
// must come through untouched.
const after = await runState();
check(
  'the run survives two rotations',
  after.map === before.map && after.day === before.day && after.pence === before.pence,
  `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
);
await tapStep('a tab still works after rotating', 'Hud', 'NOTES', (list) => list.includes('Journal'));
await tapWidget('Hud', 'NOTES');
await page.waitForTimeout(300);

console.log('\n9. No runtime errors');
check('console clean', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log('\nAll touch and layout checks passed.');
