import Phaser from 'phaser';
import { bus } from '@/systems/EventBus';
import { Session } from '@/systems/Session';
import { format } from '@/systems/Money';
import { MAX_SKILL, SKILLS, TRAINING_DAYS, trainingCost } from '@/systems/Skills';
import { Button, drawPanel, sectionHeader } from '@/ui/widgets';
import { COLORS, CSS, FONT_BODY, FONT_UI, GAME_HEIGHT, GAME_WIDTH } from '@/ui/theme';
import { SKILL_IDS, type SkillId } from '@/types/schema';

/**
 * Tuition.
 *
 * Skills are bought with money and days, never ground out — an investigator who
 * wants to be better at reading a room pays somebody to teach them. Every level
 * has a stated, checkable effect, so the player can see what the fee bought.
 */
export class TrainingScene extends Phaser.Scene {
  private session!: Session;
  private rows: Button[] = [];
  private purseText!: Phaser.GameObjects.Text;
  private flavour!: Phaser.GameObjects.Text;

  private readonly x = 120;
  private readonly y = 46;
  private readonly w = GAME_WIDTH - 240;
  private readonly h = GAME_HEIGHT - 92;

  constructor() {
    super('Training');
  }

  create(): void {
    this.session = Session.get(this);
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.88).setOrigin(0, 0).setInteractive();
    drawPanel(this, this.x, this.y, this.w, this.h);

    sectionHeader(
      this,
      this.x + 24,
      this.y + 16,
      this.w - 48,
      'Tuition',
      'The Club keeps people who know things and are willing to be paid to say so.',
    );

    this.purseText = this.add
      .text(this.x + this.w - 24, this.y + 26, '', {
        fontFamily: FONT_UI,
        fontSize: '13px',
        color: CSS.brass,
      })
      .setOrigin(1, 0);

    this.flavour = this.add.text(this.x + 24, this.y + this.h - 78, '', {
      fontFamily: FONT_BODY,
      fontSize: '13px',
      color: CSS.muted,
      wordWrap: { width: this.w - 200 },
    });

    new Button(this, this.x + this.w - 174, this.y + this.h - 54, 'Leave', () => this.close(), {
      width: 150,
      height: 38,
      fontSize: 13,
    });
    this.input.keyboard?.on('keydown-ESC', () => this.close());

    this.render();
  }

  private render(): void {
    for (const row of this.rows) row.destroy();
    this.rows = [];

    const state = this.session.state;
    this.purseText.setText(`Purse: ${format(state.pence)}   ·   Day ${state.day}`);

    SKILL_IDS.forEach((id, index) => {
      const info = SKILLS[id];
      const level = state.skill(id);
      const maxed = level >= MAX_SKILL;
      const cost = trainingCost(level);
      const affordable = state.canAfford(cost);

      const subtitle = maxed
        ? `${info.benefit}  ·  nothing left to teach you`
        : `${info.benefit}\n${format(cost)} and ${TRAINING_DAYS} day${TRAINING_DAYS === 1 ? '' : 's'}${
            affordable ? '' : ' — you cannot afford it'
          }`;

      this.rows.push(
        new Button(
          this,
          this.x + 24,
          this.y + 76 + index * 80,
          `${info.name}   ${'●'.repeat(level)}${'○'.repeat(MAX_SKILL - level)}   ${level}/${MAX_SKILL}`,
          () => this.train(id),
          {
            width: this.w - 48,
            height: 72,
            align: 'left',
            fontSize: 15,
            enabled: !maxed && affordable,
            subtitle,
          },
        ),
      );
    });
  }

  private train(id: SkillId): void {
    const state = this.session.state;
    const level = state.skill(id);
    const cost = trainingCost(level);
    if (!state.spend(cost)) {
      bus.emit('notice', { text: 'Not enough in the purse.', tone: 'bad' });
      return;
    }
    state.addSkill(id, 1);
    state.advanceDay(TRAINING_DAYS);

    const info = SKILLS[id];
    this.flavour.setText(
      `A day of it, and ${format(cost)} gone. ${info.name} is now ${state.skill(id)}. ${info.benefit}`,
    );
    bus.emit('notice', { text: `${info.name} raised to ${state.skill(id)}.`, tone: 'good' });
    this.render();
  }

  private close(): void {
    this.scene.stop();
    if (this.scene.isPaused('World')) this.scene.resume('World');
  }
}
