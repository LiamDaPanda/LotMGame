import Phaser from 'phaser';
import { bus } from '@/systems/EventBus';
import { Session } from '@/systems/Session';
import { describeTender, format } from '@/systems/Money';
import { marketDiscount } from '@/systems/Skills';
import { Button, ScrollList, drawPanel, sectionHeader } from '@/ui/widgets';
import { COLORS, CSS, FONT_BODY, FONT_UI, GAME_HEIGHT, GAME_WIDTH } from '@/ui/theme';
import type { ItemData, VendorId } from '@/types/schema';

type Mode = 'buy' | 'sell';

/**
 * A counter you trade across. Two of them share this scene:
 *
 * - **The Club** (`club`) — fixed prices, a written ledger, no risk.
 * - **Crookback Alley** (`market`) — a fence. Streetwise moves the price in
 *   your favour, the stock is things the Club will not touch, and every
 *   purchase costs concealment because somebody always sees.
 *
 * Prices are quoted in full ledger form and the flavour line names the actual
 * notes and coins that change hands, because the currency is meant to be felt
 * as period texture rather than an abstract number.
 */

interface ShopSceneData {
  vendor?: VendorId;
}

const VENDOR = {
  club: {
    title: 'Requisition',
    blurb: 'The Star keeps the cupboard. The Star keeps the ledger too.',
    buyLabel: 'Requisition',
    trustee: 'star',
  },
  market: {
    title: 'Crookback Alley',
    blurb: 'No ledger, no names, and the price depends on how you ask.',
    buyLabel: 'Buy',
    trustee: undefined,
  },
} as const;

export class ShopScene extends Phaser.Scene {
  private session!: Session;
  private list?: ScrollList;
  private mode: Mode = 'buy';
  private vendor: VendorId = 'club';
  private purseText!: Phaser.GameObjects.Text;
  private flavourText!: Phaser.GameObjects.Text;
  private modeButtons: Button[] = [];

  private readonly x = 110;
  private readonly y = 50;
  private readonly w = GAME_WIDTH - 220;
  private readonly h = GAME_HEIGHT - 100;

  constructor() {
    super('Shop');
  }

  create(data: ShopSceneData): void {
    this.session = Session.get(this);
    this.vendor = data?.vendor ?? 'club';
    const vendor = VENDOR[this.vendor];

    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.86).setOrigin(0, 0).setInteractive();
    drawPanel(this, this.x, this.y, this.w, this.h, {
      border: this.vendor === 'market' ? COLORS.blood : COLORS.brassDim,
    });
    sectionHeader(
      this,
      this.x + 24,
      this.y + 18,
      this.w - 48,
      vendor.title,
      this.vendor === 'market'
        ? `${vendor.blurb}  ·  Streetwise ${this.session.state.skill('streetwise')} — prices reflect it`
        : vendor.blurb,
    );

    this.purseText = this.add.text(this.x + this.w - 220, this.y + 24, '', {
      fontFamily: FONT_UI,
      fontSize: '14px',
      color: CSS.brass,
    });

    this.modeButtons = [
      new Button(this, this.x + 24, this.y + 70, vendor.buyLabel, () => this.setMode('buy'), {
        width: 130,
        height: 32,
        fontSize: 12,
      }),
      new Button(this, this.x + 164, this.y + 70, 'Sell', () => this.setMode('sell'), {
        width: 130,
        height: 32,
        fontSize: 12,
      }),
    ];

    this.flavourText = this.add.text(this.x + 24, this.y + this.h - 84, '', {
      fontFamily: FONT_BODY,
      fontSize: '12px',
      color: CSS.muted,
      wordWrap: { width: this.w - 220 },
    });

    new Button(this, this.x + this.w - 174, this.y + this.h - 54, 'Leave', () => this.close(), {
      width: 150,
      height: 38,
      fontSize: 13,
    });
    this.input.keyboard?.on('keydown-ESC', () => this.close());

