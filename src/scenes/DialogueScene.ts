import Phaser from 'phaser';
import { PixelText, pixelText } from '@/ui/pixelFont';
import { Session } from '@/systems/Session';
import { Button, Typewriter, drawPanel } from '@/ui/widgets';
import { COLORS, CSS, isPortrait, menuRect, minTapHeight } from '@/ui/theme';
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

    // Tapping anywhere in the panel pane advances the line — the whole bottom
    // screen is the "next" button, which is what a thumb expects.
    const pane = menuRect();
    this.add
      .rectangle(pane.x, pane.y, pane.width, pane.height, COLORS.ink, 0.85)
      .setOrigin(0, 0)
      .setInteractive()
      .on('pointerdown', () => this.onTapBackdrop());

    // A narrow screen cannot afford a portrait beside the text, so portrait
    // mode puts the speaker's face and name on their own line and gives the
    // line itself the full width of the panel.
    const tall = isPortrait();
    const inset = pane.x + (tall ? 8 : 20);
    const panelW = pane.width - (tall ? 16 : 40);
    // The speech panel sits at the bottom of the pane; choices stack upward
    // from its top edge, so it takes only what it needs.
    const panelH = tall ? Math.round(pane.height * 0.62) : 210;
    this.panelY = pane.y + pane.height - panelH - 8;
    const panelY = this.panelY;
    drawPanel(this, inset, panelY, panelW, panelH);

    this.portrait = this.add
      .image(inset + 40, panelY + 40, 'portraits', 0)
      .setScale(tall ? 1.1 : 1.6);
    this.nameText = pixelText(this, inset + 86, panelY + 30, '', {
      size: 'md',
      color: CSS.brass,
      wrap: panelW - 96,
    });
    this.bodyText = pixelText(this, inset + 14, panelY + 84, '', {
      size: 'md',
      color: CSS.parchment,
      wrap: panelW - 28,
    });
    this.typewriter = new Typewriter(this, this.bodyText, 2, 14);

    const hintY = panelY + panelH - 20;
    this.continueHint = pixelText(this, inset + panelW - 20, hintY, '▾', { size: 'md', color: CSS.brass })
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
    const pane = menuRect();
    const tall = isPortrait();
    const inset = pane.x + (tall ? 8 : 100);
    const width = pane.width - (tall ? 16 : 200);
    const gap = 5;
    // Choices share whatever the speech panel left above it, so a node with six
    // of them still fits rather than running off the top of the pane.
    const room = this.panelY - 8 - pane.y - 4;
    const height = Phaser.Math.Clamp(
      Math.floor(room / node.choices.length) - gap,
      28,
      tall ? minTapHeight() : 40,
    );
    const total = node.choices.length * (height + gap);
    let y = this.panelY - 8 - total;

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
