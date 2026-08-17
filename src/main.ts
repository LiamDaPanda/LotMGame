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
import { COLORS, setLayoutFor } from '@/ui/theme';

/** Surface boot failures on the page — an iPhone has no console to check. */
function reportFatal(error: unknown): void {
  const box = document.getElementById('boot-error');
  if (!box) return;
  box.style.display = 'block';
  box.textContent = `The game failed to start.\n\n${error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error)}`;
}

window.addEventListener('error', (event) => reportFatal(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportFatal(event.reason));

// Pick the logical board before Phaser starts. A phone held upright gets a tall
// board instead of a letterboxed strip with 14px-tall buttons.
const initial = setLayoutFor(window.innerWidth, window.innerHeight);

try {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: initial.width,
    height: initial.height,
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

  /**
   * Re-lay-out on rotation.
   *
   * Every scene builds itself from the layout in `create()`, and all game state
   * lives in the Session on the registry rather than in scenes — so restarting
   * the running scenes is a complete, lossless re-layout.
   */
  let currentOrientation = initial.width > initial.height ? 'landscape' : 'portrait';

  function applyViewport(): void {
    const next = window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
    // Always refresh: iOS changes the visual viewport (URL bar, keyboard)
    // without firing a layout change, and stale canvas bounds are exactly what
    // makes taps land in the wrong place.
    game.scale.refresh();
    if (next === currentOrientation) return;

    currentOrientation = next;
    const size = setLayoutFor(window.innerWidth, window.innerHeight);
    game.scale.setGameSize(size.width, size.height);
    game.scale.refresh();

    const running = game.scene
      .getScenes(true)
      .map((scene) => scene.scene.key)
      .filter((key) => key !== 'Boot' && key !== 'Preload');
    // Restart deepest-first so an overlay does not out-live the scene under it.
    for (const key of running.reverse()) game.scene.getScene(key).scene.restart();
  }

  window.addEventListener('resize', applyViewport);
  window.addEventListener('orientationchange', () => setTimeout(applyViewport, 120));
  window.visualViewport?.addEventListener('resize', () => game.scale.refresh());
  window.visualViewport?.addEventListener('scroll', () => game.scale.refresh());
  // Returning from the iOS app switcher can leave bounds stale.
  window.addEventListener('pageshow', () => game.scale.refresh());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) game.scale.refresh();
  });
} catch (error) {
  reportFatal(error);
}
