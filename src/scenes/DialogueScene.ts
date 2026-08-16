import Phaser from 'phaser';
import { Session } from '@/systems/Session';
import { Button, Typewriter, drawPanel } from '@/ui/widgets';
import { COLORS, CSS, FONT_BODY, FONT_UI, GAME_HEIGHT, GAME_WIDTH } from '@/ui/theme';
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
  private portrait!: Phaser.GameObjects.Image;
  private nameText!: Phaser.GameObjects.Text;
  private bodyText!: Phaser.GameObjects.Text;
  private typewriter!: Typewriter;
  private choiceButtons: Button[] = [];
  private node?: PresentedNode;
  private continueHint!: Phaser.GameObjects.Text;

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

    const panelY = GAME_HEIGHT - 230;
    drawPanel(this, 20, panelY, GAME_WIDTH - 40, 210);

    this.portrait = this.add.image(84, panelY + 74, 'portraits', 0).setScale(1.6);
    this.nameText = this.add.text(150, panelY + 18, '', {
      fontFamily: FONT_BODY,
      fontSize: '19px',
      color: CSS.brass,
    });
    this.bodyText = this.add.text(150, panelY + 48, '', {
      fontFamily: FONT_BODY,
      fontSize: '15px',
      color: CSS.parchment,
      lineSpacing: 6,
      wordWrap: { width: GAME_WIDTH - 210 },
    });
    this.typewriter = new Typewriter(this, this.bodyText, 2, 14);

    this.continueHint = this.add
      .text(GAME_WIDTH - 44, panelY + 182, '▾', { fontFamily: FONT_UI, fontSize: '16px', color: CSS.brass })
      .setOrigin(0.5)
      .setAlpha(0);
    this.tweens.add({
      targets: this.continueHint,
      y: panelY + 187,
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
    const width = GAME_WIDTH - 200;
    const height = 40;
    const gap = 6;
    const total = node.choices.length * (height + gap);
    let y = GAME_HEIGHT - 240 - total;

    for (const choice of node.choices) {
      const button = new Button(
        this,
        100,
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
