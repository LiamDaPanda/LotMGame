import Phaser from 'phaser';
import { PixelText, pixelText } from '@/ui/pixelFont';
import { Session } from '@/systems/Session';
import { SaveManager } from '@/systems/SaveManager';
import { Button, drawPanel } from '@/ui/widgets';
import {
  COLORS,
  CSS,
  GAME_HEIGHT,
  GAME_WIDTH,
  isPortrait,
  minTapHeight,
  panelInset,
} from '@/ui/theme';
import type { PathwayData } from '@/types/schema';

/**
 * Title screen, and the one irreversible choice in the game.
 *
 * Pathway is picked here rather than in play because it decides the whole
 * ladder — every ability, every stat ceiling, every rung's price. The screen
 * therefore shows what each one is *for*, not just what it is called: the
 * pathways solve the same case by different routes, and a player should be
 * able to tell which route they want before they commit to it.
 */
export class MainMenuScene extends Phaser.Scene {
  private chosen = 'seer';
  private pathwayButtons = new Map<string, Button>();
  private blurb!: PixelText;

  constructor() {
    super('MainMenu');
  }

  create(): void {
    const session = Session.get(this);
    this.cameras.main.setBackgroundColor(COLORS.ink);
    this.pathwayButtons.clear();

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

    pixelText(this, GAME_WIDTH / 2, tall ? 96 : 82, 'THE TAROT CLUB', {
        fontSize: tall ? '36px' : '46px',
        color: CSS.brass,
      })
      .setOrigin(0.5)
      .setShadow(0, 3, '#000000', 8);

    pixelText(this, GAME_WIDTH / 2, tall ? 130 : 122, 'a gaslamp investigation', {
        fontSize: '13px',
        color: CSS.muted,
      })
      .setOrigin(0.5);

    const pathways = session.content.pathwayList();
    this.chosen = pathways[0]?.id ?? 'seer';

    const inset = tall ? 16 : panelInset();
    const panelX = inset;
    const panelW = GAME_WIDTH - inset * 2;
    const panelY = tall ? 164 : 156;
    const buttonH = minTapHeight();

    // Lay the bottom out upwards from the footnote, whose height depends on how
    // many lines it wraps to. Guessing a fixed offset here is how the buttons
    // ended up printed across it.
    const disclaimer = pixelText(
      this,
      GAME_WIDTH / 2,
      GAME_HEIGHT - 10,
      'A non-commercial fan project, inspired by Lord of the Mysteries. Not affiliated with the author or its publishers.',
      { size: 'md', color: CSS.muted, align: 'center', wrap: GAME_WIDTH - 40 },
    ).setOrigin(0.5, 1);

    const actionsY =
      GAME_HEIGHT - 10 - disclaimer.height - 16 - (tall ? buttonH * 2 + 10 : buttonH);
    const panelH = actionsY - panelY - 16;

    drawPanel(this, panelX, panelY, panelW, panelH, { fillAlpha: 0.72 });
    pixelText(this, panelX + 20, panelY + 14, 'CHOOSE A PATHWAY', {
      fontSize: '11px',
      color: CSS.brass,
    });

    // The picker: one button per pathway, and a blurb that changes under them.
    const pickerY = panelY + 38;
    const gap = 6;
    const pickW = (panelW - 40 - gap * (pathways.length - 1)) / pathways.length;
    pathways.forEach((pathway, index) => {
      const button = new Button(
        this,
        panelX + 20 + index * (pickW + gap),
        pickerY,
        pathway.name,
        () => this.choose(pathway.id),
        { width: pickW, height: buttonH, fontSize: tall ? 12 : 14, tone: 'occult' },
      );
      this.pathwayButtons.set(pathway.id, button);
    });

    this.blurb = pixelText(this, panelX + 20, pickerY + buttonH + 14, '', {
      fontSize: tall ? '13px' : '14px',
      color: CSS.parchment,
      wordWrap: { width: panelW - 40 },
    });

    const hasSave = SaveManager.hasSave();

    if (tall) {
      new Button(this, panelX, actionsY, 'Continue', () => this.continueGame(), {
        width: panelW,
        height: buttonH,
        enabled: hasSave,
        tone: 'good',
        fontSize: 17,
      });
      new Button(this, panelX, actionsY + buttonH + 10, 'New Investigation', () => this.newGame(hasSave), {
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
      new Button(this, GAME_WIDTH / 2 + 12, actionsY, 'New Investigation', () => this.newGame(hasSave), {
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

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.pathwayButtons.clear());
    this.choose(this.chosen);
  }

  private choose(pathwayId: string): void {
    this.chosen = pathwayId;
    // The selected one reads as pressed-in: disabled is the widget's only
    // "this is the current state" affordance.
    for (const [id, button] of this.pathwayButtons) button.setEnabled(id !== pathwayId);
    this.describe(Session.get(this).content.pathway(pathwayId));
  }

  /** What this pathway is like to play, in the terms the player will feel. */
  private describe(pathway: PathwayData): void {
    const session = Session.get(this);
    const entry = [...pathway.sequences].sort((a, b) => b.sequence - a.sequence)[0];
    const ladder = [...pathway.sequences]
      .sort((a, b) => b.sequence - a.sequence)
      .map((tier) => tier.title)
      .join('  →  ');
    const powers = (entry?.grantsAbilities ?? [])
      .map((id) => session.content.ability(id))
      .filter((ability) => ability && !ability.passive)
      .map((ability) => ability!.name)
      .join(', ');

    this.blurb.setText(
      [
        `${pathway.epithet}.`,
        pathway.description,
        `Ladder:  ${ladder}`,
        `You begin as a ${entry?.title ?? '—'} with: ${powers}.`,
      ].join('\n\n'),
    );
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
    fresh.state.setPathway(this.chosen);
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
