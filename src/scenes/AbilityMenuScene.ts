import Phaser from 'phaser';
import { PixelText, pixelText } from '@/ui/pixelFont';
import { Session } from '@/systems/Session';
import { Button, ScrollList, drawPanel, panelStage, sectionHeader } from '@/ui/widgets';
import {
  CSS,
  ICONS,
  menuRect,
  minTapHeight,
} from '@/ui/theme';
import type { AbilityContext, AbilityData } from '@/types/schema';

interface AbilityMenuData {
  /** Where the menu was opened from — gates which powers are offered. */
  context: AbilityContext;
  /** Somebody can see you do this. */
  witnessed: boolean;
}

/**
 * The powers menu — abilities used on purpose rather than when the game offers
 * them.
 *
 * Anything self-directed (steady yourself, practise the role, blend in, read the
 * street) fires straight from here. Anything that needs a target says so instead
 * of being hidden, so the player learns where it *is* used.
 */
export class AbilityMenuScene extends Phaser.Scene {
  private session!: Session;
  private list?: ScrollList;
  /** Where the body may start, once the header has measured itself. */
  private headerBottom = 0;
  private resultText!: PixelText;
  private context: AbilityContext = 'hub';
  private witnessed = false;


  private x = 0;
  private y = 0;
  private w = 0;
  private h = 0;

  constructor() {
    super('AbilityMenu');
  }

  create(data: AbilityMenuData): void {
    // Read the layout here, not in a field: scene instances outlive a rotation.
    const pane = menuRect();
    this.x = pane.x + 10;
    this.y = pane.y + 10;
    this.w = pane.width - 20;
    this.h = pane.height - 20;
    this.session = Session.get(this);
    this.context = data?.context ?? 'hub';
    this.witnessed = data?.witnessed ?? false;

    panelStage(this, 0.86);
    drawPanel(this, this.x, this.y, this.w, this.h);

    const state = this.session.state;
    const header = sectionHeader(
      this,
      this.x + 24,
      this.y + 16,
      this.w - 48,
      'Powers',
      `${state.rankLabel}   ·   ${
        this.witnessed ? 'You are in company: full exposure' : 'Nobody is watching: reduced exposure'
      }`,
    );
    this.headerBottom = header.y + header.height;

    this.resultText = pixelText(this, this.x + 24, this.y + this.h - 76, '', {
        fontSize: '13px',
        color: CSS.occult,
        wordWrap: { width: this.w - 200 },
      })
      .setOrigin(0, 0);

    new Button(this, this.x + this.w - 174, this.y + this.h - 54, 'Close  (Q)', () => this.close(), {
      width: 150,
      height: 38,
      fontSize: 13,
    });

    this.input.keyboard?.on('keydown-ESC', () => this.close());
    this.input.keyboard?.on('keydown-Q', () => this.close());

    this.render();
  }

  private render(): void {
    this.list?.destroy();
    const abilities = this.session.abilities.available(this.context);
    const rows = abilities.map((ability) => this.abilityRow(ability));
    if (rows.length === 0) rows.push(this.emptyRow('You have nothing you could reach for here.'));

    const bodyY = this.headerBottom;
    this.list = new ScrollList(this, this.x + 24, bodyY, {
      width: this.w - 48,
      height: this.y + this.h - minTapHeight() - 24 - bodyY,
      gap: 8,
    });
    this.list.setRows(rows);
    this.list.refreshMask();
  }

  private emptyRow(text: string): Phaser.GameObjects.Container {
    const width = this.w - 48;
    const container = this.add.container(0, 0);
    // Wrapped and measured: on a phone this line is wider than the panel, and
    // a mortal Klein sees it every time he opens the powers menu.
    const label = pixelText(this, 0, 8, text, { fontSize: '13px', color: CSS.muted, wrap: width });
    container.setSize(width, label.height + 16);
    container.add(label);
    return container;
  }

  private abilityRow(ability: AbilityData): Phaser.GameObjects.Container {
    const width = this.w - 48;
    const height = 66;
    const container = this.add.container(0, 0);
    container.setSize(width, height);

    const usable = this.session.abilities.invokable(ability);
    const check = this.session.abilities.canUse(ability.id, {
      context: this.context,
      witnessed: this.witnessed,
    });

    const spirit = this.session.abilities.spiritCostOf(ability);
    const concealment = this.session.abilities.concealmentCostOf(ability, this.witnessed);
    const costs = [`${spirit} spirit`];
    if (ability.sanityCost) costs.push(`${ability.sanityCost} sanity`);
    if (concealment) costs.push(`${concealment} concealment`);

    let subtitle: string;
    let enabled: boolean;
    if (ability.passive) {
      subtitle = `${ability.summary}  ·  always in effect`;
      enabled = false;
    } else if (!usable) {
      // Targeted powers are listed so the player learns where they apply.
      subtitle = `${ability.summary}  ·  use it on something: ${this.targetHint(ability)}`;
      enabled = false;
    } else if (!check.ok) {
      subtitle = `${ability.summary}  ·  ${check.reason}`;
      enabled = false;
    } else {
      subtitle = `${ability.summary}  ·  ${costs.join(', ')}`;
      enabled = true;
    }

    container.add(
      new Button(this, 0, 0, `${ability.name}   —   Sequence ${ability.sequence}`, () => this.invoke(ability), {
        width,
        height,
        align: 'left',
        fontSize: 14,
        tone: 'occult',
        iconFrame: ability.passive ? ICONS.sequence : ICONS.spirituality,
        enabled,
        subtitle,
      }),
    );
    return container;
  }

  private targetHint(ability: AbilityData): string {
    switch (ability.effect.kind) {
      case 'reveal_clue':
        return 'examine a thing at the scene';
      case 'unlock_access':
        return 'examine something shut';
      case 'reveal_truth':
      case 'social_pressure':
        return 'in conversation';
      case 'escape':
        return 'when something has you cornered';
      default:
        return 'not here';
    }
  }

  private invoke(ability: AbilityData): void {
    const result = this.session.abilities.invoke(ability.id, {
      context: this.context,
      witnessed: this.witnessed,
    });
    this.resultText.setText(result.text).setColor(result.ok ? CSS.occult : CSS.bad);
    if (result.ok) this.cameras.main.flash(150, 50, 35, 80);
    this.render();
  }

  private close(): void {
    this.scene.stop();
    if (this.scene.isPaused('World')) this.scene.resume('World');
  }
}
