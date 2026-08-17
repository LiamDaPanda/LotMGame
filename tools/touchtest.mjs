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
          label: object.list.filter((child) => child.type === 'Text').map((child) => child.text)[0] ?? '',
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
await tapStep('Journal opens', 'Hud', 'Journal', (list) => list.includes('Journal'));
await checkAlignment('Journal');
await tapStep('Journal closes', 'Journal', 'Close', (list) => !list.includes('Journal'));
await tapStep('Powers opens', 'Hud', 'Powers', (list) => list.includes('AbilityMenu'));
await checkAlignment('AbilityMenu');
await tapStep('Powers closes', 'AbilityMenu', 'Close', (list) => !list.includes('AbilityMenu'));

console.log('\n6. No runtime errors');
check('console clean', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log('\nAll portrait touch checks passed.');
