import Phaser from 'phaser';
import { pixelText } from '@/ui/pixelFont';
import { bus } from '@/systems/EventBus';
import { Session } from '@/systems/Session';
import { format } from '@/systems/Money';
import { Button, ScrollList, drawPanel, panelStage, sectionHeader } from '@/ui/widgets';
import {
  COLORS,
  CSS,
  GAME_HEIGHT,
  GAME_WIDTH,
  isPortrait,
  minTapHeight,
  panelInset,
} from '@/ui/theme';

/**
 * The Club's board of work. Cases are offered here and only one may be open at
 * a time — an investigator with three cases is an investigator with none.
 */
export class CaseBoardScene extends Phaser.Scene {
  private session!: Session;
  private list?: ScrollList;

  constructor() {
    super('CaseBoard');
  }

  create(): void {
    this.session = Session.get(this);
    this.session.cases.refreshAvailability();

    panelStage(this, 0.86);

    const x = panelInset();
    const y = isPortrait() ? 96 : 50;
    const w = GAME_WIDTH - panelInset() * 2;
    const h = GAME_HEIGHT - y - (isPortrait() ? 90 : 50);
    drawPanel(this, x, y, w, h);
    sectionHeader(this, x + 24, y + 18, w - 48, 'The Board', 'Work the Club has taken in. One at a time.');

    this.render(x, y, w, h);

    new Button(this, x + 24, y + h - minTapHeight() - 12, 'Close', () => this.close(), {
      width: 150,
      height: minTapHeight(),
      fontSize: 13,
    });
    this.input.keyboard?.on('keydown-ESC', () => this.close());
  }

  private render(x: number, y: number, w: number, h: number): void {
    this.list?.destroy();
    const rows: Phaser.GameObjects.Container[] = [];
    const active = this.session.cases.activeCase();

    if (active) {
      const container = this.add.container(0, 0);
      container.setSize(w - 48, 70);
      const bg = this.add.graphics();
      bg.fillStyle(COLORS.panelLight, 0.7);
      bg.fillRoundedRect(0, 0, w - 48, 70, 5);
      bg.lineStyle(1, COLORS.good, 0.6);
      bg.strokeRoundedRect(0, 0, w - 48, 70, 5);
      container.add(bg);
      container.add(
        pixelText(this, 14, 12, `Open: ${active.title}`, {
          fontSize: '14px',
          color: CSS.good,
        }),
      );
      container.add(
        pixelText(this, 14, 34, 'Close it before the Club will hand you another.', {
          fontSize: '12px',
          color: CSS.muted,
          wordWrap: { width: w - 76 },
        }),
      );
      rows.push(container);
    }

    const available = this.session.cases.availableCases();
    if (available.length === 0 && !active) {
      const container = this.add.container(0, 0);
      container.setSize(w - 48, 40);
      container.add(
        pixelText(this, 0, 8, 'The board is bare. Come back when the city has misbehaved.', {
          fontSize: '13px',
          color: CSS.muted,
        }),
      );
      rows.push(container);
    }

    for (const caseData of available) {
      const container = this.add.container(0, 0);
      const height = 92;
      container.setSize(w - 48, height);
      container.add(
        new Button(
          this,
          0,
          0,
          caseData.title,
          () => this.accept(caseData.id, x, y, w, h),
          {
            width: w - 48,
            height,
            align: 'left',
            fontSize: 15,
            enabled: !active,
            tone: 'default',
            subtitle: `${caseData.client}  ·  fee ${format(caseData.rewardPence)}  ·  suits Sequence ${caseData.recommendedSequence}\n${caseData.briefing.split('\n')[0]}`,
          },
        ),
      );
      rows.push(container);
    }

    this.list = new ScrollList(this, x + 24, y + 76, { width: w - 48, height: h - 150, gap: 10 });
    this.list.setRows(rows);
    this.list.refreshMask();
  }

  private accept(caseId: string, x: number, y: number, w: number, h: number): void {
    if (this.session.cases.accept(caseId)) {
      this.render(x, y, w, h);
    } else {
      bus.emit('notice', { text: 'Finish what you have first.', tone: 'bad' });
    }
  }

  private close(): void {
    this.scene.stop();
    if (this.scene.isPaused('World')) this.scene.resume('World');
  }
}
