/**
 * The handheld's controls: a thumb D-pad and two face buttons, drawn on the
 * bottom screen and read by the world every frame.
 *
 * Tap-to-move is still there, but it is not how a handheld feels. Holding a
 * direction and walking is, and it is the only input model that lets you stroll
 * past something interesting and change your mind halfway.
 *
 * The pad's state lives in a module-level object rather than on the scene that
 * draws it, because the scene that draws it (the HUD) is not the scene that
 * reads it (the world). Both survive each other's restarts.
 */

import Phaser from 'phaser';
import { PixelText, pixelText } from '@/ui/pixelFont';
import { COLORS, CSS, type Rect } from '@/ui/theme';

export type PadDirection = 'up' | 'down' | 'left' | 'right';

export interface PadState {
  /** Direction currently held, or null. */
  dir: PadDirection | null;
  /** B held: walk faster. */
  run: boolean;
}

export const pad: PadState = { dir: null, run: false };

/** Fired on a press of A (interact) or B. Scenes subscribe; the HUD emits. */
export const padEvents = new Phaser.Events.EventEmitter();

/** Let go of everything — called whenever the pad is hidden. */
export function releasePad(): void {
  pad.dir = null;
  pad.run = false;
}

/**
 * The pad that is currently on screen, if any.
 *
 * The world scene needs this: in landscape the controls float over the map, and
 * both scenes see the same pointer — without a claim here, pressing left would
 * also order the player to walk to whichever tile is under the left arrow.
 */
let live: { zone: Rect; visible: boolean } | undefined;

/** True when the on-screen controls own this point. */
export function padConsumes(x: number, y: number): boolean {
  if (!live?.visible) return false;
  const { zone } = live;
  return x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height;
}

/** Ignore a touch this close to the pad's centre, so a resting thumb is still. */
const DEAD_ZONE = 14;

/**
 * The D-pad is a zone, not four buttons: whichever quadrant of the cross your
 * thumb is in wins, and sliding it around changes direction without lifting.
 * That is how a real one behaves, and on glass it is the difference between
 * turning a corner and stopping at it.
 */
export class GamePad extends Phaser.GameObjects.Container {
  private padCentre: { x: number; y: number };
  private padRadius: number;
  private keys = new Map<PadDirection, Phaser.GameObjects.Graphics>();
  private aButton!: Phaser.GameObjects.Container;
  private bButton!: Phaser.GameObjects.Container;
  private padPointer?: number;
  private runPointer?: number;
  private handlers: Array<[string, (pointer: Phaser.Input.Pointer) => void]> = [];

  constructor(scene: Phaser.Scene, zone: Rect) {
    super(scene, 0, 0);
    scene.add.existing(this);
    live = { zone, visible: true };

    // The cross sits in the left third, the face buttons in the right — the
    // arrangement every handheld has, because that is where thumbs already are.
    this.padRadius = Math.min(zone.height / 2 - 6, 84);
    this.padCentre = { x: zone.x + this.padRadius + 22, y: zone.y + zone.height / 2 };

    this.drawCross();
    const buttonX = zone.x + zone.width - 66;
    const buttonY = zone.y + zone.height / 2;
    this.aButton = this.drawFaceButton(buttonX, buttonY - 18, 40, 'A', COLORS.brass, () =>
      padEvents.emit('a'),
    );
    this.bButton = this.drawFaceButton(buttonX - 88, buttonY + 30, 32, 'B', COLORS.brassDim);
    this.wireInput(zone);
  }

  /** A plus of three squares, the middle one recessed. */
  private drawCross(): void {
    const arm = this.padRadius;
    const width = arm * 0.66;

    const plate = this.scene.add.graphics();
    plate.fillStyle(COLORS.soot, 1);
    plate.fillRect(this.padCentre.x - arm, this.padCentre.y - width / 2, arm * 2, width);
    plate.fillRect(this.padCentre.x - width / 2, this.padCentre.y - arm, width, arm * 2);
    plate.lineStyle(2, COLORS.brassDim, 0.8);
    plate.strokeRect(this.padCentre.x - arm, this.padCentre.y - width / 2, arm * 2, width);
    plate.strokeRect(this.padCentre.x - width / 2, this.padCentre.y - arm, width, arm * 2);
    this.add(plate);

    const offsets: Record<PadDirection, { x: number; y: number; points: number[] }> = {
      up: { x: 0, y: -arm * 0.66, points: [0, -7, -8, 5, 8, 5] },
      down: { x: 0, y: arm * 0.66, points: [0, 7, -8, -5, 8, -5] },
      left: { x: -arm * 0.66, y: 0, points: [-7, 0, 5, -8, 5, 8] },
      right: { x: arm * 0.66, y: 0, points: [7, 0, -5, -8, -5, 8] },
    };

    for (const [direction, spec] of Object.entries(offsets) as [
      PadDirection,
      (typeof offsets)['up'],
    ][]) {
      const key = this.scene.add.graphics();
      key.x = this.padCentre.x + spec.x;
      key.y = this.padCentre.y + spec.y;
      key.fillStyle(COLORS.parchment, 0.75);
      key.fillTriangle(
        spec.points[0] ?? 0,
        spec.points[1] ?? 0,
        spec.points[2] ?? 0,
        spec.points[3] ?? 0,
        spec.points[4] ?? 0,
        spec.points[5] ?? 0,
      );
      this.add(key);
      this.keys.set(direction, key);
    }
  }

