import Phaser from 'phaser';
import { COLORS } from '@/ui/theme';
import { registerPixelFont } from '@/ui/pixelFont';

/**
 * Loads the content index and the pixel font, because both are needed before
 * anything else can run: the index tells PreloadScene which data files exist
 * (which is what lets content be added by editing JSON alone), and the font is
 * needed by PreloadScene's own loading screen.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.setPath(`${import.meta.env.BASE_URL}assets`);
    this.load.image('font', 'ui/font.png');
    this.load.json('font-manifest', 'ui/font.json');

    this.load.setPath(`${import.meta.env.BASE_URL}data`);
    this.load.json('content-index', 'index.json');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.ink);
    // The manifest is written by tools/generate-font.mjs alongside the atlas,
    // so the character order can never drift from the image.
    registerPixelFont(this, this.cache.json.get('font-manifest'));
    this.scene.start('Preload');
  }
}