    this.setMode('buy');
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.modeButtons[0]?.setEnabled(mode !== 'buy');
    this.modeButtons[1]?.setEnabled(mode !== 'sell');
    this.render();
  }

  private render(): void {
    this.list?.destroy();
    this.purseText.setText(`Purse: ${format(this.session.state.pence)}`);

    const rows =
      this.mode === 'buy' ? this.buyRows() : this.sellRows();

    this.list = new ScrollList(this, this.x + 24, this.y + 112, {
      width: this.w - 48,
      height: this.h - 210,
      gap: 8,
    });
    this.list.setRows(rows);
    this.list.refreshMask();
  }

  /** Items this counter stocks. Defaults to Club-only when unspecified. */
  private stocks(item: ItemData): boolean {
    return (item.vendors ?? ['club']).includes(this.vendor);
  }

  /** Asking price. A fence haggles; the Club's ledger does not. */
  private priceOf(item: ItemData): number {
    const base = item.pricePence ?? 0;
    if (this.vendor !== 'market') return base;
    return Math.max(1, Math.round(base * marketDiscount(this.session.state.skill('streetwise'))));
  }

  /** What the counter pays. A fence pays over the odds for awkward goods. */
  private offerFor(item: ItemData): number {
    const base = item.sellPence ?? 0;
    if (this.vendor !== 'market') return base;
    const bonus = 1.35 + this.session.state.skill('streetwise') * 0.04;
    return Math.round(base * bonus);
  }

  private buyRows(): Phaser.GameObjects.Container[] {
    const state = this.session.state;
    const rows: Phaser.GameObjects.Container[] = [];

    for (const item of this.session.content.items.values()) {
      if (item.pricePence === undefined) continue;
      if (!this.stocks(item)) continue;
      const price = this.priceOf(item);
      const gateOk = state.check(item.requires);
      const affordable = state.canAfford(price);
      const container = this.add.container(0, 0);
      const height = 64;
      container.setSize(this.w - 48, height);

      const reason = !gateOk
        ? (state.explain(item.requires) ?? 'They will not part with it')
        : !affordable
          ? `You are short ${format(price - state.pence)}`
          : undefined;
      const heat = item.heat ? `  ·  costs you ${item.heat} concealment` : '';

      container.add(
        new Button(this, 0, 0, `${item.name}  —  ${format(price)}`, () => this.buy(item.id), {
          width: this.w - 48,
          height,
          align: 'left',
          fontSize: 14,
          iconFrame: item.icon,
          enabled: gateOk && affordable,
          tone: this.vendor === 'market' ? 'bad' : 'default',
          subtitle: reason ?? `${item.description}${heat}`,
        }),
      );
      rows.push(container);
    }

    if (rows.length === 0) rows.push(this.emptyRow('The cupboard is bare.'));
    return rows;
  }

  private sellRows(): Phaser.GameObjects.Container[] {
    const state = this.session.state;
    const rows: Phaser.GameObjects.Container[] = [];

    for (const [itemId, count] of state.inventory) {
      const item = this.session.content.item(itemId);
      if (!item?.sellPence) continue;
      const offer = this.offerFor(item);
      const container = this.add.container(0, 0);
      const height = 64;
      container.setSize(this.w - 48, height);
      container.add(
        new Button(
          this,
          0,
          0,
          `${item.name}${count > 1 ? ` ×${count}` : ''}  —  ${format(offer)}`,
          () => this.sell(item.id),
          {
            width: this.w - 48,
            height,
            align: 'left',
            fontSize: 14,
            iconFrame: item.icon,
            tone: 'good',
            subtitle:
              this.vendor === 'market'
                ? `${item.description}\nA fence pays over the odds and asks nothing.`
                : item.description,
          },
        ),
      );
      rows.push(container);
    }

    if (rows.length === 0) rows.push(this.emptyRow('You have nothing the Club wants.'));
    return rows;
  }

  private emptyRow(text: string): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);
    container.setSize(this.w - 48, 36);
    container.add(this.add.text(0, 8, text, { fontFamily: FONT_BODY, fontSize: '13px', color: CSS.muted }));
    return container;
  }

  private buy(itemId: string): void {
    const item = this.session.content.item(itemId);
    if (item?.pricePence === undefined) return;
    const price = this.priceOf(item);
    if (!this.session.state.spend(price)) {
      bus.emit('notice', { text: 'Not enough in the purse.', tone: 'bad' });
      return;
    }
    this.session.state.addItem(itemId);

    if (this.vendor === 'market') {
      // Being seen buying the wrong thing is the price of the wrong thing.
      if (item.heat) this.session.state.addConcealment(-item.heat);
      this.flavourText.setText(
        item.patter ??
          `${describeTender(price)} changes hands in a doorway. Nothing is written down, which is the point and also the problem.`,
      );
    } else {
      this.session.state.addTrust('star', 1);
      this.flavourText.setText(
        `You count out ${describeTender(price)}. The Star writes the line, blots it, and hands over the ${item.name.toLowerCase()}.`,
      );
    }
    bus.emit('notice', { text: `Acquired: ${item.name}`, tone: 'good' });
    this.render();
  }

  private sell(itemId: string): void {
    const item = this.session.content.item(itemId);
    if (!item?.sellPence) return;
    const offer = this.offerFor(item);
    if (!this.session.state.removeItem(itemId)) return;
    this.session.state.addPence(offer);

    if (this.vendor === 'market') {
      this.session.state.addConcealment(-2);
      this.flavourText.setText(
        `He does not ask where the ${item.name.toLowerCase()} came from. He pays ${describeTender(offer)} and it is gone, and so is any way of getting it back.`,
      );
    } else {
      this.flavourText.setText(
        `The Star turns the ${item.name.toLowerCase()} over twice, then pays you ${describeTender(offer)}.`,
      );
    }
    bus.emit('notice', { text: `Sold: ${item.name}`, tone: 'good' });
    this.render();
  }

  private close(): void {
    this.scene.stop();
    if (this.scene.isPaused('World')) this.scene.resume('World');
  }
}