  private drawFaceButton(
    x: number,
    y: number,
    radius: number,
    label: string,
    color: number,
    onPress?: () => void,
  ): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y);
    const disc = this.scene.add.circle(0, 0, radius, COLORS.soot, 1);
    disc.setStrokeStyle(2, color, 0.9);
    const text: PixelText = pixelText(this.scene, 0, 0, label, {
      size: 'lg',
      color: label === 'A' ? CSS.brass : CSS.muted,
    }).setOrigin(0.5);
    container.add([disc, text]);
    container.setData('disc', disc);
    container.setData('radius', radius);
    container.setData('color', color);
    container.setData('press', onPress);
    this.add(container);
    return container;
  }

  /**
   * Pointer handling is done at the scene level rather than per-object: the
   * pad needs to follow a finger that slides off the arrow it started on, and
   * an object hit area by definition stops listening the moment it does.
   */
  private wireInput(zone: Rect): void {
    const within = (pointer: Phaser.Input.Pointer, target: Phaser.GameObjects.Container) => {
      const radius = target.getData('radius') as number;
      return Phaser.Math.Distance.Between(pointer.x, pointer.y, target.x, target.y) <= radius + 8;
    };
    const inZone = (pointer: Phaser.Input.Pointer) =>
      pointer.x >= zone.x &&
      pointer.x <= zone.x + zone.width &&
      pointer.y >= zone.y &&
      pointer.y <= zone.y + zone.height;

    const down = (pointer: Phaser.Input.Pointer) => {
      if (!this.visible) return;
      if (within(pointer, this.aButton)) {
        this.flash(this.aButton);
        (this.aButton.getData('press') as (() => void) | undefined)?.();
        return;
      }
      if (within(pointer, this.bButton)) {
        this.runPointer = pointer.id;
        pad.run = true;
        this.flash(this.bButton);
        return;
      }
      if (!inZone(pointer)) return;
      this.padPointer = pointer.id;
      this.aim(pointer);
    };

    const move = (pointer: Phaser.Input.Pointer) => {
      if (!this.visible || pointer.id !== this.padPointer) return;
      this.aim(pointer);
    };

    const up = (pointer: Phaser.Input.Pointer) => {
      if (pointer.id === this.padPointer) {
        this.padPointer = undefined;
        pad.dir = null;
        this.highlight(null);
      }
      if (pointer.id === this.runPointer) {
        this.runPointer = undefined;
        pad.run = false;
      }
    };

    this.handlers = [
      ['pointerdown', down],
      ['pointermove', move],
      ['pointerup', up],
      ['pointerupoutside', up],
    ];
    for (const [event, handler] of this.handlers) this.scene.input.on(event, handler);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      for (const [event, handler] of this.handlers) this.scene.input.off(event, handler);
      live = undefined;
      releasePad();
    });
  }

  /** Whichever way the thumb is from the cross's centre. */
  private aim(pointer: Phaser.Input.Pointer): void {
    const dx = pointer.x - this.padCentre.x;
    const dy = pointer.y - this.padCentre.y;
    if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) {
      pad.dir = null;
      this.highlight(null);
      return;
    }
    const direction: PadDirection =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    pad.dir = direction;
    this.highlight(direction);
  }

  private highlight(direction: PadDirection | null): void {
    for (const [key, graphic] of this.keys) {
      graphic.setAlpha(key === direction ? 1 : 0.75);
      graphic.setScale(key === direction ? 1.15 : 1);
    }
  }

  private flash(button: Phaser.GameObjects.Container): void {
    const disc = button.getData('disc') as Phaser.GameObjects.Arc;
    const color = button.getData('color') as number;
    disc.setFillStyle(color, 0.35);
    this.scene.time.delayedCall(140, () => disc.setFillStyle(COLORS.soot, 1));
  }

  /**
   * Safety net, called every frame by the HUD.
   *
   * A held direction is the one piece of state here that can strand the player:
   * if a touch ends without its pointerup ever arriving — the browser cancels
   * it, the finger leaves the canvas, a panel steals focus mid-press — the pad
   * would keep walking him. So when nothing at all is touching the screen,
   * nothing is held.
   */
  tick(): void {
    if (this.padPointer === undefined && this.runPointer === undefined) return;
    const anyDown = this.scene.input.manager.pointers.some((pointer) => pointer.isDown);
    if (anyDown) return;
    this.padPointer = undefined;
    this.runPointer = undefined;
    releasePad();
    this.highlight(null);
  }

  /** Hidden while a panel owns the bottom screen — and hands off the controls. */
  setShown(shown: boolean): this {
    if (this.visible === shown) return this;
    this.setVisible(shown);
    if (live) live.visible = shown;
    if (!shown) {
      this.padPointer = undefined;
      this.runPointer = undefined;
      releasePad();
      this.highlight(null);
    }
    return this;
  }
}
