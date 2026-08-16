/**
 * Reusable UI pieces built straight from Phaser game objects — no DOM overlay,
 * so everything scales with the canvas and works identically under a mouse and
 * an iPhone thumb.
 *
 * Touch is the constraint that shapes these: hit areas are generous, lists
 * scroll by drag as well as wheel, and a drag is never mistaken for a tap.
 */

import Phaser from 'phaser';
import { COLORS, CSS, FONT_UI, TEXT } from '@/ui/theme';

/** Movement in pixels beyond which a pointer gesture counts as a drag, not a tap. */
const DRAG_SLOP = 8;

export interface PanelOptions {
  fill?: number;
  fillAlpha?: number;
  border?: number;
  borderWidth?: number;
  radius?: number;
}

/** A bordered plate. Used as the base of nearly every other widget. */
export function drawPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  options: PanelOptions = {},
): Phaser.GameObjects.Graphics {
  const {
    fill = COLORS.panel,
    fillAlpha = 0.96,
    border = COLORS.brassDim,
    borderWidth = 2,
    radius = 6,
  } = options;
  const graphics = scene.add.graphics();
  graphics.fillStyle(fill, fillAlpha);
  graphics.fillRoundedRect(x, y, width, height, radius);
  if (borderWidth > 0) {
    graphics.lineStyle(borderWidth, border, 1);
    graphics.strokeRoundedRect(x, y, width, height, radius);
  }
  return graphics;
}

export interface ButtonOptions {
  width?: number;
  height?: number;
  fontSize?: number;
  align?: 'left' | 'center';
  tone?: 'default' | 'good' | 'bad' | 'occult';
  /** Secondary line rendered under the label, e.g. a price or a lock reason. */
  subtitle?: string;
  enabled?: boolean;
  iconFrame?: number;
}

/**
 * A tappable plate with a label. Returns a container so callers can position,
 * add to other containers, and destroy it as one unit.
 */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private subtitle?: Phaser.GameObjects.Text;
  private icon?: Phaser.GameObjects.Image;
  private isEnabled: boolean;
  private buttonWidth: number;
  private buttonHeight: number;
  private tone: NonNullable<ButtonOptions['tone']>;
  private pressed = false;
  private pressOrigin = { x: 0, y: 0 };

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    private onClick: () => void,
    options: ButtonOptions = {},
  ) {
    super(scene, x, y);
    const {
      width = 280,
      height = 44,
      fontSize = 16,
      align = 'center',
      tone = 'default',
      subtitle,
      enabled = true,
      iconFrame,
    } = options;

    this.buttonWidth = width;
    this.buttonHeight = height;
    this.tone = tone;
    this.isEnabled = enabled;

    this.bg = scene.add.graphics();
    this.add(this.bg);

    const padLeft = iconFrame === undefined ? 14 : 38;
    if (iconFrame !== undefined) {
      this.icon = scene.add.image(18, height / 2, 'icons', iconFrame).setScale(1.4);
      this.add(this.icon);
    }

    const labelX = align === 'center' ? width / 2 : padLeft;
    const labelY = subtitle ? height / 2 - 8 : height / 2;
    this.label = scene.add
      .text(labelX, labelY, text, {
        fontFamily: FONT_UI,
        fontSize: `${fontSize}px`,
        color: CSS.parchment,
        wordWrap: { width: width - padLeft - 14 },
      })
      .setOrigin(align === 'center' ? 0.5 : 0, 0.5);
    this.add(this.label);

    if (subtitle) {
      this.subtitle = scene.add
        .text(labelX, height / 2 + 11, subtitle, {
          fontFamily: FONT_UI,
          fontSize: '11px',
          color: CSS.muted,
          wordWrap: { width: width - padLeft - 14 },
        })
        .setOrigin(align === 'center' ? 0.5 : 0, 0.5);
      this.add(this.subtitle);
    }

    this.setSize(width, height);
    // A container's local space puts its children at (0,0)-(w,h), so the hit
    // area must too — not the centre-origin rectangle a sprite would use.
    this.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, width, height),
      Phaser.Geom.Rectangle.Contains,
    );

    this.on('pointerover', () => this.redraw(true));
    this.on('pointerout', () => {
      this.pressed = false;
      this.redraw(false);
    });
    this.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.pressed = true;
      this.pressOrigin = { x: pointer.x, y: pointer.y };
      this.redraw(true);
    });
    this.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.pressed) return;
      this.pressed = false;
      this.redraw(false);
      if (!this.isEnabled) return;
      // A button inside a ScrollList must not fire when the gesture that
      // started on it was actually a scroll drag.
      const travel = Phaser.Math.Distance.Between(
        this.pressOrigin.x,
        this.pressOrigin.y,
        pointer.x,
        pointer.y,
      );
      if (travel > DRAG_SLOP) return;
      this.onClick();
    });

    this.redraw(false);
    scene.add.existing(this);
  }

  private toneColor(): number {
    switch (this.tone) {
      case 'good':
        return COLORS.good;
      case 'bad':
        return COLORS.bad;
      case 'occult':
        return COLORS.occult;
      default:
        return COLORS.brassDim;
    }
  }

  private redraw(hover: boolean): void {
    const active = hover && this.isEnabled;
    this.bg.clear();
    this.bg.fillStyle(active ? COLORS.panelLight : COLORS.panel, this.isEnabled ? 0.96 : 0.6);
    this.bg.fillRoundedRect(0, 0, this.buttonWidth, this.buttonHeight, 5);
    this.bg.lineStyle(active ? 2 : 1, this.isEnabled ? this.toneColor() : COLORS.muted, this.isEnabled ? 1 : 0.4);
    this.bg.strokeRoundedRect(0, 0, this.buttonWidth, this.buttonHeight, 5);
    this.label.setColor(this.isEnabled ? CSS.parchment : CSS.muted);
    this.icon?.setAlpha(this.isEnabled ? 1 : 0.4);
  }

  setEnabled(enabled: boolean): this {
    this.isEnabled = enabled;
    this.redraw(false);
    return this;
  }

  setLabel(text: string, subtitle?: string): this {
    this.label.setText(text);
    if (subtitle !== undefined) this.subtitle?.setText(subtitle);
    return this;
  }

  get enabled(): boolean {
    return this.isEnabled;
  }
}

