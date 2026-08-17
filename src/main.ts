import Phaser from 'phaser';
import { AbilityMenuScene } from '@/scenes/AbilityMenuScene';
import { BootScene } from '@/scenes/BootScene';
import { CaseBoardScene } from '@/scenes/CaseBoardScene';
import { DialogueScene } from '@/scenes/DialogueScene';
import { EncounterScene } from '@/scenes/EncounterScene';
import { ExamineScene } from '@/scenes/ExamineScene';
import { HudScene } from '@/scenes/HudScene';
import { InquiryScene } from '@/scenes/InquiryScene';
import { JournalScene } from '@/scenes/JournalScene';
import { MainMenuScene } from '@/scenes/MainMenuScene';
import { PreloadScene } from '@/scenes/PreloadScene';
import { ResolveScene } from '@/scenes/ResolveScene';
import { RitualScene } from '@/scenes/RitualScene';
import { ShopScene } from '@/scenes/ShopScene';
import { TrainingScene } from '@/scenes/TrainingScene';
import { WorldScene } from '@/scenes/WorldScene';
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from '@/ui/theme';

/** Surface boot failures on the page — an iPhone has no console to check. */
function reportFatal(error: unknown): void {
  const box = document.getElementById('boot-error');
  if (!box) return;
  box.style.display = 'block';
  box.textContent = `The game failed to start.\n\n${error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error)}`;
}

window.addEventListener('error', (event) => reportFatal(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportFatal(event.reason));

try {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: COLORS.ink,
    pixelArt: true,
    roundPixels: true,
    scale: {
      // FIT keeps the whole board visible on any aspect ratio, which matters
      // more than filling an iPhone's screen edge to edge.
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: {
      activePointers: 2,
    },
    scene: [
      BootScene,
      PreloadScene,
      MainMenuScene,
      WorldScene,
      HudScene,
      DialogueScene,
      ExamineScene,
      JournalScene,
      CaseBoardScene,
      ShopScene,
      RitualScene,
      ResolveScene,
      AbilityMenuScene,
      EncounterScene,
      TrainingScene,
      InquiryScene,
    ],
  });

  // Exposed deliberately: the whole UI is canvas, so this is the only handle a
  // browser console (or an automated playtest) has on scenes and game state.
  (window as unknown as { __game: Phaser.Game }).__game = game;
} catch (error) {
  reportFatal(error);
}
