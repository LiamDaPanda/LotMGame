#!/usr/bin/env node
// Portrait + touch regression test.
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
//   npm run build && npm run preview &
//   node tools/touchtest.mjs [baseUrl]
import fs from 'node:fs';
import { chromium } from 'playwright';

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

await page.goto(BASE, { waitUntil: 'networkidle' });
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
 * Nothing may draw text outside the box it belongs to.
 *
 * The pixel font is fixed-width precisely so this is decidable, and a phone is
 * where an overflowing line actually costs you the word. Panels declare their
 * pane; text is checked against it.
 */
const checkTextFits = async (sceneKey, label) => {
  const overflows = await page.evaluate((key) => {
    const game = window.__game;
    const scene = game.scene.getScene(key);
    if (!scene || !scene.scene.isActive()) return [];
    const board = { width: game.scale.gameSize.width, height: game.scale.gameSize.height };

    const found = [];
    // `clip` is the box the object is actually visible in. A scrolling list
    // publishes its own, because content below the fold is meant to be cut off
    // — that is not an overflow, and only the list's own box has to fit.
    const walk = (object, clip) => {
      if (object.type === 'Container') {
        const own = object.getData?.('clipRect');
        const next = own
          ? {
              left: Math.max(clip.left, own.x),
              right: Math.min(clip.right, own.x + own.width),
              // A scrolling list clips vertically on purpose — rows below the
              // fold are reachable by dragging, not lost. Only its sideways
              // bounds are a layout promise.
              top: own.scrolls ? -Infinity : Math.max(clip.top, own.y),
              bottom: own.scrolls ? Infinity : Math.min(clip.bottom, own.y + own.height),
            }
          : clip;
        for (const child of object.list) walk(child, next);
        return;
      }
      if (object.type !== 'BitmapText' || !object.text) return;
      const bounds = object.getBounds();
      // A tolerance of one board pixel: origins and rounding land on halves.
      const over = [];
      if (bounds.left < clip.left - 1) over.push(`left ${Math.round(bounds.left)} < ${clip.left}`);
      if (bounds.right > clip.right + 1) over.push(`right ${Math.round(bounds.right)} > ${clip.right}`);
      if (bounds.top < clip.top - 1) over.push(`top ${Math.round(bounds.top)} < ${clip.top}`);
      if (bounds.bottom > clip.bottom + 1) over.push(`bottom ${Math.round(bounds.bottom)} > ${clip.bottom}`);
      if (over.length) {
        found.push({ text: object.text.split('\n')[0].slice(0, 40), over: over.join(', ') });
      }
    };
    const board_ = { left: 0, top: 0, right: board.width, bottom: board.height };
    for (const object of scene.children.list) walk(object, board_);
    return found;
  }, sceneKey);

  check(
    `${label}: all text inside the board`,
    overflows.length === 0,
    overflows.map((o) => `"${o.text}" (${o.over})`).join(' | '),
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

console.log('\n3. Touch reaches the menu');
await tapStep('New Investigation starts the game', 'MainMenu', 'New Investigation', (list) =>
  list.includes('World'),
);
await page.waitForTimeout(600);

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

/**
 * Launch an overlay directly and check its text fits.
 *
 * Reaching some of these by play takes a whole case; the layouts still have to
 * hold, so they are opened straight from the scene manager with plausible data.
 */
const openOverlay = (key, data) =>
  page.evaluate(
    ({ key, data }) => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) {
        if (!['World', 'Hud'].includes(scene.scene.key)) scene.scene.stop();
      }
      const world = game.scene.getScene('World');
      if (world.scene.isActive()) world.scene.pause();
      world.scene.launch(key, data);
    },
    { key, data },
  );

/** Pick real content out of the loaded data, so the panels have real text. */
const fixtures = await page.evaluate(() => {
  const session = window.__game.registry.get('session');
  const map = session.content.map('club_hub');
  const anyMapWithHotspot = [...session.content.maps.values()].find((m) => m.hotspots?.length);
  const tree = [...session.content.dialogue.keys()][0];
  const encounter = [...session.content.encounters.keys()][0];
  return {
    treeId: tree,
    hotspot: anyMapWithHotspot?.hotspots[0],
    mapId: anyMapWithHotspot?.id,
    encounterId: encounter,
    npc: map.npcs?.[0]?.id,
  };
});

console.log('\n7. Every panel keeps its text inside the pane');
const panels = [
  ['Dialogue', { treeId: fixtures.treeId, speaker: fixtures.npc }],
  ['Examine', { hotspot: fixtures.hotspot, mapId: fixtures.mapId, witnessed: false }],
  ['Shop', { vendor: 'club' }],
  ['Encounter', { encounterId: fixtures.encounterId }],
  ['Training', {}],
  ['Inquiry', {}],
  ['Ritual', {}],
];
for (const [key, data] of panels) {
  await openOverlay(key, data);
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

console.log('\n8. No runtime errors');
check('console clean', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log('\nAll portrait touch checks passed.');
