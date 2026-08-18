/**
 * "Does every line of text stay inside the box it belongs to?"
 *
 * Shared by the portrait touch test and the landscape playtest, because the
 * answer has to hold in both and the boxes differ between them.
 *
 * A box is whichever of these encloses the text most tightly:
 *   - the board itself;
 *   - a scrolling list's viewport, which clips sideways for real but clips
 *     vertically on purpose — rows below the fold are a drag away, not lost;
 *   - a button's plate, which is the case that bites: a label that wraps to two
 *     lines in a 38px-tall button is not off the screen, it is just printed
 *     over the button's own border, and nothing about the board notices.
 */

/** Runs inside the page. Returns a list of offending texts for one scene. */
export function collectOverflows(sceneKey) {
  const game = window.__game;
  const scene = game.scene.getScene(sceneKey);
  if (!scene || !scene.scene.isActive()) return null;

  const board = {
    left: 0,
    top: 0,
    right: game.scale.gameSize.width,
    bottom: game.scale.gameSize.height,
  };
  const found = [];

  const intersect = (clip, box, scrolls) => ({
    left: Math.max(clip.left, box.left),
    right: Math.min(clip.right, box.right),
    top: scrolls ? -Infinity : Math.max(clip.top, box.top),
    bottom: scrolls ? Infinity : Math.min(clip.bottom, box.bottom),
  });

  const walk = (object, clip, boxName) => {
    if (object.type === 'Container') {
      let next = clip;
      let name = boxName;

      // A scrolling list publishes its own viewport; a geometry mask is a
      // Graphics, so there is no other way to ask where the clip is.
      const listClip = object.getData?.('clipRect');
      if (listClip) {
        next = intersect(
          next,
          {
            left: listClip.x,
            right: listClip.x + listClip.width,
            top: listClip.y,
            bottom: listClip.y + listClip.height,
          },
          listClip.scrolls,
        );
        name = 'list';
      } else if (object.input?.hitArea && object.width && object.height) {
        // An interactive container is a plate with a label on it. Its label
        // has to fit the plate, not merely the screen.
        const matrix = object.getWorldTransformMatrix();
        next = intersect(
          next,
          {
            left: matrix.tx,
            right: matrix.tx + object.width,
            top: matrix.ty,
            bottom: matrix.ty + object.height,
          },
          false,
        );
        name = 'button';
      }

      for (const child of object.list) walk(child, next, name);
      return;
    }

    if (object.type !== 'BitmapText' || !object.text) return;
    const bounds = object.getBounds();
    // One board pixel of tolerance: origins and rounding land on halves.
    const over = [];
    if (bounds.left < clip.left - 1) over.push(`left ${Math.round(bounds.left)} < ${Math.round(clip.left)}`);
    if (bounds.right > clip.right + 1) over.push(`right ${Math.round(bounds.right)} > ${Math.round(clip.right)}`);
    if (bounds.top < clip.top - 1) over.push(`top ${Math.round(bounds.top)} < ${Math.round(clip.top)}`);
    if (bounds.bottom > clip.bottom + 1) {
      over.push(`bottom ${Math.round(bounds.bottom)} > ${Math.round(clip.bottom)}`);
    }
    if (over.length) {
      found.push(`"${object.text.split('\n')[0].slice(0, 32)}" out of ${boxName} (${over.join(', ')})`);
    }
  };

  for (const object of scene.children.list) walk(object, board, 'board');
  return found;
}

/**
 * Content to open each panel with. Reaching some of these by play takes a whole
 * case, so both suites launch them straight from the scene manager instead.
 */
export function panelFixtures() {
  const session = window.__game.registry.get('session');
  const withHotspot = [...session.content.maps.values()].find((map) => map.hotspots?.length);
  return {
    treeId: [...session.content.dialogue.keys()][0],
    hotspot: withHotspot?.hotspots[0],
    mapId: withHotspot?.id,
    encounterId: [...session.content.encounters.keys()][0],
  };
}

/** Open one overlay on top of a paused world, closing any other first. */
export function openPanel({ key, data }) {
  const game = window.__game;
  for (const scene of game.scene.getScenes(true)) {
    if (!['World', 'Hud'].includes(scene.scene.key)) scene.scene.stop();
  }
  const world = game.scene.getScene('World');
  if (world.scene.isActive()) world.scene.pause();
  world.scene.launch(key, data);
}

/** The panels worth checking, given a fixtures object from `panelFixtures`. */
export function panelList(fixtures) {
  return [
    ['Journal', {}],
    ['CaseBoard', {}],
    ['AbilityMenu', { context: 'investigation', witnessed: false }],
    ['Dialogue', { treeId: fixtures.treeId }],
    ['Examine', { hotspot: fixtures.hotspot, mapId: fixtures.mapId, witnessed: false }],
    ['Shop', { vendor: 'club' }],
    ['Encounter', { encounterId: fixtures.encounterId }],
    ['Training', {}],
    ['Inquiry', {}],
    ['Ritual', {}],
  ];
}

/**
 * "Does any text sit on top of any other text?"
 *
 * Fitting each label inside its own box does not stop two boxes being placed on
 * top of each other — which is what "the text overlaps" looks like on a phone.
 * Runs inside the page; returns colliding pairs for one scene.
 */
export function collectCollisions(sceneKey) {
  const game = window.__game;
  const scene = game.scene.getScene(sceneKey);
  if (!scene || !scene.scene.isActive()) return null;

  const board = {
    left: 0,
    top: 0,
    right: game.scale.gameSize.width,
    bottom: game.scale.gameSize.height,
  };
  const texts = [];

  // Same clipping as collectOverflows: a row scrolled below the fold is not
  // drawn, so it cannot be sitting on top of anything.
  const walk = (object, clip) => {
    if (object.type === 'Container') {
      let next = clip;
      const listClip = object.getData?.('clipRect');
      if (listClip) {
        next = {
          left: Math.max(clip.left, listClip.x),
          right: Math.min(clip.right, listClip.x + listClip.width),
          top: Math.max(clip.top, listClip.y),
          bottom: Math.min(clip.bottom, listClip.y + listClip.height),
        };
      }
      for (const child of object.list) walk(child, next);
      return;
    }
    if (object.type !== 'BitmapText' || !object.text.trim()) return;
    if (object.alpha < 0.05 || !object.visible) return;

    const raw = object.getBounds();
    const visible = {
      left: Math.max(raw.left, clip.left),
      right: Math.min(raw.right, clip.right),
      top: Math.max(raw.top, clip.top),
      bottom: Math.min(raw.bottom, clip.bottom),
    };
    if (visible.right - visible.left < 1 || visible.bottom - visible.top < 1) return;
    texts.push({ text: object.text.split('\n')[0].slice(0, 26), bounds: visible });
  };
  for (const object of scene.children.list) walk(object, board);

  const hits = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i].bounds;
      const b = texts[j].bounds;
      // Two board pixels of slack: adjacent lines share a rounded edge.
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlapX > 2 && overlapY > 2) {
        hits.push(`"${texts[i].text}" over "${texts[j].text}" (${Math.round(overlapX)}x${Math.round(overlapY)}px)`);
      }
    }
  }
  return hits;
}