/** A labelled horizontal bar with an icon — sanity, spirituality, concealment. */
export class Meter extends Phaser.GameObjects.Container {
  private bar: Phaser.GameObjects.Graphics;
  private valueText: Phaser.GameObjects.Text;
  private current = 1;
  private target = 1;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private label: string,
    private color: number,
    iconFrame: number,
    private barWidth = 120,
  ) {
    super(scene, x, y);

    this.add(scene.add.image(8, 8, 'icons', iconFrame).setScale(1.1));
    this.add(
      scene.add
        .text(20, 0, label, { fontFamily: FONT_UI, fontSize: '10px', color: CSS.muted })
        .setOrigin(0, 0),
    );

    this.bar = scene.add.graphics();
    this.add(this.bar);

    this.valueText = scene.add
      .text(barWidth + 22, 9, '', { fontFamily: FONT_UI, fontSize: '10px', color: CSS.parchment })
      .setOrigin(0, 0.5);
    this.add(this.valueText);

    this.redraw();
    scene.add.existing(this);
  }

  /** Set the fill ratio; the bar eases toward it so changes are legible. */
  setValue(value: number, max: number): this {
    this.target = max > 0 ? Phaser.Math.Clamp(value / max, 0, 1) : 0;
    this.valueText.setText(`${Math.round(value)}`);
    return this;
  }

  /** Snap without easing — used when the HUD first appears. */
  snap(value: number, max: number): this {
    this.setValue(value, max);
    this.current = this.target;
    this.redraw();
    return this;
  }

  tick(): void {
    if (Math.abs(this.current - this.target) < 0.002) {
      if (this.current !== this.target) {
        this.current = this.target;
        this.redraw();
      }
      return;
    }
    this.current += (this.target - this.current) * 0.15;
    this.redraw();
  }

  private redraw(): void {
    const w = this.barWidth;
    this.bar.clear();
    this.bar.fillStyle(COLORS.ink, 0.85);
    this.bar.fillRoundedRect(20, 12, w, 7, 3);
    // Warn in red once a meter drops into the danger band.
    const low = this.current < 0.25;
    this.bar.fillStyle(low ? COLORS.bad : this.color, 1);
    this.bar.fillRoundedRect(20, 12, Math.max(2, w * this.current), 7, 3);
    this.bar.lineStyle(1, COLORS.brassDim, 0.5);
    this.bar.strokeRoundedRect(20, 12, w, 7, 3);
    this.valueText.setColor(low ? CSS.bad : CSS.parchment);
  }

  get name_(): string {
    return this.label;
  }
}

