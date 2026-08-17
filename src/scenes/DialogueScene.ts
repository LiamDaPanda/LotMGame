import Phaser from 'phaser';
import { PixelText, pixelText } from '@/ui/pixelFont';
import { Session } from '@/systems/Session';
import { Button, Typewriter, drawPanel } from '@/ui/widgets';
import {
  COLORS,
  CSS,
  GAME_HEIGHT,
  GAME_WIDTH,
  isPortrait,
  minTapHeight,
} from '@/ui/theme';
import type { PresentedNode } from '@/systems/DialogueSystem';

interface DialogueSceneData {
  treeId: string;
  speaker: string;
}

/**
 * The conversation overlay.
 *
 * Locked choices are rendered greyed with the reason attached rather than
 * hidden — seeing "Requires Divination" or "You cannot afford it" is how the
 * player learns that abilities and money buy their way through conversations.
 */
export class DialogueScene extends Phaser.Scene {
  private session!: Session;
  /** Top of the speech panel. Choices stack upward from here. */
  private panelY = 0;
  private portrait!: Phaser.GameObjects.Image;
  private nameText!: PixelText;
  private bodyText!: PixelText;
  private typewriter!: Typewriter;
  private choiceButtons: Button[] = [];
  private node?: PresentedNode;
  private continueHint!: PixelText;

  constructor() {
    super('Dialogue');
  }

  create(data: DialogueSceneData): void {
    this.session = Session.get(this);

    this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.6)
      .setOrigin(0, 0)
      .setInteractive()
      .on('pointerdown', () => this.onTapBackdrop());

    // A narrow screen cannot afford a portrait beside the text, so portrait
    // mode puts the speaker's face and name on their own line and gives the
    // line itself the full width of the panel.
    const tall = isPortrait();
    const inset = tall ? 12 : 20;
    const panelW = GAME_WIDTH - inset * 2;
    const panelH = tall ? 300 : 210;
    this.panelY = GAME_HEIGHT - panelH - 20;
    const panelY = this.panelY;
    drawPanel(this, inset, panelY, panelW, panelH);

    this.portrait = this.add
      .image(tall ? inset + 52 : 84, panelY + (tall ? 56 : 74), 'portraits', 0)
      .setScale(tall ? 1.5 : 1.6);
    this.nameText = pixelText(this, tall ? inset + 106 : 150, panelY + (tall ? 34 : 18), '', {
      fontSize: tall ? '17px' : '19px',
      color: CSS.brass,
    });
    this.bodyText = pixelText(this, tall ? inset + 20 : 150, panelY + (tall ? 116 : 48), '', {
      fontSize: '15px',
      color: CSS.parchment,
      wordWrap: { width: tall ? panelW - 40 : GAME_WIDTH - 210 },
    });
    this.typewriter = new Typewriter(this, this.bodyText, 2, 14);

    const hintY = panelY + panelH - 26;
    this.continueHint = pixelText(this, GAME_WIDTH - inset - 24, hintY, '▾', { fontSize: '16px', color: CSS.brass })
      .setOrigin(0.5)
      .setAlpha(0);
    this.tweens.add({
      targets: this.continueHint,
      y: hintY + 5,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.input.keyboard?.on('keydown-SPACE', () => this.onTapBackdrop());
    this.input.keyboard?.on('keydown-ESC', () => this.close());

    const first = this.session.dialogue.start(data.treeId);
    if (!first) {
      this.close();
      return;
    }
    this.show(first);
  }

  private show(node: PresentedNode): void {
    this.node = node;
    this.clearChoices();

    const character = this.session.content.character(node.speaker);
    this.portrait.setFrame(character?.spriteRow ?? 0);
    this.nameText.setText(
      character ? `${character.name}${character.title ? ` — ${character.title}` : ''}` : node.speakerName,
    );
    this.continueHint.setAlpha(0);

    this.typewriter.play(node.text, () => this.renderChoices());
  }

  private renderChoices(): void {
    const node = this.node;
    if (!node) return;

    if (node.choices.length === 0) {
      this.continueHint.setAlpha(1);
      return;
    }

    // Choices sit above the text panel, tallest stack first so the newest
    // option is always nearest the thumb.
    const tall = isPortrait();
    const inset = tall ? 12 : 100;
    const width = GAME_WIDTH - inset * 2;
    const height = tall ? minTapHeight() : 40;
    const gap = 6;
    const total = node.choices.length * (height + gap);
    let y = this.panelY - 10 - total;

    for (const choice of node.choices) {
      const button = new Button(
        this,
        inset,
        y,
        choice.text,
        () => this.choose(choice.index),
        {
          width,
          height,
          align: 'left',
          fontSize: 14,
          enabled: choice.enabled,
          tone: choice.abilityId ? 'occult' : choice.costPence ? 'good' : 'default',
          subtitle: choice.enabled ? undefined : choice.reason,
        },
      );
      this.choiceButtons.push(button);
      y += height + gap;
    }
  }

  private clearChoices(): void {
    for (const button of this.choiceButtons) button.destroy();
    this.choiceButtons = [];
  }

  private choose(index: number): void {
    const next = this.session.dialogue.choose(index);
    if (!next) {
      this.close();
      return;
    }
    this.show(next);
  }

  /** Tap to finish the line; tap again on a terminal node to leave. */
  private onTapBackdrop(): void {
    if (this.typewriter.running) {
      this.typewriter.finish();
      this.renderChoices();
      return;
    }
    if (this.node && this.node.choices.length === 0) this.close();
  }

  private close(): void {
    this.typewriter.stop();
    this.session.dialogue.stop();
    this.scene.stop();
    if (this.scene.isPaused('World')) this.scene.resume('World');
  }
}
