import Phaser from 'phaser';
import { bus } from '@/systems/EventBus';
import { Session } from '@/systems/Session';
import { format } from '@/systems/Money';
import { Button, Meter, drawPanel } from '@/ui/widgets';
import {
  COLORS,
  CSS,
  FONT_UI,
  GAME_HEIGHT,
  GAME_WIDTH,
  ICONS,
  METER_COLORS,
  hudFooterHeight,
  hudHeight,
  isPortrait,
  minTapHeight,
} from '@/ui/theme';

/**
 * The always-on status strip. Runs as its own scene above the world so it
 * survives room changes and never scrolls with the camera.
 *
 * It is purely a listener: it reads nothing on a timer and writes nothing to
 * state. Every number here arrives as an event from the systems that changed it.
 */
export class HudScene extends Phaser.Scene {
  private session!: Session;
  private meters!: {
    sanity: Meter;
    spirituality: Meter;
    concealment: Meter;
    digestion: Meter;
  };
  private purse!: Phaser.GameObjects.Text;
  private rankText!: Phaser.GameObjects.Text;
  private dayText!: Phaser.GameObjects.Text;
  private noticeText!: Phaser.GameObjects.Text;
  private noticeTimer?: Phaser.Time.TimerEvent;
  private unsubscribe: Array<() => void> = [];

  constructor() {
    super('Hud');
  }

  create(): void {
    this.session = Session.get(this);
    const state = this.session.state;

    // Portrait has no room for one row of everything, so the strip stacks:
    // identity and buttons on top, meters and purse beneath.
    const tall = isPortrait();
    const barH = hudHeight();
    drawPanel(this, 0, 0, GAME_WIDTH, barH, { radius: 0, borderWidth: 0, fill: COLORS.soot, fillAlpha: 0.92 });
    const rule = this.add.graphics();
    rule.lineStyle(1, COLORS.brassDim, 0.6);
    rule.lineBetween(0, barH, GAME_WIDTH, barH);

    const meterY = tall ? 46 : 12;
    const meterBar = tall ? 54 : 72;
    const meterGap = tall ? (GAME_WIDTH - 24) / 4 : 120;
    const meterX = tall ? 12 : 168;

    this.rankText = this.add.text(14, 8, '', {
      fontFamily: 'Georgia, serif',
      fontSize: '15px',
      color: CSS.brass,
    });
    this.dayText = this.add.text(14, 28, '', { fontFamily: FONT_UI, fontSize: '10px', color: CSS.muted });

    // The strip is a fixed budget: rank block, four meters, purse, two buttons.
    // Adding anything here means taking width from something else.
    this.meters = {
      sanity: new Meter(this, meterX, meterY, 'SANITY', METER_COLORS.sanity, ICONS.sanity, meterBar),
      spirituality: new Meter(this, meterX + meterGap, meterY, 'SPIRIT', METER_COLORS.spirituality, ICONS.spirituality, meterBar),
      concealment: new Meter(this, meterX + meterGap * 2, meterY, 'CONCEAL', METER_COLORS.concealment, ICONS.concealment, meterBar),
      digestion: new Meter(this, meterX + meterGap * 3, meterY, 'DIGEST', METER_COLORS.digestion, ICONS.sequence, meterBar),
    };

    const purseX = tall ? GAME_WIDTH - 112 : 654;
    const purseY = tall ? 18 : 24;
    this.add.image(purseX, purseY, 'icons', ICONS.pound).setScale(1.2);
    this.purse = this.add
      .text(purseX + 12, purseY, '', { fontFamily: FONT_UI, fontSize: '14px', color: CSS.parchment })
      .setOrigin(0, 0.5);

    // In portrait the two always-on buttons move to a bar along the bottom —
    // the only part of a phone screen a thumb reaches without regripping — and
    // get the full width to split between them.
    const footer = hudFooterHeight();
    if (tall) {
      drawPanel(this, 0, GAME_HEIGHT - footer, GAME_WIDTH, footer, {
        radius: 0,
        borderWidth: 0,
        fill: COLORS.soot,
        fillAlpha: 0.92,
      });
      const footerRule = this.add.graphics();
      footerRule.lineStyle(1, COLORS.brassDim, 0.6);
      footerRule.lineBetween(0, GAME_HEIGHT - footer, GAME_WIDTH, GAME_HEIGHT - footer);
    }

    const btnW = tall ? (GAME_WIDTH - 36) / 2 : 84;
    const btnH = tall ? minTapHeight() : 32;
    const btnY = tall ? GAME_HEIGHT - footer + (footer - btnH) / 2 : 8;
    const powersX = tall ? 12 : GAME_WIDTH - btnW * 2 - 14;
    const journalX = tall ? GAME_WIDTH - btnW - 12 : GAME_WIDTH - btnW - 8;
    new Button(this, powersX, btnY, 'Powers', () => this.openOverlay('AbilityMenu'), {
      width: btnW,
      height: btnH,
      fontSize: tall ? 15 : 12,
    });
    new Button(this, journalX, btnY, 'Journal', () => this.openOverlay('Journal'), {
      width: btnW,
      height: btnH,
      fontSize: tall ? 15 : 12,
    });

    this.noticeText = this.add
      .text(GAME_WIDTH / 2, barH + 14, '', {
        fontFamily: FONT_UI,
        fontSize: '13px',
        color: CSS.parchment,
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 60 },
      })
      .setOrigin(0.5, 0)
      .setAlpha(0);
    this.noticeText.setShadow(0, 2, '#000000', 4);

