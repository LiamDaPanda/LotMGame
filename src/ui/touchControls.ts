/**
 * The controls: a floating thumbstick and one action button, centred on the
 * bottom screen.
 *
 * This deliberately is not a console pad. A D-pad in the bottom-left corner is
 * a thing you have to look down at and aim for, and a phone in one hand is held
 * nowhere near where a Game Boy's left thumb would be. So:
 *
 *   - the stick has no fixed home. Press anywhere in the control band and it
 *     appears under your thumb, wherever that turned out to be;
 *   - how far you push decides how fast you walk, so there is no run button to
 *     hold with a second finger;
 *   - the whole cluster is centred rather than pushed into the corners, which
 *     is what makes it reachable left-handed, right-handed, or with the phone
 *     flat on a table.
 *
 * The state lives in a module-level object rather than on the scene that draws
 * it, because the scene that draws it (the HUD) is not the scene that reads it
 * (the world). Both survive each other's restarts.
 */

import Phaser from 'phaser';
import { pixelText } from '@/ui/pixelFont';
import { COLORS, CSS, type Rect } from '@/ui/theme';

export type PadDirection = 'up' | 'down' | 'left' | 'right';

export interface PadState {
  /** Direction currently pushed, or null. */
  dir: PadDirection | null;
  /** Pushed past the running threshold. */
  run: boolean;
}

export const pad: PadState = { dir: null, run: false };

/** Fired on a press of the action button. Scenes subscribe; the HUD emits. */
export const padEvents = new Phaser.Events.EventEmitter();

/** Let go of everything — called whenever the controls are hidden. */
export function releasePad(): void {
  pad.dir = null;
  pad.run = false;
}

/**
 * The controls currently on screen, if any.
 *
 * The world scene needs this: in landscape they float over the map, and both
 * scenes see the same pointer — without a claim here, pushing left would also
 * order the player to walk to whichever tile is under your thumb.
 */
let live: { zone: Rect; visible: boolean } | undefined;

/** True when the on-screen controls own this point. */
export function padConsumes(x: number, y: number): boolean {
  if (!live?.visible) return false;
  const { zone } = live;
  return x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height;
}

/** Fraction of the stick's travel that is slack, so a resting thumb is still. */
const DEAD_ZONE = 0.22;
/** Fraction of the travel past which a walk becomes a run. */
const RUN_ZONE = 0.68;
/**
 * Resting opacity. Idle controls should be a hint, not furniture — in landscape
 * they float over the room itself, and even on the bottom screen a solid pad
 * sitting there doing nothing is the loudest thing on the phone.
 */
const IDLE_ALPHA = 0.62;

export class TouchControls extends Phaser.GameObjects.Container {
  /** Where the stick sits when nothing is touching it. */
  readonly stickHome: { x: number; y: number };
  readonly stickRadius: number;
  readonly actionButton: Phaser.GameObjects.Container;

  private base: Phaser.GameObjects.Arc;
  private rim: Phaser.GameObjects.Arc;
  private knob: Phaser.GameObjects.Arc;
  private ticks: Phaser.GameObjects.Triangle[] = [];
  private anchor: { x: number; y: number };
  private stickPointer?: number;
  private handlers: Array<[string, (pointer: Phaser.Input.Pointer) => void]> = [];

  constructor(scene: Phaser.Scene, private zone: Rect) {
    super(scene, 0, 0);
    scene.add.existing(this);
    live = { zone, visible: true };

    // Stick and button as one centred cluster, with the stick on the side most
    // thumbs steer with and the button close enough that the other one reaches
    // it without the phone changing hands.
    this.stickRadius = Math.min(zone.height / 2 - 10, 78);
    const buttonRadius = Math.min(this.stickRadius * 0.62, 50);
    const gap = 34;
    const clusterWidth = this.stickRadius * 2 + gap + buttonRadius * 2;
    const left = zone.x + (zone.width - clusterWidth) / 2;
    const midY = zone.y + zone.height / 2;

    this.stickHome = { x: left + this.stickRadius, y: midY };
    this.anchor = { ...this.stickHome };

    this.base = scene.add.circle(this.stickHome.x, this.stickHome.y, this.stickRadius, COLORS.soot, 0.72);
    this.base.setStrokeStyle(2, COLORS.brassDim, 0.75);
    this.rim = scene.add.circle(this.stickHome.x, this.stickHome.y, this.stickRadius * RUN_ZONE, COLORS.brassDim, 0);
    this.rim.setStrokeStyle(1, COLORS.brassDim, 0.35);
    this.knob = scene.add.circle(this.stickHome.x, this.stickHome.y, this.stickRadius * 0.42, COLORS.panelLight, 1);
    this.knob.setStrokeStyle(2, COLORS.brass, 0.9);
    this.add([this.base, this.rim, this.knob]);
    this.drawTicks();

    this.actionButton = this.drawActionButton(
      left + this.stickRadius * 2 + gap + buttonRadius,
      midY,
      buttonRadius,
    );

    this.setAlpha(IDLE_ALPHA);
    this.wireInput();
  }

  /** Four faint arrows around the ring: the only hint that this steers. */
  private drawTicks(): void {
    const r = this.stickRadius - 12;
    const specs: [number, number, number][] = [
      [0, -r, 0],
      [0, r, 180],
      [-r, 0, -90],
      [r, 0, 90],
    ];
    for (const [dx, dy, angle] of specs) {
      const tick = this.scene.add
        .triangle(this.stickHome.x + dx, this.stickHome.y + dy, 0, -6, -6, 5, 6, 5, COLORS.parchment, 0.4)
        .setAngle(angle);
      this.ticks.push(tick);
      this.add(tick);
    }
  }

