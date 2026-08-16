import Phaser from 'phaser';
import { COLORS } from '@/ui/theme';

/**
 * Loads only the content index, because the index is what tells PreloadScene
 * which data files exist. Splitting this off is what lets content be added by
 * editing JSON alone.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.setPath(`${import.meta.env.BASE_URL}data`);
    this.load.json('content-index', 'index.json');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.ink);
    this.scene.start('Preload');
  }
}
