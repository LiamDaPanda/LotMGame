import Phaser from 'phaser';
import { PixelText, SCALES, pixelText, textHeight } from '@/ui/pixelFont';
import { Session } from '@/systems/Session';
import { Button, ScrollList, Typewriter, drawPanel } from '@/ui/widgets';
import { COLORS, CSS, isPortrait, menuRect, minTapHeight } from '@/ui/theme';
import type { PresentedChoice, PresentedNode } from '@/systems/DialogueSystem';

interface DialogueSceneData {
  treeId: string;
  speaker?: string;
}

/** Gap between stacked choice plates. */
const CHOICE_GAP = 5;

/**
 * The conversation overlay.
 *
 * Laid out per node rather than once, because a node's choices decide the
 * shape of the screen: three long options need three two-line plates, and the
 * speech panel has to give up the room for them. Sizing the panel first and
 * squeezing the choices into the remainder is what truncated them to a single
 * line with an ellipsis.
 *
 * Locked choices are rendered greyed with the reason attached rather than
 * hidden — seeing "Requires Divination" or "You cannot afford it" is how the
 * player learns that abilities and money buy their way through conversations.
 */
export class DialogueScene extends Phaser.Scene {
  private session!: Session;
  private panel!: Phaser.GameObjects.Container;
  private portrait!: Phaser.GameObjects.Image;
  private nameText!: PixelText;
  private bodyText!: PixelText;
  private continueHint!: PixelText;
  private typewriter?: Typewriter;
  private choiceButtons: Button[] = [];
  private choiceList?: ScrollList;
  private choiceArea = { x: 0, y: 0, width: 0, height: 0 };
  private node?: PresentedNode;

  constructor() {
    super('Dialogue');
  }