export interface ScrollListOptions {
  width: number;
  height: number;
  /** Vertical gap between rows. */
  gap?: number;
  padding?: number;
}

/**
 * A masked, drag-scrollable column of game objects.
 *
 * Phaser has no scroll container, and on a phone this is the difference
 * between a usable journal and an unusable one. Rows are added by the caller;
 * this handles masking, clamping, wheel, and drag-vs-tap disambiguation.
 */
export class ScrollList extends Phaser.GameObjects.Container {
  private viewport: Phaser.GameObjects.Container;
  private maskShape: Phaser.GameObjects.Graphics;
  private contentHeight = 0;
  private scrollY = 0;
  private dragging = false;
  private dragStartY = 0;
  private dragStartScroll = 0;
  private moved = 0;
  private listWidth: number;
  private listHeight: number;
  private gap: number;
  private pad: number;
  private scrollbar: Phaser.GameObjects.Graphics;
  private onPointerDown: (pointer: Phaser.Input.Pointer) => void;
  private onPointerMove: (pointer: Phaser.Input.Pointer) => void;
  private onPointerUp: () => void;
  private onWheel: (
    pointer: Phaser.Input.Pointer,
    objects: unknown,
    dx: number,
    dy: number,
  ) => void;

  constructor(scene: Phaser.Scene, x: number, y: number, options: ScrollListOptions) {
    super(scene, x, y);
    this.listWidth = options.width;
    this.listHeight = options.height;
    this.gap = options.gap ?? 8;
    this.pad = options.padding ?? 0;

    this.viewport = scene.add.container(0, 0);
    this.add(this.viewport);

    this.scrollbar = scene.add.graphics();
    this.add(this.scrollbar);

    // The mask lives in world space, so it must track this container's
    // absolute position rather than its local one.
    this.maskShape = scene.make.graphics({});
    this.updateMask();
    this.viewport.setMask(this.maskShape.createGeometryMask());

    this.setSize(this.listWidth, this.listHeight);

    // Scroll gestures are read from the scene's pointer stream rather than
    // from this container's own input, because Phaser delivers a pointer only
    // to the topmost object — and inside a list, that is usually a row button.
    // Rows stay independently tappable; Button ignores taps that travelled.
    const withinList = (pointer: Phaser.Input.Pointer) =>
      this.getBounds().contains(pointer.x, pointer.y);

    this.onPointerDown = (pointer) => {
      if (!withinList(pointer)) return;
      this.dragging = true;
      this.moved = 0;
      this.dragStartY = pointer.y;
      this.dragStartScroll = this.scrollY;
    };
    this.onPointerMove = (pointer) => {
      if (!this.dragging) return;
      const delta = pointer.y - this.dragStartY;
      this.moved = Math.max(this.moved, Math.abs(delta));
      if (this.moved > DRAG_SLOP) this.setScroll(this.dragStartScroll - delta);
    };
    this.onPointerUp = () => {
      this.dragging = false;
    };
    this.onWheel = (pointer, _objects, _dx, dy) => {
      if (!withinList(pointer)) return;
      this.setScroll(this.scrollY + dy * 0.5);
    };

    scene.input.on('pointerdown', this.onPointerDown);
    scene.input.on('pointermove', this.onPointerMove);
    scene.input.on('pointerup', this.onPointerUp);
    scene.input.on('pointerupoutside', this.onPointerUp);
    scene.input.on('wheel', this.onWheel);

    scene.add.existing(this);
  }

  /** True while the last gesture was a scroll — rows use it to suppress taps. */
  get wasDragged(): boolean {
    return this.moved > DRAG_SLOP;
  }

