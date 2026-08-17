import Phaser from 'phaser';
import { Session } from '@/systems/Session';
import { SaveManager } from '@/systems/SaveManager';
import { Button, ScrollList, Typewriter, drawPanel, sectionHeader } from '@/ui/widgets';
import { COLORS, CSS, FONT_BODY, FONT_UI, GAME_HEIGHT, GAME_WIDTH, panelInset } from '@/ui/theme';

/**
 * Advancement.
 *
 * Two doors out of this room. The clean one asks for everything the tier
 * demands, digestion included. The other one — the temptation — is always
 * visible, always available the moment you hold the potion, and always a bad
 * idea. Making the shortcut a permanent fixture of the UI rather than a hidden
 * option is the point: the player should feel it waiting there every time.
 */
export class RitualScene extends Phaser.Scene {
  private session!: Session;
  private list?: ScrollList;


  private x = 0;
  private y = 0;
  private w = 0;
  private h = 0;

  constructor() {
    super('Ritual');
  }

  create(): void {
    // Read the layout here, not in a field: scene instances outlive a rotation.
    this.x = panelInset();
    this.y = 56;
    this.w = GAME_WIDTH - panelInset() * 2;
    this.h = GAME_HEIGHT - 102;
    this.session = Session.get(this);
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.9).setOrigin(0, 0).setInteractive();
    this.render();
    this.input.keyboard?.on('keydown-ESC', () => this.close());
  }

  private render(): void {
    this.children.removeAll(true);
    this.list = undefined;

    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.9).setOrigin(0, 0).setInteractive();
    drawPanel(this, this.x, this.y, this.w, this.h);

    const state = this.session.state;
    const advancement = this.session.progression.next();

    sectionHeader(
      this,
      this.x + 24,
      this.y + 16,
      this.w - 48,
      'The Rite',
      `You are Sequence ${state.sequence} — ${state.sequenceTitle}.`,
    );

    if (!advancement) {
      this.add.text(this.x + 24, this.y + 90, 'There is no further rung written on this ladder.', {
        fontFamily: FONT_BODY,
        fontSize: '15px',
        color: CSS.muted,
      });
      new Button(this, this.x + 24, this.y + this.h - 54, 'Leave', () => this.close(), {
        width: 150,
        height: 38,
      });
      return;
    }

    this.add.text(this.x + 24, this.y + 76, `Toward Sequence ${advancement.toSequence} — ${advancement.toTitle}`, {
      fontFamily: FONT_BODY,
      fontSize: '18px',
      color: CSS.brass,
    });

    const rows: Phaser.GameObjects.Container[] = [];
    for (const status of this.session.progression.requirements()) {
      rows.push(
        this.requirementRow(
          `${status.met ? '✓' : '✗'}  ${status.requirement.label}`,
          status.detail,
          status.met,
        ),
      );
    }

    this.list = new ScrollList(this, this.x + 24, this.y + 108, {
      width: this.w - 48,
      height: this.h - 240,
      gap: 6,
    });
    this.list.setRows(rows);
    this.list.refreshMask();

    const canAdvance = this.session.progression.canAdvance();
    const canForce = this.session.progression.canForceAdvance();
    const temptation = advancement.temptation;

    new Button(
      this,
      this.x + 24,
      this.y + this.h - 128,
      'Drink, and take the role',
      () => this.perform(false),
      {
        width: this.w - 48,
        height: 48,
        tone: 'good',
        enabled: canAdvance,
        fontSize: 15,
        subtitle: canAdvance
          ? 'Every condition met. The change will hold.'
          : 'Not every condition is met.',
      },
    );

    // Taller than its sibling: the shortcut's price is the whole point, so the
    // text that lists it must fit inside the button rather than spill past it.
    new Button(
      this,
      this.x + 24,
      this.y + this.h - 72,
      temptation.label,
      () => this.perform(true),
      {
        width: this.w - 48,
        height: 62,
        tone: 'bad',
        enabled: canForce,
        fontSize: 15,
        subtitle: canForce
          ? `${temptation.description}\n−${temptation.sanityCost} sanity, −${temptation.concealmentCost} concealment, ${Math.round(temptation.lossOfControlChance * 100)}% chance of losing yourself`
          : 'You do not even hold the potion yet.',
      },
    );

    new Button(this, this.x + this.w - 174, this.y + 74, 'Leave', () => this.close(), {
      width: 150,
      height: 32,
      fontSize: 12,
    });
  }

  private requirementRow(text: string, detail: string | undefined, met: boolean): Phaser.GameObjects.Container {
    const width = this.w - 48;
    const container = this.add.container(0, 0);
    container.setSize(width, 34);
    const bg = this.add.graphics();
    bg.fillStyle(COLORS.panelLight, met ? 0.5 : 0.25);
    bg.fillRoundedRect(0, 0, width, 34, 4);
    container.add(bg);
    container.add(
      this.add.text(12, 9, text, {
        fontFamily: FONT_UI,
        fontSize: '13px',
        color: met ? CSS.good : CSS.muted,
      }),
    );
    if (detail) {
      container.add(
        this.add
          .text(width - 12, 9, detail, { fontFamily: FONT_UI, fontSize: '12px', color: CSS.muted })
          .setOrigin(1, 0),
      );
    }
    return container;
  }

  private perform(force: boolean): void {
    const advancement = this.session.progression.next();
    const ritualText = advancement?.ritualText ?? '';
    const result = this.session.progression.advance(force);
    if (!result.ok) return;

    SaveManager.save(this.session.state);
    this.showTransformation(ritualText, result.narrative ?? '', result, force);
  }

  /** The narrative beat. Every rank-up gets one; this is where it plays. */
  private showTransformation(
    ritualText: string,
    narrative: string,
    result: { toSequence?: number; toTitle?: string; lostControl?: boolean; grantedAbilities?: string[] },
    forced: boolean,
  ): void {
    this.children.removeAll(true);
    this.list = undefined;

    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 1).setOrigin(0, 0).setInteractive();
    this.cameras.main.flash(600, 40, 30, 60);

    const title = this.add
      .text(GAME_WIDTH / 2, 74, `Sequence ${result.toSequence} — ${result.toTitle}`, {
        fontFamily: FONT_BODY,
        fontSize: '30px',
        color: forced ? CSS.bad : CSS.brass,
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.tweens.add({ targets: title, alpha: 1, duration: 900 });

    const body = this.add.text(140, 130, '', {
      fontFamily: FONT_BODY,
      fontSize: '15px',
      color: CSS.parchment,
      lineSpacing: 8,
      wordWrap: { width: GAME_WIDTH - 280 },
    });

    const pieces = [ritualText, narrative];
    if (result.lostControl) {
      pieces.push(
        'Something in you does not come back the way it went in. You catch yourself, afterwards, and cannot say how long the afterwards lasted.',
      );
    }
    if (result.grantedAbilities?.length) {
      const names = result.grantedAbilities
        .map((id) => this.session.content.ability(id)?.name)
        .filter(Boolean)
        .join(', ');
      if (names) pieces.push(`New to you: ${names}.`);
    }

    const typewriter = new Typewriter(this, body, 2, 14);
    typewriter.play(pieces.filter(Boolean).join('\n\n'));
    this.input.on('pointerdown', () => typewriter.finish());

    new Button(this, GAME_WIDTH / 2 - 90, GAME_HEIGHT - 66, 'Go on', () => this.close(), {
      width: 180,
      height: 42,
      tone: forced ? 'bad' : 'good',
    });
  }

  private close(): void {
    this.scene.stop();
    if (this.scene.isPaused('World')) this.scene.resume('World');
  }
}