  create(data: DialogueSceneData): void {
    this.session = Session.get(this);
    this.choiceButtons = [];

    // Tapping anywhere in the panel pane advances the line — the whole bottom
    // screen is the "next" button, which is what a thumb expects.
    const pane = menuRect();
    this.add
      .rectangle(pane.x, pane.y, pane.width, pane.height, COLORS.ink, 0.85)
      .setOrigin(0, 0)
      .setInteractive()
      .on('pointerdown', () => this.onTapBackdrop());

    this.panel = this.add.container(0, 0);

    this.input.keyboard?.on('keydown-SPACE', () => this.onTapBackdrop());
    this.input.keyboard?.on('keydown-ESC', () => this.close());

    const first = this.session.dialogue.start(data.treeId);
    if (!first) {
      this.close();
      return;
    }
    this.show(first);
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  /** The greyed-out reason, or a price — whatever goes under a choice's label. */
  private subtitleFor(choice: PresentedChoice): string | undefined {
    return choice.enabled ? undefined : choice.reason;
  }

  /** How tall a choice's plate has to be to hold everything written on it. */
  private choiceHeight(choice: PresentedChoice, width: number): number {
    // Button pads 6px each side of its label.
    const textWidth = width - 12;
    const subtitle = this.subtitleFor(choice);
    const body =
      textHeight(choice.text, textWidth, SCALES.md) +
      (subtitle ? textHeight(subtitle, textWidth, SCALES.md) + 4 : 0);
    return Math.max(minTapHeight(), body + 10);
  }

  private show(node: PresentedNode): void {
    this.node = node;
    this.clearChoices();
    // Stop the old typewriter before its target is destroyed: it writes on a
    // timer, and a BitmapText that has been destroyed has no font data left to
    // write into — which throws out of the timer and takes the scene's update
    // loop with it.
    this.typewriter?.stop();
    this.panel.removeAll(true);

    const pane = menuRect();
    const tall = isPortrait();
    const inset = pane.x + (tall ? 8 : 20);
    const panelW = pane.width - (tall ? 16 : 40);

    // Measure the choices first; the speech panel takes what is left.
    const choiceInset = pane.x + (tall ? 8 : 100);
    const choiceWidth = pane.width - (tall ? 16 : 200);
    const heights = node.choices.map((choice) => this.choiceHeight(choice, choiceWidth));
    const wanted =
      heights.reduce((sum, height) => sum + height, 0) +
      Math.max(0, heights.length - 1) * CHOICE_GAP;

    // The panel never drops below enough room for a portrait and three lines.
    const minPanel = 150;
    const available = pane.height - minPanel - 16;
    const choicesHeight = Math.min(wanted, Math.max(0, available));
    const panelH = pane.height - choicesHeight - (choicesHeight > 0 ? 16 : 12);
    const panelY = pane.y + pane.height - panelH - 6;

    this.choiceArea = {
      x: choiceInset,
      y: pane.y + 6,
      width: choiceWidth,
      height: choicesHeight,
    };

    this.panel.add(drawPanel(this, inset, panelY, panelW, panelH));

    this.portrait = this.add
      .image(inset + 40, panelY + 40, 'portraits', 0)
      .setScale(tall ? 1.1 : 1.6);
    this.panel.add(this.portrait);

    const character = this.session.content.character(node.speaker);
    this.nameText = pixelText(
      this,
      inset + 86,
      panelY + 30,
      character
        ? `${character.name}${character.title ? ` - ${character.title}` : ''}`
        : node.speakerName,
      { size: 'md', color: CSS.brass, wrap: panelW - 96, maxHeight: 44 },
    );
    this.panel.add(this.nameText);

    const bodyY = panelY + 84;
    this.bodyText = pixelText(this, inset + 14, bodyY, '', {
      size: 'md',
      color: CSS.parchment,
      wrap: panelW - 28,
      maxHeight: panelY + panelH - bodyY - 24,
    });
    this.panel.add(this.bodyText);

    const hintY = panelY + panelH - 18;
    this.continueHint = pixelText(this, inset + panelW - 20, hintY, '▾', {
      size: 'md',
      color: CSS.brass,
    })
      .setOrigin(0.5)
      .setAlpha(0);
    this.panel.add(this.continueHint);
    this.tweens.add({
      targets: this.continueHint,
      y: hintY + 5,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.typewriter = new Typewriter(this, this.bodyText, 2, 14);
    this.typewriter.play(node.text, () => this.renderChoices());
  }

  private renderChoices(): void {
    const node = this.node;
    if (!node || this.choiceButtons.length > 0 || this.choiceList) return;

    if (node.choices.length === 0) {
      this.continueHint.setAlpha(1);
      return;
    }

    const area = this.choiceArea;
    const heights = node.choices.map((choice) => this.choiceHeight(choice, area.width));
    const wanted =
      heights.reduce((sum, height) => sum + height, 0) +
      Math.max(0, heights.length - 1) * CHOICE_GAP;

    const buttons = node.choices.map((choice, index) =>
      new Button(this, 0, 0, choice.text, () => this.choose(choice.index), {
        width: area.width,
        height: heights[index] as number,
        align: 'left',
        fontSize: 14,
        enabled: choice.enabled,
        tone: choice.abilityId ? 'occult' : choice.costPence ? 'good' : 'default',
        subtitle: this.subtitleFor(choice),
      }),
    );

    if (wanted <= area.height) {
      // They fit: stack them so the last option sits against the speech panel,
      // nearest the thumb.
      let y = area.y + area.height - wanted;
      buttons.forEach((button, index) => {
        button.setPosition(area.x, y);
        y += (heights[index] as number) + CHOICE_GAP;
      });
      this.choiceButtons = buttons;
      return;
    }

    // Too many to show at once — a scrolling column beats shrinking every plate
    // until its label is an ellipsis.
    this.choiceList = new ScrollList(this, area.x, area.y, {
      width: area.width,
      height: area.height,
      gap: CHOICE_GAP,
    });
    this.choiceList.setRows(buttons);
    this.choiceList.refreshMask();
    this.choiceButtons = buttons;
  }

  private clearChoices(): void {
    if (this.choiceList) {
      this.choiceList.destroy();
      this.choiceList = undefined;
    } else {
      for (const button of this.choiceButtons) button.destroy();
    }
    this.choiceButtons = [];
  }

  // ---------------------------------------------------------------------------
  // Flow
  // ---------------------------------------------------------------------------

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
    if (this.typewriter?.running) {
      this.typewriter.finish();
      this.renderChoices();
      return;
    }
    if (this.node && this.node.choices.length === 0) this.close();
  }

  private close(): void {
    this.typewriter?.stop();
    this.session.dialogue.stop();
    this.scene.stop();
    if (this.scene.isPaused('World')) this.scene.resume('World');
  }
}
