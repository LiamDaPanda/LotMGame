import Phaser from 'phaser';
import { bus } from '@/systems/EventBus';
import { Session } from '@/systems/Session';
import { describeTender, format } from '@/systems/Money';
import { Button, ScrollList, drawPanel, sectionHeader } from '@/ui/widgets';
import { COLORS, CSS, FONT_BODY, FONT_UI, GAME_HEIGHT, GAME_WIDTH } from '@/ui/theme';

type Mode = 'buy' | 'sell';

/**
 * The quartermaster's requisition table — the main money sink.
 *
 * Prices are quoted in full ledger form and the flavour line names the actual
 * notes and coins that change hands, because the currency is meant to be felt
 * as period texture rather than an abstract number.
 */
export class ShopScene extends Phaser.Scene {
  private session!: Session;
  private list?: ScrollList;
  private mode: Mode = 'buy';
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

  create(): void {
    this.session = Session.get(this);
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.86).setOrigin(0, 0).setInteractive();
    drawPanel(this, this.x, this.y, this.w, this.h);
    sectionHeader(
      this,
      this.x + 24,
      this.y + 18,
      this.w - 48,
      'Requisition',
      'The Star keeps the cupboard. The Star keeps the ledger too.',
    );

    this.purseText = this.add.text(this.x + this.w - 220, this.y + 24, '', {
      fontFamily: FONT_UI,
      fontSize: '14px',
      color: CSS.brass,
    });

    this.modeButtons = [
      new Button(this, this.x + 24, this.y + 70, 'Requisition', () => this.setMode('buy'), {
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

  private buyRows(): Phaser.GameObjects.Container[] {
    const state = this.session.state;
    const rows: Phaser.GameObjects.Container[] = [];

    for (const item of this.session.content.items.values()) {
      if (item.pricePence === undefined) continue;
      const gateOk = state.check(item.requires);
      const affordable = state.canAfford(item.pricePence);
      const container = this.add.container(0, 0);
      const height = 64;
      container.setSize(this.w - 48, height);

      const reason = !gateOk
        ? (state.explain(item.requires) ?? 'The Star will not part with it')
        : !affordable
          ? `You are short ${format(item.pricePence - state.pence)}`
          : undefined;

      container.add(
        new Button(this, 0, 0, `${item.name}  —  ${format(item.pricePence)}`, () => this.buy(item.id), {
          width: this.w - 48,
          height,
          align: 'left',
          fontSize: 14,
          iconFrame: item.icon,
          enabled: gateOk && affordable,
          subtitle: reason ?? item.description,
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
      const container = this.add.container(0, 0);
      const height = 64;
      container.setSize(this.w - 48, height);
      container.add(
        new Button(
          this,
          0,
          0,
          `${item.name}${count > 1 ? ` ×${count}` : ''}  —  ${format(item.sellPence)}`,
          () => this.sell(item.id),
          {
            width: this.w - 48,
            height,
            align: 'left',
            fontSize: 14,
            iconFrame: item.icon,
            tone: 'good',
            subtitle: item.description,
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
    if (!item?.pricePence) return;
    if (!this.session.state.spend(item.pricePence)) {
      bus.emit('notice', { text: 'Not enough in the purse.', tone: 'bad' });
      return;
    }
    this.session.state.addItem(itemId);
    this.session.state.addTrust('star', 1);
    this.flavourText.setText(
      `You count out ${describeTender(item.pricePence)}. The Star writes the line, blots it, and hands over the ${item.name.toLowerCase()}.`,
    );
    bus.emit('notice', { text: `Requisitioned: ${item.name}`, tone: 'good' });
    this.render();
  }

  private sell(itemId: string): void {
    const item = this.session.content.item(itemId);
    if (!item?.sellPence) return;
    if (!this.session.state.removeItem(itemId)) return;
    this.session.state.addPence(item.sellPence);
    this.flavourText.setText(
      `The Star turns the ${item.name.toLowerCase()} over twice, then pays you ${describeTender(item.sellPence)}.`,
    );
    bus.emit('notice', { text: `Sold: ${item.name}`, tone: 'good' });
    this.render();
  }

  private close(): void {
    this.scene.stop();
    if (this.scene.isPaused('World')) this.scene.resume('World');
  }
}
