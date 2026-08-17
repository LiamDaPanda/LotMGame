import Phaser from 'phaser';
import { pixelText } from '@/ui/pixelFont';
import { Session } from '@/systems/Session';
import { bus } from '@/systems/EventBus';
import { Actor } from '@/world/Actor';
import { TileGrid, type Point } from '@/world/TileGrid';
import {
  COLORS,
  CSS,
  GAME_WIDTH,
  ICONS,
  TILE_SIZE,
  isPortrait,
  mapRect,
} from '@/ui/theme';
import type { HotspotData, MapData, MapExitData, MapNpcData } from '@/types/schema';

interface WorldSceneData {
  mapId: string;
  spawn?: Point;
}

type Interaction =
  | { kind: 'hotspot'; data: HotspotData }
  | { kind: 'npc'; data: MapNpcData }
  | { kind: 'exit'; data: MapExitData };

/**
 * The explorable world — used for the Tarot Club hub and for every case
 * location alike, because mechanically they are the same thing: a tile room
 * with people to talk to, things to examine, and doors out.
 *
 * Input is tap/click-first (walk there, then interact), with keyboard as a
 * convenience on desktop. One input model that works under a thumb was the
 * deciding factor for top-down over point-and-click.
 */
export class WorldScene extends Phaser.Scene {
  private session!: Session;
  private map!: MapData;
  private grid!: TileGrid;
  private player!: Actor;
  private npcs = new Map<string, Actor>();
  private hotspotMarkers = new Map<string, Phaser.GameObjects.Container>();
  private cursor!: Phaser.GameObjects.Graphics;
  private objectSprites: Phaser.GameObjects.Image[] = [];
  private keys!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    interact: Phaser.Input.Keyboard.Key;
    journal: Phaser.Input.Keyboard.Key;
  };
  private pendingInteraction?: Interaction;
  private busy = false;
  private unsubscribe: Array<() => void> = [];

  constructor() {
    super('World');
  }

  create(data: WorldSceneData): void {
    this.session = Session.get(this);
    const map = this.session.content.map(data.mapId);
    if (!map) throw new Error(`Unknown map: ${data.mapId}`);
    this.map = map;
    this.session.state.currentMap = map.id;
    this.grid = new TileGrid(map);

    this.cameras.main.setBackgroundColor(COLORS.ink);
    this.drawFloor();
    this.drawObjects();
    this.buildHotspots();
    this.buildExits();

    const spawn = data.spawn ?? map.spawn;
    this.player = new Actor(this, this.playerSpriteRow(), spawn.x, spawn.y);
    this.player.sprite.setDepth(spawn.y * TILE_SIZE);

    this.buildNpcs();
    this.applyAmbience();
    this.setupCamera();
    this.setupInput();

    // The HUD is a separate always-on scene; make sure it is running and
    // pointed at this scene for its overlay buttons.
    if (!this.scene.isActive('Hud')) this.scene.launch('Hud');
    this.scene.bringToTop('Hud');

    this.session.cases.refreshObjectives();
    this.announceRoom();
    this.maybeEncounter();

    this.unsubscribe.push(
      bus.on('loss-of-control', ({ reason }) => this.playLossOfControl(reason)),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const off of this.unsubscribe) off();
      this.unsubscribe = [];
    });
  }

  private playerSpriteRow(): number {
    return this.session.content.character('player')?.spriteRow ?? 0;
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /**
   * The floor never changes, so it is stamped once into a RenderTexture. A
   * 30x20 room is 600 tiles; as individual images that is 600 draw calls a
   * frame for a static backdrop.
   */
  private drawFloor(): void {
    const texture = this.add.renderTexture(
      0,
      0,
      this.grid.width * TILE_SIZE,
      this.grid.height * TILE_SIZE,
    );
    texture.setOrigin(0, 0).setDepth(-1000);

    const stamp = this.make.image({ key: 'tiles', frame: 0, add: false }).setOrigin(0, 0);
    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < this.grid.width; x++) {
        stamp.setFrame(this.grid.floor[y]?.[x] ?? 0);
        texture.draw(stamp, x * TILE_SIZE, y * TILE_SIZE);
      }
    }
    stamp.destroy();
  }

  /** Props are separate sprites so the player can walk behind them. */
  private drawObjects(): void {
    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < this.grid.width; x++) {
        const frame = this.grid.object[y]?.[x] ?? -1;
        if (frame < 0) continue;
        const image = this.add
          .image(x * TILE_SIZE, y * TILE_SIZE, 'tiles', frame)
          .setOrigin(0, 0)
          .setDepth(y * TILE_SIZE + TILE_SIZE * 0.5);
        this.objectSprites.push(image);
      }
    }
  }

  /**
   * A soft ambient wash plus a vignette. Cheap, but it is most of what makes a
   * flat tile room feel like a gaslit interior.
   */
  private applyAmbience(): void {
    if (this.map.ambient) {
      // A plain translucent wash, not MULTIPLY: multiplying a gaslamp palette
      // that is already dark takes the room past atmospheric and into unreadable.
      const tint = this.add.rectangle(
        0,
        0,
        this.grid.width * TILE_SIZE,
        this.grid.height * TILE_SIZE,
        Phaser.Display.Color.HexStringToColor(this.map.ambient).color,
        0.16,
      );
      tint.setOrigin(0, 0).setDepth(5000);
    }

    // Vignette only at the very edge of the viewport, so the middle of the room
    // keeps its contrast.
    const view = mapRect();
    const vignette = this.add.graphics().setScrollFactor(0).setDepth(6000);
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const band = 7 * (steps - i);
      vignette.fillStyle(COLORS.ink, 0.05);
      vignette.fillRect(0, 0, view.width, band);
      vignette.fillRect(0, view.height - band, view.width, band);
      vignette.fillRect(0, 0, band, view.height);
      vignette.fillRect(view.width - band, 0, band, view.height);
    }
  }

  private setupCamera(): void {
    const camera = this.cameras.main;
    // The world only owns the top pane. Giving the camera that viewport means
    // Phaser also stops delivering taps outside it, so a thumb on the menu
    // below can never accidentally walk the player somewhere.
    const view = mapRect();
    camera.setViewport(view.x, view.y, view.width, view.height);

    // Integer zoom keeps 32px art crisp under pixelArt/roundPixels, and the
    // tighter frame suits rooms you are meant to search.
    //
    // Portrait drops to 1:1. Rooms here are 14-26 tiles across but only 9-15
    // deep, and a 432px-wide board at 2x shows under seven tiles of that width
    // — you would be navigating a street through a keyhole. At 1x the whole
    // room fits instead, which is what a tap-to-move map wants.
    const zoom = isPortrait() ? 1 : 2;
    camera.setZoom(zoom);

    // Rooms smaller than the view get padded bounds so they sit in the middle
    // of the screen. Phaser's own clamping pins a too-small room to the top-left
    // instead, which in portrait leaves a third of the screen empty below it.
    const mapWidth = this.grid.width * TILE_SIZE;
    const mapHeight = this.grid.height * TILE_SIZE;
    const padX = Math.max(0, (view.width / zoom - mapWidth) / 2);
    const padY = Math.max(0, (view.height / zoom - mapHeight) / 2);
    camera.setBounds(-padX, -padY, mapWidth + padX * 2, mapHeight + padY * 2);

    camera.startFollow(this.player.sprite, true, 0.12, 0.12);
    camera.fadeIn(350, 0, 0, 0);
  }

  // -------------------------------------------------------------------------
  // World contents
  // -------------------------------------------------------------------------

  private visibleHotspots(): HotspotData[] {
    return this.map.hotspots ?? [];
  }

  private buildHotspots(): void {
    for (const hotspot of this.visibleHotspots()) {
      const marker = this.add.container(
        hotspot.x * TILE_SIZE + TILE_SIZE / 2,
        hotspot.y * TILE_SIZE + TILE_SIZE / 2,
      );
      marker.setDepth(hotspot.y * TILE_SIZE + TILE_SIZE);

      const glow = this.add.circle(0, 0, 14, COLORS.brass, 0.22);
      const icon = this.add.image(0, -2, 'icons', hotspot.icon ?? ICONS.clue).setScale(1.1);
      marker.add([glow, icon]);

      // A slow pulse marks it as interactive without a permanent bright dot.
      this.tweens.add({
        targets: glow,
        scale: { from: 0.85, to: 1.25 },
        alpha: { from: 0.28, to: 0.1 },
        duration: 1600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      this.hotspotMarkers.set(hotspot.id, marker);
    }
    this.refreshHotspotMarkers();
  }

  /**
   * The Sequence 9 passive (`sense_danger` on the Seer's Augur's Glance) makes
   * hotspots that still hide an ability-only clue glimmer differently. This is
   * the passive doing real work: it tells you where power would pay off.
   */
  private refreshHotspotMarkers(): void {
    const hasAugur = this.session.abilities.hasPassive('sense_danger');
    for (const hotspot of this.visibleHotspots()) {
      const marker = this.hotspotMarkers.get(hotspot.id);
      if (!marker) continue;
      const icon = marker.list[1] as Phaser.GameObjects.Image;
      const glow = marker.list[0] as Phaser.GameObjects.Arc;

      const undiscovered = this.undiscoveredClues(hotspot);
      const hiddenRemaining = this.hiddenClueCount(hotspot) > 0;

      if (hasAugur && hiddenRemaining) {
        glow.setFillStyle(COLORS.occult, 0.32);
        icon.setFrame(ICONS.spirituality).setAlpha(1);
      } else if (undiscovered === 0) {
        glow.setFillStyle(COLORS.muted, 0.1);
        icon.setFrame(hotspot.icon ?? ICONS.clue).setAlpha(0.4);
      } else {
        glow.setFillStyle(COLORS.brass, 0.22);
        icon.setFrame(hotspot.icon ?? ICONS.clue).setAlpha(1);
      }
    }
  }

  private undiscoveredClues(hotspot: HotspotData): number {
    return (hotspot.clues ?? []).filter((id) => !this.session.state.hasClue(id)).length;
  }

  private hiddenClueCount(hotspot: HotspotData): number {
    const all = Object.values(hotspot.abilityClues ?? {}).flat();
    return all.filter((id) => !this.session.state.hasClue(id)).length;
  }

  private buildNpcs(): void {
    for (const npc of this.map.npcs ?? []) {
      if (!this.session.state.check(npc.requires)) continue;
      const character = this.session.content.character(npc.id);
      const actor = new Actor(this, character?.spriteRow ?? 1, npc.x, npc.y);
      actor.sprite.setDepth(npc.y * TILE_SIZE);
      // Standing people are obstacles, so paths route around them.
      this.grid.setBlocked(npc.x, npc.y, true);

      const label = pixelText(this, 
          npc.x * TILE_SIZE + TILE_SIZE / 2,
          npc.y * TILE_SIZE - 18,
          character?.name ?? npc.id,
          { fontSize: '10px', color: CSS.brass },
        )
        .setOrigin(0.5)
        .setDepth(9000)
        .setAlpha(0.85);
      label.setShadow(0, 1, '#000000', 2);

      this.npcs.set(npc.id, actor);
    }
  }

  private buildExits(): void {
    for (const exit of this.map.exits ?? []) {
      const marker = this.add.container(
        exit.x * TILE_SIZE + TILE_SIZE / 2,
        exit.y * TILE_SIZE + TILE_SIZE / 2,
      );
      marker.setDepth(exit.y * TILE_SIZE + 1);
      const arrow = this.add.triangle(0, -6, 0, -6, -6, 4, 6, 4, COLORS.brass, 0.75);
      const label = pixelText(this, 0, 8, exit.label, { fontSize: '9px', color: CSS.brass })
        .setOrigin(0.5);
      label.setShadow(0, 1, '#000000', 2);
      marker.add([arrow, label]);
      this.tweens.add({
        targets: arrow,
        y: { from: -8, to: -3 },
        duration: 1100,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  private announceRoom(): void {
    const banner = pixelText(this, GAME_WIDTH / 2, 64, this.map.name, {
        fontSize: '20px',
        color: CSS.brass,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(7000);
    banner.setShadow(0, 2, '#000000', 4);
    this.tweens.add({ targets: banner, alpha: 0, delay: 1800, duration: 700, onComplete: () => banner.destroy() });
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private setupInput(): void {
    this.cursor = this.add.graphics().setDepth(8000);

    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.keys = {
        up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        interact: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        journal: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J),
      };
      keyboard.addCapture([
        Phaser.Input.Keyboard.KeyCodes.W,
        Phaser.Input.Keyboard.KeyCodes.A,
        Phaser.Input.Keyboard.KeyCodes.S,
        Phaser.Input.Keyboard.KeyCodes.D,
        Phaser.Input.Keyboard.KeyCodes.SPACE,
        Phaser.Input.Keyboard.KeyCodes.UP,
        Phaser.Input.Keyboard.KeyCodes.DOWN,
        Phaser.Input.Keyboard.KeyCodes.LEFT,
        Phaser.Input.Keyboard.KeyCodes.RIGHT,
      ]);
      keyboard.on('keydown-J', () => this.openJournal());
      keyboard.on('keydown-ESC', () => this.openJournal());
      keyboard.on('keydown-Q', () => this.openAbilityMenu());
    }

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.busy) return;
      // The camera's viewport already keeps taps outside the map pane away from
      // this scene, but a pointer that started inside and drifted out still
      // arrives here, so check anyway.
      const view = mapRect();
      if (pointer.y < view.y || pointer.y > view.y + view.height) return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.handleTap({
        x: Math.floor(world.x / TILE_SIZE),
        y: Math.floor(world.y / TILE_SIZE),
      });
    });
  }

  private handleTap(tile: Point): void {
    const interaction = this.interactionAt(tile);
    const from = { x: this.player.tileX, y: this.player.tileY };

    if (interaction) {
      const target = this.grid.nearestAdjacent(tile, from);
      if (!target) {
        this.flashCursor(tile, COLORS.bad);
        return;
      }
      this.flashCursor(tile, COLORS.brass);
      if (target.x === from.x && target.y === from.y) {
        this.player.faceToward(tile);
        this.runInteraction(interaction);
        return;
      }
      this.pendingInteraction = interaction;
      this.player.setPath(this.grid.findPath(from, target), () => {
        this.player.faceToward(tile);
        const pending = this.pendingInteraction;
        this.pendingInteraction = undefined;
        if (pending) this.runInteraction(pending);
      });
      return;
    }

    if (!this.grid.walkable(tile.x, tile.y)) {
      this.flashCursor(tile, COLORS.bad);
      return;
    }
    const path = this.grid.findPath(from, tile);
    if (path.length === 0) {
      this.flashCursor(tile, COLORS.bad);
      return;
    }
    this.flashCursor(tile, COLORS.parchment);
    this.pendingInteraction = undefined;
    this.player.setPath(path);
  }

  private interactionAt(tile: Point): Interaction | undefined {
    for (const hotspot of this.visibleHotspots()) {
      if (hotspot.x === tile.x && hotspot.y === tile.y) return { kind: 'hotspot', data: hotspot };
    }
    for (const npc of this.map.npcs ?? []) {
      if (npc.x === tile.x && npc.y === tile.y && this.npcs.has(npc.id)) {
        return { kind: 'npc', data: npc };
      }
    }
    for (const exit of this.map.exits ?? []) {
      if (exit.x === tile.x && exit.y === tile.y) return { kind: 'exit', data: exit };
    }
    return undefined;
  }

  private flashCursor(tile: Point, color: number): void {
    this.cursor.clear();
    this.cursor.lineStyle(2, color, 0.9);
    this.cursor.strokeRect(tile.x * TILE_SIZE + 2, tile.y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    this.tweens.killTweensOf(this.cursor);
    this.cursor.setAlpha(1);
    this.tweens.add({ targets: this.cursor, alpha: 0, duration: 500, delay: 120 });
  }

  // -------------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------------

  private runInteraction(interaction: Interaction): void {
    switch (interaction.kind) {
      case 'hotspot':
        if (interaction.data.action) this.runHotspotAction(interaction.data);
        else this.openExamine(interaction.data);
        break;
      case 'npc':
        this.openDialogue(interaction.data);
        break;
      case 'exit':
        this.takeExit(interaction.data);
        break;
    }
  }

  /** Hub fixtures: the board, the requisition table, the rite, a bed. */
  private runHotspotAction(hotspot: HotspotData): void {
    switch (hotspot.action) {
      case 'case_board':
        this.openModal('CaseBoard');
        break;
      case 'shop':
        this.openModal('Shop', { vendor: 'club' });
        break;
      case 'black_market':
        this.openModal('Shop', { vendor: 'market' });
        break;
      case 'training':
        this.openModal('Training');
        break;
      case 'inquiry':
        this.openModal('Inquiry');
        break;
      case 'ritual':
        this.openModal('Ritual');
        break;
      case 'resolve':
        if (this.session.cases.activeCase()) this.openModal('Resolve');
        else bus.emit('notice', { text: 'You have nothing to report.', tone: 'info' });
        break;
      case 'rest':
        this.rest(hotspot);
        break;
      default:
        this.openExamine(hotspot);
    }
  }

  private rest(hotspot: HotspotData): void {
    const safe = hotspot.id.includes('club');
    this.session.abilities.rest(safe);
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.cameras.main.fadeIn(500, 0, 0, 0);
      bus.emit('notice', {
        text: safe
          ? 'You sleep in the Club’s back room. Nothing finds you there.'
          : 'You sleep badly, and dream of a door that was bolted from the inside.',
        tone: safe ? 'good' : 'info',
      });
    });
  }

  private openModal(key: string, data?: object): void {
    // One overlay at a time. A delayed encounter must never land on top of a
    // shop the player already opened.
    if (this.busy) return;
    this.busy = true;
    this.scene.pause();
    this.scene.launch(key, data);
    this.scene.get(key).events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.busy = false;
      this.refreshHotspotMarkers();
      this.session.cases.refreshObjectives();
    });
  }

  private openExamine(hotspot: HotspotData): void {
    this.busy = true;
    this.scene.pause();
    this.scene.launch('Examine', {
      hotspot,
      mapId: this.map.id,
      // Using a power in front of somebody is what costs concealment, so
      // "is anyone in this room" is a real mechanical question.
      witnessed: this.witnessesNearby(hotspot),
    });
    this.scene.get('Examine').events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.busy = false;
      this.refreshHotspotMarkers();
      this.session.cases.refreshObjectives();
    });
  }

  /** Anyone standing within earshot of the hotspot. */
  private witnessesNearby(hotspot: HotspotData): boolean {
    for (const [id, actor] of this.npcs) {
      void id;
      if (TileGrid.distance({ x: actor.tileX, y: actor.tileY }, hotspot) <= 6) return true;
    }
    return false;
  }

  private openDialogue(npc: MapNpcData): void {
    this.busy = true;
    this.scene.pause();
    this.scene.launch('Dialogue', { treeId: npc.dialogue, speaker: npc.id });
    this.scene.get('Dialogue').events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.busy = false;
      this.refreshHotspotMarkers();
      this.session.cases.refreshObjectives();
    });
  }

  private takeExit(exit: MapExitData): void {
    if (!this.session.state.check(exit.requires)) {
      bus.emit('notice', { text: this.session.state.explain(exit.requires) ?? 'That way is shut.', tone: 'bad' });
      return;
    }
    this.busy = true;
    this.cameras.main.fadeOut(280, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ mapId: exit.toMap, spawn: { x: exit.toX, y: exit.toY } });
    });
  }

  /** The powers menu — abilities fired deliberately rather than when offered. */
  private openAbilityMenu(): void {
    if (this.busy) return;
    this.openModal('AbilityMenu', {
      context: this.map.id === 'club_hub' ? 'hub' : 'investigation',
      witnessed: this.npcs.size > 0,
    });
  }

  /**
   * Roll for an encounter on arrival. Doing it after the room has drawn means
   * the player sees where they are before somebody steps out of it.
   */
  private maybeEncounter(): void {
    const chance = this.map.encounterChance ?? 0;
    if (chance <= 0) return;
    const encounter = this.session.encounters.roll(this.map.id, chance);
    if (!encounter) return;
    this.time.delayedCall(700, () => {
      if (this.busy) return;
      this.player.stop();
      this.openModal('Encounter', { encounterId: encounter.id });
    });
  }

  private openJournal(): void {
    if (this.busy) return;
    this.busy = true;
    this.scene.pause();
    this.scene.launch('Journal');
    this.scene.get('Journal').events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.busy = false;
      this.refreshHotspotMarkers();
    });
  }

  /** A short, ugly camera fit for losing your grip on yourself. */
  private playLossOfControl(reason: string): void {
    this.cameras.main.shake(600, 0.012);
    this.cameras.main.flash(400, 120, 40, 60);
    bus.emit('notice', { text: reason, tone: 'bad' });
  }

  // -------------------------------------------------------------------------

  override update(_time: number, delta: number): void {
    this.player.update(delta);
    this.player.sprite.setDepth(this.player.sprite.y);
    for (const npc of this.npcs.values()) npc.update(delta);

    if (this.busy || !this.keys) return;

    // Keyboard walking, one tile per keypress-hold cycle.
    if (!this.player.moving) {
      const keyboard = this.input.keyboard;
      const left = this.keys.left.isDown || keyboard?.checkDown(keyboard.addKey('LEFT'), 0);
      const right = this.keys.right.isDown || keyboard?.checkDown(keyboard.addKey('RIGHT'), 0);
      const up = this.keys.up.isDown || keyboard?.checkDown(keyboard.addKey('UP'), 0);
      const down = this.keys.down.isDown || keyboard?.checkDown(keyboard.addKey('DOWN'), 0);

      if (left) this.player.stepTowards(-1, 0, (x, y) => this.grid.walkable(x, y));
      else if (right) this.player.stepTowards(1, 0, (x, y) => this.grid.walkable(x, y));
      else if (up) this.player.stepTowards(0, -1, (x, y) => this.grid.walkable(x, y));
      else if (down) this.player.stepTowards(0, 1, (x, y) => this.grid.walkable(x, y));
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.interact)) {
      const front = this.player.facingTile;
      const interaction = this.interactionAt(front);
      if (interaction) this.runInteraction(interaction);
    }
  }
}
