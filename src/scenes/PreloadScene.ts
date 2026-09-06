import Phaser from 'phaser';
import { pixelText } from '@/ui/pixelFont';
import { Content } from '@/systems/Content';
import { Session } from '@/systems/Session';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH } from '@/ui/theme';
import type { ContentIndex } from '@/types/schema';

/** Frame geometry — must match tools/generate-art.mjs. */
const CHAR_FRAME = { frameWidth: 32, frameHeight: 40 };
const FRAMES_PER_DIRECTION = 3;
const DIRECTIONS = ['down', 'left', 'right', 'up'] as const;

export class PreloadScene extends Phaser.Scene {
  private index!: ContentIndex;

  constructor() {
    super('Preload');
  }

  preload(): void {
    this.index = this.cache.json.get('content-index') as ContentIndex;
    this.drawLoadingBar();

    const base = import.meta.env.BASE_URL;

    this.load.setPath(`${base}assets`);
    this.load.spritesheet('characters', 'sprites/characters.png', CHAR_FRAME);
    this.load.spritesheet('portraits', 'sprites/portraits.png', { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('tiles', 'tiles/tileset.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('icons', 'ui/icons.png', { frameWidth: 16, frameHeight: 16 });

    // Content: one loader key per file, namespaced by kind so a case and a map
    // may share a base name.
    this.load.setPath(`${base}data`);
    for (const name of this.index.pathways) this.load.json(`pathways/${name}`, `pathways/${name}.json`);
    for (const name of this.index.abilities) this.load.json(`abilities/${name}`, `abilities/${name}.json`);
    for (const name of this.index.cases) this.load.json(`cases/${name}`, `cases/${name}.json`);
    for (const name of this.index.maps) this.load.json(`maps/${name}`, `maps/${name}.json`);
    for (const name of this.index.dialogue) this.load.json(`dialogue/${name}`, `dialogue/${name}.json`);
    for (const name of this.index.encounters ?? []) {
      this.load.json(`encounters/${name}`, `encounters/${name}.json`);
    }
    this.load.json(`items/${this.index.items}`, `items/${this.index.items}.json`);
    this.load.json(`characters/${this.index.characters}`, `characters/${this.index.characters}.json`);
    if (this.index.story) this.load.json(`story/${this.index.story}`, `story/${this.index.story}.json`);
  }

  create(): void {
    const content = Content.fromLoaded(this.index, (kind, name) => {
      const key = `${kind}/${name}`;
      const data = this.cache.json.get(key);
      if (data === undefined) throw new Error(`Content file failed to load: data/${key}.json`);
      return data;
    });

    this.buildGlowTexture();
    this.registry.set(Session.KEY, new Session(content));
    this.buildAnimations(content.characters.size);
    this.scene.start('MainMenu');
  }

  /**
   * A soft radial falloff, painted once and tinted per lamp.
   *
   * Phaser's Graphics has no radial gradient, and a gaslit room is mostly the
   * business of light falling off — so the falloff is a texture and every lamp
   * in the world is one additive image of it.
   */
  private buildGlowTexture(): void {
    if (this.textures.exists('glow')) return;
    const size = 128;
    const canvas = this.textures.createCanvas('glow', size, size);
    const ctx = canvas?.getContext();
    if (!canvas || !ctx) return;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.4)');
    gradient.addColorStop(0.7, 'rgba(255,255,255,0.12)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    canvas.refresh();
  }

  /**
   * One walk + idle animation per character row. Rows are laid out as
   * 4 directions x 3 steps, so row r direction d starts at r*12 + d*3.
   */
  private buildAnimations(characterCount: number): void {
    const perRow = DIRECTIONS.length * FRAMES_PER_DIRECTION;
    for (let row = 0; row < characterCount; row++) {
      DIRECTIONS.forEach((direction, d) => {
        const base = row * perRow + d * FRAMES_PER_DIRECTION;
        const idleKey = `char${row}-idle-${direction}`;
        const walkKey = `char${row}-walk-${direction}`;
        if (!this.anims.exists(idleKey)) {
          this.anims.create({
            key: idleKey,
            frames: [{ key: 'characters', frame: base }],
            frameRate: 1,
          });
        }
        if (!this.anims.exists(walkKey)) {
          this.anims.create({
            key: walkKey,
            // contact, pass, contact, pass — reads as a stride at 3 frames.
            frames: [base + 1, base, base + 2, base].map((frame) => ({ key: 'characters', frame })),
            frameRate: 7,
            repeat: -1,
          });
        }
      });
    }
  }

  private drawLoadingBar(): void {
    this.cameras.main.setBackgroundColor(COLORS.ink);
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    pixelText(this, cx, cy - 60, 'THE TAROT CLUB', {
        fontSize: '32px',
        color: CSS.brass,
      })
      .setOrigin(0.5);

    const status = pixelText(this, cx, cy + 34, 'Lighting the lamps…', {
        fontSize: '12px',
        color: CSS.muted,
      })
      .setOrigin(0.5);

    const bar = this.add.graphics();
    const width = 280;
    this.load.on('progress', (value: number) => {
      bar.clear();
      bar.fillStyle(COLORS.soot, 1);
      bar.fillRoundedRect(cx - width / 2, cy, width, 8, 4);
      bar.fillStyle(COLORS.brass, 1);
      bar.fillRoundedRect(cx - width / 2, cy, Math.max(4, width * value), 8, 4);
    });
    this.load.on('complete', () => {
      bar.destroy();
      status.destroy();
    });
  }
}
