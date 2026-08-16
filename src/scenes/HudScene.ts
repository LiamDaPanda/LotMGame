import Phaser from 'phaser';
import { bus } from '@/systems/EventBus';
import { Session } from '@/systems/Session';
import { format } from '@/systems/Money';
import { Button, Meter, drawPanel } from '@/ui/widgets';
import { COLORS, CSS, FONT_UI, GAME_WIDTH, ICONS, METER_COLORS } from '@/ui/theme';

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

    drawPanel(this, 0, 0, GAME_WIDTH, 48, { radius: 0, borderWidth: 0, fill: COLORS.soot, fillAlpha: 0.92 });
    const rule = this.add.graphics();
    rule.lineStyle(1, COLORS.brassDim, 0.6);
    rule.lineBetween(0, 48, GAME_WIDTH, 48);

    this.rankText = this.add.text(14, 8, '', {
      fontFamily: 'Georgia, serif',
      fontSize: '15px',
      color: CSS.brass,
    });
    this.dayText = this.add.text(14, 28, '', { fontFamily: FONT_UI, fontSize: '10px', color: CSS.muted });

    this.meters = {
      sanity: new Meter(this, 190, 12, 'SANITY', METER_COLORS.sanity, ICONS.sanity, 92),
      spirituality: new Meter(this, 330, 12, 'SPIRIT', METER_COLORS.spirituality, ICONS.spirituality, 92),
      concealment: new Meter(this, 470, 12, 'CONCEALMENT', METER_COLORS.concealment, ICONS.concealment, 92),
      digestion: new Meter(this, 610, 12, 'DIGESTION', METER_COLORS.digestion, ICONS.sequence, 92),
    };

    this.add.image(760, 24, 'icons', ICONS.pound).setScale(1.2);
    this.purse = this.add
      .text(772, 24, '', { fontFamily: FONT_UI, fontSize: '14px', color: CSS.parchment })
      .setOrigin(0, 0.5);

    new Button(this, GAME_WIDTH - 108, 8, 'Journal  (J)', () => this.openJournal(), {
      width: 96,
      height: 32,
      fontSize: 12,
    });

    this.noticeText = this.add
      .text(GAME_WIDTH / 2, 62, '', {
        fontFamily: FONT_UI,
        fontSize: '13px',
        color: CSS.parchment,
        align: 'center',
        wordWrap: { width: 560 },
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
    const flash = this.add.rectangle(GAME_WIDTH / 2, 24, GAME_WIDTH, 48, color, 0.18);
    this.tweens.add({ targets: flash, alpha: 0, duration: 450, onComplete: () => flash.destroy() });
  }

  private showNotice(text: string, tone: 'info' | 'good' | 'bad' | 'occult' = 'info'): void {
    const colors = { info: CSS.parchment, good: CSS.good, bad: CSS.bad, occult: CSS.occult };
    this.noticeTimer?.remove();
    this.noticeText.setText(text).setColor(colors[tone]).setAlpha(1);
    this.tweens.killTweensOf(this.noticeText);
    this.noticeText.y = 56;
    this.tweens.add({ targets: this.noticeText, y: 62, duration: 220, ease: 'Quad.easeOut' });
    this.noticeTimer = this.time.delayedCall(2600, () => {
      this.tweens.add({ targets: this.noticeText, alpha: 0, duration: 500 });
    });
  }

  private openJournal(): void {
    // The world scene owns pausing; ask it rather than reaching across scenes.
    const world = this.scene.get('World');
    if (world && this.scene.isActive('World')) {
      world.scene.pause();
      this.scene.launch('Journal');
    }
  }

  override update(): void {
    this.meters.sanity.tick();
    this.meters.spirituality.tick();
    this.meters.concealment.tick();
    this.meters.digestion.tick();
  }
}
