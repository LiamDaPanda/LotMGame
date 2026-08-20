import Phaser from 'phaser';
import { pixelText } from '@/ui/pixelFont';
import { Session } from '@/systems/Session';
import { SaveManager } from '@/systems/SaveManager';
import { Button, drawPanel } from '@/ui/widgets';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, isPortrait, minTapHeight, panelInset } from '@/ui/theme';

/** Where a new run begins: Klein's own room, the night he chooses. */
const OPENING_MAP = 'lodgings';

/**
 * Title screen.
 *
 * Deliberately thin. The one decision that shapes a run — which pathway Klein
 * walks — is not made here any more; it is made in the prologue, in his own
 * handwriting at half past two in the morning, because a choice that matters
 * that much should be a scene rather than a row of buttons.
 */
export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super('MainMenu');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.ink);
    const tall = isPortrait();

    // A slow drift of lamplit motes behind the title.
    for (let i = 0; i < 40; i++) {
      const mote = this.add.circle(
        Phaser.Math.Between(0, GAME_WIDTH),
        Phaser.Math.Between(0, GAME_HEIGHT),
        Phaser.Math.FloatBetween(0.6, 1.8),
        COLORS.lamp,
        Phaser.Math.FloatBetween(0.06, 0.22),
      );
      this.tweens.add({
        targets: mote,
        y: mote.y - Phaser.Math.Between(40, 120),
        alpha: 0,
        duration: Phaser.Math.Between(6000, 14000),
        repeat: -1,
        delay: Phaser.Math.Between(0, 4000),
      });
    }

    pixelText(this, GAME_WIDTH / 2, tall ? 110 : 74, 'THE TAROT CLUB', {
      size: 'xl',
      color: CSS.brass,
      align: 'center',
      wrap: GAME_WIDTH - 40,
    }).setOrigin(0.5, 0);

    pixelText(this, GAME_WIDTH / 2, tall ? 160 : 120, 'a gaslamp investigation', {
      size: 'md',
      color: CSS.muted,
      align: 'center',
    }).setOrigin(0.5, 0);

    const buttonH = minTapHeight();

    // Laid out upwards from the footnote, whose height depends on how many
    // lines it wraps to at this width.
    const disclaimer = pixelText(
      this,
      GAME_WIDTH / 2,
      GAME_HEIGHT - 10,
      'A non-commercial fan project, inspired by Lord of the Mysteries. Not affiliated with the author or its publishers.',
      { size: 'md', color: CSS.muted, align: 'center', wrap: GAME_WIDTH - 40 },
    ).setOrigin(0.5, 1);

    const actionsY =
      GAME_HEIGHT - 10 - disclaimer.height - 20 - (tall ? buttonH * 2 + 10 : buttonH);

    const inset = tall ? 16 : panelInset();
    const panelX = inset;
    const panelW = GAME_WIDTH - inset * 2;
    const panelY = tall ? 210 : 150;
    const panelH = actionsY - panelY - 20;
    drawPanel(this, panelX, panelY, panelW, panelH, { fillAlpha: 0.72 });

    pixelText(
      this,
      panelX + 20,
      panelY + 16,
      [
        'Tingen City, the twenty-eighth of June, 1349. You are Klein Moretti, and you have just woken at a desk that is not yours in a body that is, with the door bolted from the inside, a revolver by your right hand and a crimson moon over Iron Cross Street.',
        'Three people read the Antigonus family’s notebook and all three died in the same hour. The notebook is not where it was. The men from No. 36 Zouteland Street want it back, and your own name is in the file twice.',
      ].join('\n\n'),
      {
        size: 'md',
        color: CSS.parchment,
        wrap: panelW - 40,
        maxHeight: panelH - 32,
      },
    );

    const hasSave = SaveManager.hasSave();
    if (tall) {
      new Button(this, panelX, actionsY, 'Continue', () => this.continueGame(), {
        width: panelW,
        height: buttonH,
        enabled: hasSave,
        tone: 'good',
        fontSize: 17,
      });
      new Button(this, panelX, actionsY + buttonH + 10, 'Begin', () => this.newGame(hasSave), {
        width: panelW,
        height: buttonH,
        fontSize: 17,
      });
    } else {
      new Button(this, GAME_WIDTH / 2 - 272, actionsY, 'Continue', () => this.continueGame(), {
        width: 260,
        height: buttonH,
        enabled: hasSave,
        tone: 'good',
        fontSize: 17,
      });
      new Button(this, GAME_WIDTH / 2 + 12, actionsY, 'Begin', () => this.newGame(hasSave), {
        width: 260,
        height: buttonH,
        fontSize: 17,
      });
    }

    if (!SaveManager.available()) {
      pixelText(
        this,
        GAME_WIDTH / 2,
        disclaimer.y - disclaimer.height - 6,
        'Storage is unavailable - progress will not be saved.',
        { size: 'md', color: CSS.bad, align: 'center', wrap: GAME_WIDTH - 40 },
      ).setOrigin(0.5, 1);
    }
  }

  private continueGame(): void {
    const session = Session.get(this);
    SaveManager.load(session.state);
    this.startWorld(session.state.currentMap);
  }

  private newGame(hadSave: boolean): void {
    if (hadSave) SaveManager.clear();
    // Rebuild the session so a new run never inherits the old one's state. No
    // pathway is set here: the prologue in the opening room sets it.
    const fresh = Session.get(this).reset();
    this.registry.set(Session.KEY, fresh);
    fresh.cases.refreshAvailability();
    this.startWorld(OPENING_MAP);
  }

  private startWorld(mapId: string): void {
    const session = Session.get(this);
    session.cases.refreshAvailability();
    this.scene.start('World', { mapId });
  }
}
