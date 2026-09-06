import Phaser from 'phaser';
import { PixelText, pixelText } from '@/ui/pixelFont';
import { bus } from '@/systems/EventBus';
import { Session } from '@/systems/Session';
import { format } from '@/systems/Money';
import { MAX_SKILL, SKILLS, TRAINING_DAYS, trainingCost } from '@/systems/Skills';
import { Button, ScrollList, drawPanel, panelStage, sectionHeader } from '@/ui/widgets';
import {
  CSS,
  menuRect,
  minTapHeight,
} from '@/ui/theme';
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
  /** Where the body may start, once the header has measured itself. */
  private headerBottom = 0;
  private rows: Button[] = [];
  private list?: ScrollList;
  private purseText!: PixelText;
  private flavour!: PixelText;


  private x = 0;
  private y = 0;
  private w = 0;
  private h = 0;

  constructor() {
    super('Training');
  }

  create(): void {
    // Read the layout here, not in a field: scene instances outlive a rotation.
    const pane = menuRect();
    this.x = pane.x + 10;
    this.y = pane.y + 10;
    this.w = pane.width - 20;
    this.h = pane.height - 20;
    this.session = Session.get(this);
    panelStage(this, 0.88);
    drawPanel(this, this.x, this.y, this.w, this.h);

    // The purse goes above the header, not beside its title: at phone width the
    // title wraps and there is no "beside" left.
    const state = this.session.state;
    this.purseText = pixelText(
      this,
      this.x + 24,
      this.y + 14,
      `Purse: ${format(state.pence)}   ·   Day ${state.day}`,
      { size: 'md', color: CSS.brass, wrap: this.w - 48 },
    );

    const header = sectionHeader(
      this,
      this.x + 24,
      this.purseText.y + this.purseText.height + 8,
      this.w - 48,
      'Tuition',
      'The Club keeps people who know things and are willing to be paid to say so.',
    );
    this.headerBottom = header.y + header.height;

    const footerY = this.y + this.h - minTapHeight() - 12;
    this.flavour = pixelText(this, this.x + 24, footerY, '', {
      size: 'md',
      color: CSS.muted,
      wrap: this.w - 200,
      maxHeight: minTapHeight(),
    });

    new Button(this, this.x + this.w - 174, footerY, 'Leave', () => this.close(), {
      width: 150,
      height: minTapHeight(),
      fontSize: 13,
    });
    this.input.keyboard?.on('keydown-ESC', () => this.close());

    this.render();
  }

  private render(): void {
    this.rows = [];

    const state = this.session.state;
    this.purseText.setText(`Purse: ${format(state.pence)}   ·   Day ${state.day}`);

    // The four rows go in a scrolling list rather than being squeezed into
    // whatever the header and footer left. At phone width that remainder is
    // about 43px a row, and a title plus a two-line subtitle does not fit in
    // 43px however the arithmetic is arranged.
    const top = this.headerBottom;
    const bottom = this.y + this.h - minTapHeight() - 20;
    const rowGap = 8;
    const rowHeight = 76;
    const rows: Phaser.GameObjects.Container[] = [];

    SKILL_IDS.forEach((id) => {
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

      rows.push(
        new Button(
          this,
          0,
          0,
          `${info.name}   ${'●'.repeat(level)}${'○'.repeat(MAX_SKILL - level)}   ${level}/${MAX_SKILL}`,
          () => this.train(id),
          {
            width: this.w - 48,
            height: rowHeight,
            align: 'left',
            fontSize: 15,
            enabled: !maxed && affordable,
            subtitle,
          },
        ),
      );
    });

    this.list?.destroy();
    this.list = new ScrollList(this, this.x + 24, top, {
      width: this.w - 48,
      height: Math.max(rowHeight, bottom - top),
      gap: rowGap,
    });
    this.list.setRows(rows);
    this.list.refreshMask();
    this.rows = rows as Button[];
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