  private drawActionButton(x: number, y: number, radius: number): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y);
    const disc = this.scene.add.circle(0, 0, radius, COLORS.soot, 0.95);
    disc.setStrokeStyle(3, COLORS.brass, 0.95);
    const label = pixelText(this.scene, 0, 0, 'ACT', { size: 'md', color: CSS.brass }).setOrigin(0.5);
    container.add([disc, label]);
    container.setData('disc', disc);
    container.setData('radius', radius);
    this.add(container);
    return container;
  }

  /**
   * Pointer handling is at scene level, not per object: a thumbstick has to
   * follow a finger that has long since left the circle it started in, and an
   * object hit area by definition stops listening the moment it does.
   */
  private wireInput(): void {
    const onButton = (pointer: Phaser.Input.Pointer) =>
      Phaser.Math.Distance.Between(pointer.x, pointer.y, this.actionButton.x, this.actionButton.y) <=
      (this.actionButton.getData('radius') as number) + 10;
    const inZone = (pointer: Phaser.Input.Pointer) =>
      pointer.x >= this.zone.x &&
      pointer.x <= this.zone.x + this.zone.width &&
      pointer.y >= this.zone.y &&
      pointer.y <= this.zone.y + this.zone.height;

    const down = (pointer: Phaser.Input.Pointer) => {
      if (!this.visible) return;
      if (onButton(pointer)) {
        this.flashButton();
        padEvents.emit('a');
        return;
      }
      if (!inZone(pointer)) return;
      this.setAlpha(1);
      this.stickPointer = pointer.id;
      // The stick comes to the thumb, kept far enough inside the band that the
      // whole ring stays on screen.
      this.anchor = {
        x: Phaser.Math.Clamp(
          pointer.x,
          this.zone.x + this.stickRadius,
          this.zone.x + this.zone.width - this.stickRadius,
        ),
        y: Phaser.Math.Clamp(
          pointer.y,
          this.zone.y + this.stickRadius,
          this.zone.y + this.zone.height - this.stickRadius,
        ),
      };
      this.moveStick(this.anchor);
      this.aim(pointer);
    };

    const move = (pointer: Phaser.Input.Pointer) => {
      if (!this.visible || pointer.id !== this.stickPointer) return;
      this.aim(pointer);
    };

    const up = (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.stickPointer) return;
      this.stickPointer = undefined;
      this.recentre();
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

  /** Read the push: direction from the dominant axis, speed from the distance. */
  private aim(pointer: Phaser.Input.Pointer): void {
    const dx = pointer.x - this.anchor.x;
    const dy = pointer.y - this.anchor.y;
    const distance = Math.hypot(dx, dy);
    const travel = Math.min(distance, this.stickRadius);

    this.knob.x = this.anchor.x + (distance > 0 ? (dx / distance) * travel : 0);
    this.knob.y = this.anchor.y + (distance > 0 ? (dy / distance) * travel : 0);

    if (travel < this.stickRadius * DEAD_ZONE) {
      pad.dir = null;
      pad.run = false;
      return;
    }
    pad.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    pad.run = travel >= this.stickRadius * RUN_ZONE;
    this.knob.setStrokeStyle(2, pad.run ? COLORS.lamp : COLORS.brass, 1);
  }

  private moveStick(to: { x: number; y: number }): void {
    this.base.setPosition(to.x, to.y);
    this.rim.setPosition(to.x, to.y);
    const r = this.stickRadius - 12;
    const offsets: [number, number][] = [
      [0, -r],
      [0, r],
      [-r, 0],
      [r, 0],
    ];
    this.ticks.forEach((tick, index) => {
      const [dx, dy] = offsets[index] ?? [0, 0];
      tick.setPosition(to.x + dx, to.y + dy);
    });
  }

  private recentre(): void {
    releasePad();
    this.setAlpha(IDLE_ALPHA);
    this.anchor = { ...this.stickHome };
    this.moveStick(this.stickHome);
    this.knob.setPosition(this.stickHome.x, this.stickHome.y);
    this.knob.setStrokeStyle(2, COLORS.brass, 0.9);
  }

  private flashButton(): void {
    const disc = this.actionButton.getData('disc') as Phaser.GameObjects.Arc;
    disc.setFillStyle(COLORS.brass, 0.35);
    this.setAlpha(1);
    this.scene.time.delayedCall(140, () => {
      disc.setFillStyle(COLORS.soot, 0.95);
      if (this.stickPointer === undefined) this.setAlpha(IDLE_ALPHA);
    });
  }

  /**
   * Safety net, called every frame by the HUD.
   *
   * A pushed stick is the one piece of state here that can strand the player:
   * if a touch ends without its pointerup ever arriving — the browser cancels
   * it, the finger leaves the canvas, a panel steals focus mid-push — it would
   * keep walking him. So when nothing at all is touching the screen, the stick
   * is centred.
   */
  tick(): void {
    if (this.stickPointer === undefined) return;
    if (this.scene.input.manager.pointers.some((pointer) => pointer.isDown)) return;
    this.stickPointer = undefined;
    this.recentre();
  }

  /** Hidden while a panel owns the bottom screen — and hands off the controls. */
  setShown(shown: boolean): this {
    if (this.visible === shown) return this;
    this.setVisible(shown);
    if (live) live.visible = shown;
    if (!shown) {
      this.stickPointer = undefined;
      this.recentre();
    }
    return this;
  }
}
