/**
 * A grid-walking character. Position is authoritative in tiles; the sprite
 * interpolates between them, which keeps collision and pathfinding exact while
 * the movement still looks smooth.
 */

import Phaser from 'phaser';
import { TILE_SIZE } from '@/ui/theme';
import type { Point } from '@/world/TileGrid';

export type Facing = 'down' | 'left' | 'right' | 'up';

/** Tiles per second. */
const WALK_SPEED = 4.2;

export class Actor {
  readonly sprite: Phaser.GameObjects.Sprite;
  tileX: number;
  tileY: number;
  facing: Facing = 'down';

  private path: Point[] = [];
  private stepFrom?: Point;
  private stepTo?: Point;
  private stepProgress = 0;
  private onArrive?: () => void;

  constructor(
    scene: Phaser.Scene,
    private spriteRow: number,
    tileX: number,
    tileY: number,
  ) {
    this.tileX = tileX;
    this.tileY = tileY;
    this.sprite = scene.add.sprite(
      tileX * TILE_SIZE + TILE_SIZE / 2,
      tileY * TILE_SIZE + TILE_SIZE / 2,
      'characters',
      spriteRow * 12,
    );
    // Feet sit on the tile centre; the tall chibi head overhangs upward.
    this.sprite.setOrigin(0.5, 0.78);
    this.playIdle();
  }

  get moving(): boolean {
    return this.stepTo !== undefined || this.path.length > 0;
  }

  /** Tile directly in front, used for keyboard interaction. */
  get facingTile(): Point {
    switch (this.facing) {
      case 'up':
        return { x: this.tileX, y: this.tileY - 1 };
      case 'down':
        return { x: this.tileX, y: this.tileY + 1 };
      case 'left':
        return { x: this.tileX - 1, y: this.tileY };
      default:
        return { x: this.tileX + 1, y: this.tileY };
    }
  }

  playIdle(): void {
    this.sprite.play(`char${this.spriteRow}-idle-${this.facing}`, true);
  }

  private playWalk(): void {
    this.sprite.play(`char${this.spriteRow}-walk-${this.facing}`, true);
  }

  face(direction: Facing): void {
    if (this.facing === direction) return;
    this.facing = direction;
    if (this.moving) this.playWalk();
    else this.playIdle();
  }

  /** Face whichever way `target` lies, without moving. */
  faceToward(target: Point): void {
    const dx = target.x - this.tileX;
    const dy = target.y - this.tileY;
    if (Math.abs(dx) > Math.abs(dy)) this.face(dx > 0 ? 'right' : 'left');
    else if (dy !== 0) this.face(dy > 0 ? 'down' : 'up');
  }

  /** Queue a path; the previous one is abandoned. */
  setPath(path: Point[], onArrive?: () => void): void {
    this.path = [...path];
    this.onArrive = onArrive;
    if (this.path.length === 0) {
      this.finish();
      return;
    }
    this.beginNextStep();
  }

  stop(): void {
    this.path = [];
    this.stepTo = undefined;
    this.stepFrom = undefined;
    this.onArrive = undefined;
    this.snapToTile();
    this.playIdle();
  }

  /** Step one tile immediately, for keyboard walking. Returns false if blocked. */
  stepTowards(dx: number, dy: number, walkable: (x: number, y: number) => boolean): boolean {
    if (this.moving) return false;
    if (Math.abs(dx) > Math.abs(dy)) this.face(dx > 0 ? 'right' : 'left');
    else this.face(dy > 0 ? 'down' : 'up');
    const nx = this.tileX + Math.sign(dx);
    const ny = this.tileY + Math.sign(dy);
    if (!walkable(nx, ny)) return false;
    this.setPath([{ x: nx, y: ny }]);
    return true;
  }

  private beginNextStep(): void {
    const next = this.path.shift();
    if (!next) {
      this.finish();
      return;
    }
    this.stepFrom = { x: this.tileX, y: this.tileY };
    this.stepTo = next;
    this.stepProgress = 0;

    const dx = next.x - this.tileX;
    const dy = next.y - this.tileY;
    if (dx !== 0) this.face(dx > 0 ? 'right' : 'left');
    else if (dy !== 0) this.face(dy > 0 ? 'down' : 'up');
    this.playWalk();
  }

  private finish(): void {
    this.stepTo = undefined;
    this.stepFrom = undefined;
    this.snapToTile();
    this.playIdle();
    const callback = this.onArrive;
    this.onArrive = undefined;
    callback?.();
  }

  private snapToTile(): void {
    this.sprite.x = this.tileX * TILE_SIZE + TILE_SIZE / 2;
    this.sprite.y = this.tileY * TILE_SIZE + TILE_SIZE / 2;
  }

  update(deltaMs: number): void {
    if (!this.stepTo || !this.stepFrom) return;
    this.stepProgress += (deltaMs / 1000) * WALK_SPEED;

    if (this.stepProgress >= 1) {
      this.tileX = this.stepTo.x;
      this.tileY = this.stepTo.y;
      if (this.path.length > 0) this.beginNextStep();
      else this.finish();
      return;
    }

    const t = this.stepProgress;
    this.sprite.x =
      Phaser.Math.Linear(this.stepFrom.x, this.stepTo.x, t) * TILE_SIZE + TILE_SIZE / 2;
    this.sprite.y =
      Phaser.Math.Linear(this.stepFrom.y, this.stepTo.y, t) * TILE_SIZE + TILE_SIZE / 2;
  }

  /** Sort key so actors and props overlap correctly by depth. */
  get depth(): number {
    return this.sprite.y;
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
