import Phaser from 'phaser';
import { Session } from '@/systems/Session';
import { SaveManager } from '@/systems/SaveManager';
import { describeTender, format } from '@/systems/Money';
import { Button, ScrollList, Typewriter, drawPanel, sectionHeader } from '@/ui/widgets';
import { COLORS, CSS, FONT_BODY, FONT_UI, GAME_HEIGHT, GAME_WIDTH } from '@/ui/theme';
import type { ResolutionGrade } from '@/types/schema';

const GRADE_LABEL: Record<ResolutionGrade, string> = {
  clean: 'Cleanly solved',
  messy: 'Solved, messily',
  partial: 'Partly solved',
  failed: 'Failed',
};

const GRADE_COLOR: Record<ResolutionGrade, string> = {
  clean: CSS.good,
  messy: CSS.lamp,
  partial: CSS.muted,
  failed: CSS.bad,
};

/**
 * Closing a case.
 *
 * Every resolution the case defines is listed, including the ones the player
 * has not earned — with what is missing. Seeing the clean solve greyed out
 * next to the messy one you *can* take is the moment the deduction system pays
 * off, and the reason a case has more than one ending worth reaching.
 */
export class ResolveScene extends Phaser.Scene {
  private session!: Session;
  private list?: ScrollList;

  constructor() {
    super('Resolve');
  }

  create(): void {
    this.session = Session.get(this);
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.88).setOrigin(0, 0).setInteractive();

    const caseData = this.session.cases.activeCase();
    if (!caseData) {
      this.close();
      return;
    }

    const x = 90;
    const y = 40;
    const w = GAME_WIDTH - 180;
    const h = GAME_HEIGHT - 80;
    drawPanel(this, x, y, w, h);
    sectionHeader(this, x + 24, y + 18, w - 48, caseData.title, `Present your findings · ${caseData.client}`);

    const options = this.session.cases.resolutionOptions();
    const rows = options.map(({ resolution, unlocked, reason }) => {
      const container = this.add.container(0, 0);
      const height = 78;
      container.setSize(w - 48, height);
      const basePence = Math.round(
        caseData.rewardPence * { clean: 1, messy: 0.75, partial: 0.5, failed: 0 }[resolution.grade],
      );
      const total = basePence + (resolution.bonusPence ?? 0);
      const subtitle = unlocked
        ? `${GRADE_LABEL[resolution.grade]}  ·  pays ${format(total)}\n${resolution.summary}`
        : `Locked — ${reason ?? 'not yet'}`;

      container.add(
        new Button(this, 0, 0, resolution.label, () => this.confirm(resolution.id), {
          width: w - 48,
          height,
          align: 'left',
          fontSize: 15,
          enabled: unlocked,
          tone: resolution.grade === 'failed' ? 'bad' : resolution.grade === 'clean' ? 'good' : 'default',
          subtitle,
        }),
      );
      return container;
    });

    this.list = new ScrollList(this, x + 24, y + 76, { width: w - 48, height: h - 150, gap: 8 });
    this.list.setRows(rows);
    this.list.refreshMask();

    new Button(this, x + 24, y + h - 54, 'Not yet', () => this.close(), { width: 160, height: 38, fontSize: 13 });
    this.input.keyboard?.on('keydown-ESC', () => this.close());
  }

  private confirm(resolutionId: string): void {
    const result = this.session.cases.resolve(resolutionId);
    if (!result.ok || !result.resolution) return;
    this.showEpilogue(
      result.resolution.epilogue,
      result.grade as ResolutionGrade,
      result.totalPence ?? 0,
    );
  }

  /** The aftermath card: what happened, and what it paid. */
  private showEpilogue(text: string, grade: ResolutionGrade, pence: number): void {
    this.children.removeAll(true);
    this.list = undefined;
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.94).setOrigin(0, 0).setInteractive();

    const x = 140;
    const y = 70;
    const w = GAME_WIDTH - 280;
    const h = GAME_HEIGHT - 150;
    drawPanel(this, x, y, w, h);

    this.add
      .text(x + w / 2, y + 34, GRADE_LABEL[grade], {
        fontFamily: FONT_BODY,
        fontSize: '26px',
        color: GRADE_COLOR[grade],
      })
      .setOrigin(0.5);

    const body = this.add.text(x + 32, y + 78, '', {
      fontFamily: FONT_BODY,
      fontSize: '15px',
      color: CSS.parchment,
      lineSpacing: 7,
      wordWrap: { width: w - 64 },
    });
    const typewriter = new Typewriter(this, body, 2, 12);

    const payLine = this.add
      .text(x + w / 2, y + h - 96, '', { fontFamily: FONT_UI, fontSize: '14px', color: CSS.brass })
      .setOrigin(0.5)
      .setAlpha(0);

    typewriter.play(text, () => {
      payLine
        .setText(
          pence > 0
            ? `Paid ${format(pence)} — ${describeTender(pence)}.`
            : 'You are paid nothing at all.',
        )
        .setAlpha(1);
    });

    this.input.once('pointerdown', () => typewriter.finish());

    new Button(this, x + w / 2 - 90, y + h - 58, 'Back to the Club', () => this.finish(), {
      width: 180,
      height: 40,
      tone: 'good',
    });
  }

  /** After a case closes, the player is returned to the hub and the run saved. */
  private finish(): void {
    SaveManager.save(this.session.state);
    this.scene.stop();
    if (this.scene.isActive('World') || this.scene.isPaused('World')) this.scene.stop('World');
    this.scene.start('World', { mapId: 'club_hub' });
  }

  private close(): void {
    this.scene.stop();
    if (this.scene.isPaused('World')) this.scene.resume('World');
  }
}