  private updateMask(): void {
    const matrix = this.getWorldTransformMatrix();
    this.maskShape.clear();
    this.maskShape.fillStyle(0xffffff);
    this.maskShape.fillRect(matrix.tx, matrix.ty, this.listWidth, this.listHeight);
  }

  /**
   * Lay rows out in a column. Each row's height is read from its `height`,
   * so callers must size their containers.
   */
  setRows(rows: Phaser.GameObjects.GameObject[]): this {
    this.viewport.removeAll(true);
    let cursor = this.pad;
    for (const row of rows) {
      const sized = row as Phaser.GameObjects.Container;
      sized.setPosition(this.pad, cursor);
      this.viewport.add(row);
      cursor += (sized.height || 0) + this.gap;
    }
    this.contentHeight = Math.max(0, cursor - this.gap + this.pad);
    this.setScroll(0);
    return this;
  }

  private get maxScroll(): number {
    return Math.max(0, this.contentHeight - this.listHeight);
  }

  setScroll(value: number): void {
    this.scrollY = Phaser.Math.Clamp(value, 0, this.maxScroll);
    this.viewport.y = -this.scrollY;
    this.drawScrollbar();
  }

  private drawScrollbar(): void {
    this.scrollbar.clear();
    if (this.maxScroll <= 0) return;
    const trackH = this.listHeight;
    const thumbH = Math.max(24, (this.listHeight / this.contentHeight) * trackH);
    const t = this.scrollY / this.maxScroll;
    const thumbY = t * (trackH - thumbH);
    this.scrollbar.fillStyle(COLORS.ink, 0.5);
    this.scrollbar.fillRoundedRect(this.listWidth - 5, 0, 4, trackH, 2);
    this.scrollbar.fillStyle(COLORS.brassDim, 0.9);
    this.scrollbar.fillRoundedRect(this.listWidth - 5, thumbY, 4, thumbH, 2);
  }

  /** Call after moving the list, so the world-space mask follows. */
  refreshMask(): void {
    this.updateMask();
  }

  override destroy(fromScene?: boolean): void {
    // Scene-level listeners outlive the container unless removed explicitly.
    this.scene?.input?.off('pointerdown', this.onPointerDown);
    this.scene?.input?.off('pointermove', this.onPointerMove);
    this.scene?.input?.off('pointerup', this.onPointerUp);
    this.scene?.input?.off('pointerupoutside', this.onPointerUp);
    this.scene?.input?.off('wheel', this.onWheel);
    this.maskShape.destroy();
    super.destroy(fromScene);
  }
}

/**
 * Text that types itself out. Tapping while it runs completes it instantly,
 * which is the interaction every text-heavy game needs and few implement.
 */
export class Typewriter {
  private full = '';
  private index = 0;
  private timer?: Phaser.Time.TimerEvent;

  constructor(
    private scene: Phaser.Scene,
    private target: Phaser.GameObjects.Text,
    private charsPerTick = 2,
    private tickMs = 16,
  ) {}

  play(text: string, onDone?: () => void): void {
    this.stop();
    this.full = text;
    this.index = 0;
    this.target.setText('');
    this.timer = this.scene.time.addEvent({
      delay: this.tickMs,
      loop: true,
      callback: () => {
        this.index = Math.min(this.full.length, this.index + this.charsPerTick);
        this.target.setText(this.full.slice(0, this.index));
        if (this.index >= this.full.length) {
          this.stop();
          onDone?.();
        }
      },
    });
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  /** Jump to the end of the current line. */
  finish(): void {
    if (!this.running) return;
    this.stop();
    this.target.setText(this.full);
  }

  stop(): void {
    this.timer?.remove();
    this.timer = undefined;
  }
}

/** Standard heading + rule used at the top of every full-screen panel. */
export function sectionHeader(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  title: string,
  subtitle?: string,
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y);
  container.add(scene.add.text(0, 0, title, TEXT.title).setFontSize(26));
  if (subtitle) {
    container.add(scene.add.text(0, 32, subtitle, TEXT.small).setWordWrapWidth(width));
  }
  const rule = scene.add.graphics();
  rule.lineStyle(1, COLORS.brassDim, 0.8);
  rule.lineBetween(0, subtitle ? 52 : 32, width, subtitle ? 52 : 32);
  container.add(rule);
  return container;
}
