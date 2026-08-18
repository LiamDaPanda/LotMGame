import Phaser from 'phaser';
import { PixelText, pixelText } from '@/ui/pixelFont';
import { bus } from '@/systems/EventBus';
import { Session } from '@/systems/Session';
import { format } from '@/systems/Money';
import { Button, Meter, drawPanel } from '@/ui/widgets';
import {
  COLORS,
  CSS,
  GAME_WIDTH,
  ICONS,
  METER_COLORS,
  type Rect,
  isPortrait,
  landscapeRightStrip,
  mapRect,
  metersRect,
  statusRect,
  tabBarRect,
} from '@/ui/theme';

/** The bottom-screen tabs, in the order a thumb meets them. */
const TABS = [
  { key: 'CaseBoard', label: 'CASE' },
  { key: 'Journal', label: 'NOTES' },
  { key: 'AbilityMenu', label: 'POWER' },
] as const;

/**
 * The chrome around the two screens: the status strip above the map, the meter
 * row below it, and the tab bar along the bottom.
 *
 * Runs as its own scene above the world so it survives room changes and never
 * scrolls with the camera. It is purely a listener: it reads nothing on a timer
 * and writes nothing to state. Every number here arrives as an event from the
 * system that changed it.
 */
export class HudScene extends Phaser.Scene {
  private session!: Session;
  private meters!: {
    sanity: Meter;
    spirituality: Meter;
    concealment: Meter;
    digestion: Meter;
  };
  private purse!: PixelText;
  private rankText!: PixelText;
  private dayText!: PixelText;
  private noticeText!: PixelText;
  private noticeTimer?: Phaser.Time.TimerEvent;
  private tabButtons: Button[] = [];
  private unsubscribe: Array<() => void> = [];

  constructor() {
    super('Hud');
  }