    this.refreshAll();
    this.subscribe();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const off of this.unsubscribe) off();
      this.unsubscribe = [];
    });

    void state;
  }

  private subscribe(): void {
    this.unsubscribe.push(
      bus.on('stat:changed', ({ stat, value, max, delta }) => {
        this.meters[stat].setValue(value, max);
        if (Math.abs(delta) >= 5) this.pulse(stat === 'sanity' || delta < 0 ? COLORS.bad : COLORS.good);
      }),
      bus.on('money:changed', ({ pence, delta }) => {
        this.purse.setText(format(pence));
        this.flashText(this.purse, delta > 0 ? CSS.good : CSS.bad);
      }),
      bus.on('sequence:changed', () => this.refreshAll()),
      bus.on('day:advanced', () => this.refreshAll()),
      bus.on('notice', ({ text, tone }) => this.showNotice(text, tone)),
    );
  }

  private refreshAll(): void {
    const state = this.session.state;
    this.rankText.setText(`Sequence ${state.sequence} — ${state.sequenceTitle}`);
    this.dayText.setText(
      `Day ${state.day} · rent due in ${state.daysUntilRent} day${state.daysUntilRent === 1 ? '' : 's'}`,
    );
    this.purse.setText(format(state.pence));
    this.meters.sanity.snap(state.sanity, state.sanityMax);
    this.meters.spirituality.snap(state.spirituality, state.spiritualityMax);
    this.meters.concealment.snap(state.concealment, 100);
    this.meters.digestion.snap(state.digestion, 100);
  }

  private flashText(target: Phaser.GameObjects.Text, color: string): void {
    target.setColor(color);
    this.time.delayedCall(700, () => target.setColor(CSS.parchment));
  }

  private pulse(color: number): void {
    const flash = this.add.rectangle(GAME_WIDTH / 2, hudHeight() / 2, GAME_WIDTH, hudHeight(), color, 0.18);
    this.tweens.add({ targets: flash, alpha: 0, duration: 450, onComplete: () => flash.destroy() });
  }

  private showNotice(text: string, tone: 'info' | 'good' | 'bad' | 'occult' = 'info'): void {
    const colors = { info: CSS.parchment, good: CSS.good, bad: CSS.bad, occult: CSS.occult };
    this.noticeTimer?.remove();
    this.noticeText.setText(text).setColor(colors[tone]).setAlpha(1);
    this.tweens.killTweensOf(this.noticeText);
    const restY = hudHeight() + 14;
    this.noticeText.y = restY - 6;
    this.tweens.add({ targets: this.noticeText, y: restY, duration: 220, ease: 'Quad.easeOut' });
    this.noticeTimer = this.time.delayedCall(2600, () => {
      this.tweens.add({ targets: this.noticeText, alpha: 0, duration: 500 });
    });
  }

  private openOverlay(key: string): void {
    // The world scene owns pausing; ask it rather than reaching across scenes.
    const world = this.scene.get('World');
    if (!world || !this.scene.isActive('World')) return;
    world.scene.pause();
    if (key === 'AbilityMenu') {
      this.scene.launch(key, { context: 'investigation', witnessed: false });
    } else {
      this.scene.launch(key);
    }
  }

  override update(): void {
    this.meters.sanity.tick();
    this.meters.spirituality.tick();
    this.meters.concealment.tick();
    this.meters.digestion.tick();
  }
}
