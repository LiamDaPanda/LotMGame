import Phaser from 'phaser';
import { PixelText, pixelText } from '@/ui/pixelFont';
import { Session } from '@/systems/Session';
import { format } from '@/systems/Money';
import { METHOD_LABEL } from '@/systems/InquirySystem';
import { SKILLS } from '@/systems/Skills';
import { Button, ScrollList, Typewriter, drawPanel, panelStage, sectionHeader } from '@/ui/widgets';
import {
  CSS,
  ICONS,
  menuRect,
} from '@/ui/theme';

const METHOD_ICON = {
  ask_around: ICONS.trust,
  informant: ICONS.pence,
  stakeout: ICONS.spirituality,
  archives: ICONS.document,
} as const;

/**
 * Following a line of inquiry: the legwork half of investigation.
 *
 * Where the examine panel spends spirituality, this spends money, days and a
 * trained skill. It is the route that rewards a player who trained Streetwise
 * and kept a full purse — and the answer to being stuck without a power to use.
 */
export class InquiryScene extends Phaser.Scene {
  private session!: Session;
  private list?: ScrollList;
  private resultText!: PixelText;
  private typewriter!: Typewriter;


  private x = 0;
  private y = 0;
  private w = 0;
  private h = 0;

  constructor() {
    super('Inquiry');
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

    const caseData = this.session.cases.activeCase();
    sectionHeader(
      this,
      this.x + 24,
      this.y + 16,
      this.w - 48,
      'Lines of Inquiry',
      caseData
        ? `${caseData.title}  ·  legwork costs money and days, not spirituality`
        : 'No case is open.',
    );

    this.resultText = pixelText(this, this.x + 24, this.y + this.h - 96, '', {
      fontSize: '13px',
      color: CSS.parchment,
      wordWrap: { width: this.w - 200 },
    });
    this.typewriter = new Typewriter(this, this.resultText, 3, 12);

    new Button(this, this.x + this.w - 174, this.y + this.h - 54, 'Enough', () => this.close(), {
      width: 150,
      height: 38,
      fontSize: 13,
    });
    this.input.keyboard?.on('keydown-ESC', () => this.close());

    this.render();
  }

  private render(): void {
    this.list?.destroy();
    const options = this.session.inquiries.available();
    const width = this.w - 48;

    const rows: Phaser.GameObjects.Container[] = options.map((option) => {
      const container = this.add.container(0, 0);
      const height = 72;
      container.setSize(width, height);

      const bits: string[] = [METHOD_LABEL[option.lead.method]];
      if (option.costPence > 0) bits.push(format(option.costPence));
      if (option.lead.days) bits.push(`${option.lead.days} day${option.lead.days === 1 ? '' : 's'}`);
      if (option.chance !== undefined && option.lead.check) {
        bits.push(
          `${Math.round(option.chance * 100)}% — ${SKILLS[option.lead.check.skill].name}`,
        );
      }
      if (!option.enabled && option.reason) bits.push(option.reason);

      container.add(
        new Button(this, 0, 0, option.lead.label, () => this.follow(option.lead.id), {
          width,
          height,
          align: 'left',
          fontSize: 14,
          iconFrame: METHOD_ICON[option.lead.method],
          enabled: option.enabled,
          tone: option.spent ? 'default' : 'good',
          subtitle: `${option.lead.description}\n${bits.join('   ·   ')}`,
        }),
      );
      return container;
    });

    if (rows.length === 0) {
      const container = this.add.container(0, 0);
      container.setSize(width, 40);
      container.add(
        pixelText(this, 0, 8, 'Nothing to chase up. Take a case first.', {
          fontSize: '13px',
          color: CSS.muted,
        }),
      );
      rows.push(container);
    }

    this.list = new ScrollList(this, this.x + 24, this.y + 76, {
      width,
      height: this.h - 190,
      gap: 8,
    });
    this.list.setRows(rows);
    this.list.refreshMask();
  }

  private follow(leadId: string): void {
    const result = this.session.inquiries.follow(leadId);
    if (!result.ok) {
      this.resultText.setText(result.reason ?? 'Not now.').setColor(CSS.bad);
      return;
    }

    const found = result.cluesFound?.length
      ? `\n\nLearned: ${result.cluesFound
          .map((id) => this.session.content.clueIndex().get(id)?.clue.title ?? id)
          .join('; ')}`
      : '';

    this.resultText.setColor(result.passed ? CSS.parchment : CSS.muted);
    this.typewriter.play(`${result.text ?? ''}${found}`);
    this.render();
  }

  private close(): void {
    this.typewriter?.stop();
    this.scene.stop();
    if (this.scene.isPaused('World')) this.scene.resume('World');
  }
}