  create(): void {
    this.session = Session.get(this);
    this.tabButtons = [];

    const tall = isPortrait();
    const status = statusRect();
    const meters = metersRect();

    this.drawStrip(status);
    const identityWidth = GAME_WIDTH - (tall ? 130 : landscapeRightStrip()) - 20;
    this.rankText = pixelText(this, 10, 8, '', {
      size: 'md',
      color: CSS.brass,
      wrap: identityWidth,
      maxHeight: 20,
    });
    this.dayText = pixelText(this, 10, 30, '', {
      size: 'md',
      color: CSS.muted,
      wrap: identityWidth,
      maxHeight: 20,
    });

    // Portrait has the whole right edge; landscape has to stop short of the two
    // buttons that live there, so both use the same reserved lane.
    const purseRight = tall ? GAME_WIDTH - 14 : GAME_WIDTH - landscapeRightStrip() + 9 * 12 + 10;
    this.add.image(purseRight, 20, 'icons', ICONS.pound).setScale(1.2).setOrigin(1, 0.5);
    this.purse = pixelText(this, purseRight - 16, 20, '', { size: 'md', color: CSS.parchment }).setOrigin(1, 0.5);

    // Both orientations give the meters a row to themselves; in landscape it is
    // the second row of the same strip, so there is no separate band to draw.
    if (tall) this.drawStrip(meters);
    // Four meters share the row. Each is icon + bar + value; the bar takes
    // whatever is left once those fixed parts are paid for, so the last meter
    // ends exactly at the right margin instead of past it.
    const meterX = meters.x + (tall ? 8 : 0);
    const meterY = meters.y + (tall ? 9 : 6);
    const meterGap = (meters.width - (tall ? 16 : 0)) / 4;
    // Icon, bar, value — and no three-letter tag. At either width the row
    // cannot pay for all four, and the floor under the bar pushed each meter
    // into its neighbour's label. The icon and the colour already say which
    // meter this is, and the journal spells them out.
    const meterBar = Math.max(24, meterGap - 16 - 48 - 8);
    this.meters = {
      sanity: new Meter(this, meterX, meterY, '', METER_COLORS.sanity, ICONS.sanity, meterBar),
      spirituality: new Meter(this, meterX + meterGap, meterY, '', METER_COLORS.spirituality, ICONS.spirituality, meterBar),
      concealment: new Meter(this, meterX + meterGap * 2, meterY, '', METER_COLORS.concealment, ICONS.concealment, meterBar),
      digestion: new Meter(this, meterX + meterGap * 3, meterY, '', METER_COLORS.digestion, ICONS.sequence, meterBar),
    };

    if (tall) this.buildTabs(tabBarRect());
    else this.buildLandscapeButtons();

    // Notices land over the map, where the player is looking when one fires.
    this.noticeText = pixelText(this, GAME_WIDTH / 2, mapRect().y + 12, '', {
      size: 'md',
      color: CSS.parchment,
      align: 'center',
      wrap: GAME_WIDTH - 40,
    })
      .setOrigin(0.5, 0)
      .setAlpha(0);

    this.refreshAll();
    this.subscribe();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const off of this.unsubscribe) off();
      this.unsubscribe = [];
      this.tabButtons = [];
    });
  }

  /** A flat soot band with a hairline under it — the chrome's only decoration. */
  private drawStrip(rect: Rect): void {
    drawPanel(this, rect.x, rect.y, rect.width, rect.height, {
      radius: 0,
      borderWidth: 0,
      fill: COLORS.soot,
      fillAlpha: 1,
    });
    const rule = this.add.graphics();
    rule.lineStyle(2, COLORS.brassDim, 0.7);
    rule.lineBetween(rect.x, rect.y + rect.height, rect.x + rect.width, rect.y + rect.height);
  }

  private buildTabs(tabs: Rect): void {
    drawPanel(this, tabs.x, tabs.y, tabs.width, tabs.height, {
      radius: 0,
      borderWidth: 0,
      fill: COLORS.soot,
      fillAlpha: 1,
    });

    const gap = 6;
    const width = (tabs.width - gap * (TABS.length + 1)) / TABS.length;
    const height = tabs.height - 12;
    TABS.forEach((tab, index) => {
      this.tabButtons.push(
        new Button(this, gap + index * (width + gap), tabs.y + 4, tab.label, () => this.openOverlay(tab.key), {
          width,
          height,
          fontSize: 14,
        }),
      );
    });
  }

  /** Landscape keeps the old two buttons tucked into the status strip. */
  private buildLandscapeButtons(): void {
    // Wide enough for "Journal" at 2x plus the plate's own padding; anything
    // narrower wraps the label onto a second line it has no room for.
    const width = 7 * 12 + 16;
    this.tabButtons.push(
      new Button(this, GAME_WIDTH - width * 2 - 14, 8, 'Powers', () => this.openOverlay('AbilityMenu'), {
        width,
        height: 32,
        fontSize: 12,
      }),
      new Button(this, GAME_WIDTH - width - 8, 8, 'Journal', () => this.openOverlay('Journal'), {
        width,
        height: 32,
        fontSize: 12,
      }),
    );
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
    this.rankText.setText(`SEQ ${state.sequence}  ${state.sequenceTitle.toUpperCase()}`);
    this.dayText.setText(`Day ${state.day} · rent in ${state.daysUntilRent}d`);
    this.purse.setText(format(state.pence));
    this.meters.sanity.snap(state.sanity, state.sanityMax);
    this.meters.spirituality.snap(state.spirituality, state.spiritualityMax);
    this.meters.concealment.snap(state.concealment, 100);
    this.meters.digestion.snap(state.digestion, 100);
  }

  private flashText(target: PixelText, color: string): void {
    target.setColor(color);
    this.time.delayedCall(700, () => target.setColor(CSS.parchment));
  }

  private pulse(color: number): void {
    const strip = statusRect();
    const flash = this.add.rectangle(strip.width / 2, strip.height / 2, strip.width, strip.height, color, 0.18);
    this.tweens.add({ targets: flash, alpha: 0, duration: 450, onComplete: () => flash.destroy() });
  }

  private showNotice(text: string, tone: 'info' | 'good' | 'bad' | 'occult' = 'info'): void {
    const colors = { info: CSS.parchment, good: CSS.good, bad: CSS.bad, occult: CSS.occult };
    this.noticeTimer?.remove();
    this.noticeText.setText(text).setColor(colors[tone]).setAlpha(1);
    this.tweens.killTweensOf(this.noticeText);
    const restY = mapRect().y + 12;
    this.noticeText.y = restY - 6;
    this.tweens.add({ targets: this.noticeText, y: restY, duration: 220, ease: 'Quad.easeOut' });
    this.noticeTimer = this.time.delayedCall(2600, () => {
      this.tweens.add({ targets: this.noticeText, alpha: 0, duration: 500 });
    });
  }

  private openOverlay(key: string): void {
    // The world scene owns pausing; ask it rather than reaching across scenes.
    // Note `isActive` is false for a *paused* scene, so it cannot be the test
    // here — with a panel already open the World is exactly that, and using it
    // would make every tab press after the first one do nothing.
    const world = this.scene.get('World');
    if (!world || !(this.scene.isActive('World') || this.scene.isPaused('World'))) return;

    // Pressing a tab whose panel is already open closes it again, which is how
    // a bottom-screen tab is expected to behave.
    if (this.scene.isActive(key)) {
      this.scene.stop(key);
      if (this.scene.isPaused('World')) this.scene.resume('World');
      return;
    }
    for (const tab of TABS) if (this.scene.isActive(tab.key)) this.scene.stop(tab.key);

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
