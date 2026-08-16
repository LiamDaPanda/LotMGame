import Phaser from 'phaser';
import { Session } from '@/systems/Session';
import { SaveManager } from '@/systems/SaveManager';
import { Button, drawPanel } from '@/ui/widgets';
import { COLORS, CSS, FONT_BODY, FONT_UI, GAME_HEIGHT, GAME_WIDTH } from '@/ui/theme';

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super('MainMenu');
  }

  create(): void {
    const session = Session.get(this);
    this.cameras.main.setBackgroundColor(COLORS.ink);

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

    this.add
      .text(GAME_WIDTH / 2, 118, 'THE TAROT CLUB', {
        fontFamily: FONT_BODY,
        fontSize: '46px',
        color: CSS.brass,
      })
      .setOrigin(0.5)
      .setShadow(0, 3, '#000000', 8);

    this.add
      .text(GAME_WIDTH / 2, 162, 'a gaslamp investigation', {
        fontFamily: FONT_UI,
        fontSize: '13px',
        color: CSS.muted,
      })
      .setOrigin(0.5);

    const hasSave = SaveManager.hasSave();

    new Button(
      this,
      GAME_WIDTH / 2 - 130,
      220,
      hasSave ? 'Continue' : 'Continue',
      () => this.continueGame(),
      { width: 260, height: 46, enabled: hasSave, tone: 'good', fontSize: 17 },
    );

    new Button(this, GAME_WIDTH / 2 - 130, 278, 'New Investigation', () => this.newGame(hasSave), {
      width: 260,
      height: 46,
      fontSize: 17,
    });

    // Pathway blurb — one pathway is implemented, so it is stated plainly
    // rather than offered as a choice that does not exist yet.
    const pathway = session.content.pathway('seer');
    drawPanel(this, GAME_WIDTH / 2 - 230, 344, 460, 104, { fillAlpha: 0.7 });
    this.add
      .text(GAME_WIDTH / 2, 362, `Pathway: ${pathway.name}`, {
        fontFamily: FONT_BODY,
        fontSize: '17px',
        color: CSS.occult,
      })
      .setOrigin(0.5, 0);
    this.add
      .text(GAME_WIDTH / 2, 388, pathway.description, {
        fontFamily: FONT_BODY,
        fontSize: '12px',
        color: CSS.muted,
        align: 'center',
        wordWrap: { width: 420 },
      })
      .setOrigin(0.5, 0);

    this.add
      .text(
        GAME_WIDTH / 2,
        GAME_HEIGHT - 30,
        'A non-commercial fan project, inspired by Lord of the Mysteries. Not affiliated with the author or its publishers.',
        { fontFamily: FONT_UI, fontSize: '10px', color: CSS.muted, align: 'center' },
      )
      .setOrigin(0.5);

    if (!SaveManager.available()) {
      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT - 52, 'Storage is unavailable — progress will not be saved.', {
          fontFamily: FONT_UI,
          fontSize: '10px',
          color: CSS.bad,
        })
        .setOrigin(0.5);
    }
  }

  private continueGame(): void {
    const session = Session.get(this);
    SaveManager.load(session.state);
    this.startWorld(session.state.currentMap);
  }

  private newGame(hadSave: boolean): void {
    if (hadSave) SaveManager.clear();
    // Rebuild the session so a new run never inherits the old one's state.
    const fresh = Session.get(this).reset();
    this.registry.set(Session.KEY, fresh);
    fresh.cases.refreshAvailability();
    this.startWorld('club_hub');
  }

  private startWorld(mapId: string): void {
    const session = Session.get(this);
    session.cases.refreshAvailability();
    this.scene.start('World', { mapId });
  }
}
