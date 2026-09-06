import Phaser from 'phaser';
import { PixelText, pixelText } from '@/ui/pixelFont';
import { bus } from '@/systems/EventBus';
import { Session } from '@/systems/Session';
import { Button, ScrollList, drawPanel, panelStage, sectionHeader } from '@/ui/widgets';
import {
  COLORS,
  CSS,
  GAME_HEIGHT,
  GAME_WIDTH,
  ICONS,
  isPortrait,
  minTapHeight,
  panelInset,
} from '@/ui/theme';
import type { AbilityData, AbilityEffectKind, HotspotData } from '@/types/schema';

interface ExamineSceneData {
  hotspot: HotspotData;
  mapId: string;
  /** Somebody is in the room; using a power here will be seen. */
  witnessed: boolean;
}

/**
 * Examining a thing.
 *
 * This is where the two halves of the game meet. A plain look yields the
 * mundane clues. Anything more needs a Beyonder ability, and the panel is
 * explicit about what that costs in spirituality, sanity and concealment —
 * so choosing to use power always reads as a decision, not a free action.
 */
export class ExamineScene extends Phaser.Scene {
  private session!: Session;
  private hotspot!: HotspotData;
  private witnessed = false;
  private list!: ScrollList;
  private body!: PixelText;

  constructor() {
    super('Examine');
  }

  create(data: ExamineSceneData): void {
    this.session = Session.get(this);
    this.hotspot = data.hotspot;
    this.witnessed = data.witnessed;

    panelStage(this, 0.72);

    const panelX = panelInset();
    const panelY = isPortrait() ? 96 : 70;
    const panelW = GAME_WIDTH - panelInset() * 2;
    const panelH = GAME_HEIGHT - panelY - (isPortrait() ? 90 : 80);
    drawPanel(this, panelX, panelY, panelW, panelH);

    const header = sectionHeader(this, panelX + 24, panelY + 18, panelW - 48, this.hotspot.name);

    // First look before layout: the description's own height decides where the
    // findings list starts, and an empty text object measures zero — which put
    // the list straight through the prose.
    this.applyFirstLook();
    const locked = this.isLocked();
    this.body = pixelText(
      this,
      panelX + 24,
      header.y + header.height,
      locked ? `${this.hotspot.description}\n\n${this.hotspot.locked?.reason}` : this.hotspot.description,
      { size: 'md', color: CSS.parchment, wrap: panelW - 48, maxHeight: panelH * 0.4 },
    );

    const listY = this.body.y + this.body.height + 10;
    this.list = new ScrollList(this, panelX + 24, listY, {
      width: panelW - 48,
      height: panelY + panelH - minTapHeight() - 24 - listY,
      gap: 8,
    });

    new Button(
      this,
      GAME_WIDTH / 2 - 90,
      panelY + panelH - minTapHeight() - 12,
      'Step back',
      () => this.close(),
      { width: 180, height: minTapHeight() },
    );

    this.input.keyboard?.on('keydown-ESC', () => this.close());
    this.refresh();
  }

  /** True while the hotspot is shut and the player has no way past it. */
  private isLocked(): boolean {
    if (!this.hotspot.locked) return false;
    if (this.session.state.hasFlag(`unlocked_${this.hotspot.id}`)) return false;
    return !this.session.state.check(this.hotspot.locked.bypass);
  }

  private applyFirstLook(): void {
    // A locked thing yields nothing — not its clues, not its contents. Looking
    // at a strongbox is not the same as opening it.
    if (this.isLocked()) return;

    // Clues are idempotent, but effects are not: without this guard, looking at
    // the watch twice would put two watches in your pocket. The flag is part of
    // game state so it survives a save.
    const examinedFlag = `examined_${this.hotspot.id}`;
    if (this.session.state.hasFlag(examinedFlag)) return;
    this.session.state.setFlag(examinedFlag);

    const found: string[] = [];
    for (const clueId of this.hotspot.clues ?? []) {
      if (this.session.cases.grantClue(clueId)) found.push(clueId);
    }
    if (this.hotspot.effect) this.session.state.apply(this.hotspot.effect);
    if (found.length > 0) this.session.cases.refreshObjectives();
  }

  /** Ability effect kinds this hotspot will respond to, and what they'd yield. */
  private abilityOffers(): { kind: AbilityEffectKind; ability: AbilityData; remaining: number }[] {
    const offers: { kind: AbilityEffectKind; ability: AbilityData; remaining: number }[] = [];
    for (const [kind, clueIds] of Object.entries(this.hotspot.abilityClues ?? {})) {
      const effectKind = kind as AbilityEffectKind;
      const ability = this.session.abilities.withEffect(effectKind, 'investigation');
      if (!ability) continue;
      const remaining = (clueIds ?? []).filter((id) => !this.session.state.hasClue(id)).length;
      offers.push({ kind: effectKind, ability, remaining });
    }
    return offers;
  }

  private refresh(): void {
    const state = this.session.state;
    const locked = this.isLocked();

    this.body.setText(locked ? `${this.hotspot.description}\n\n${this.hotspot.locked?.reason}` : this.hotspot.description);

    const rows: Phaser.GameObjects.Container[] = [];
    const rowWidth = GAME_WIDTH - panelInset() * 2 - 48;

    // What a plain look turned up.
    const known = (this.hotspot.clues ?? []).filter((id) => state.hasClue(id));
    for (const clueId of known) {
      rows.push(this.clueRow(clueId, rowWidth));
    }
    for (const clueIds of Object.values(this.hotspot.abilityClues ?? {})) {
      for (const clueId of clueIds ?? []) {
        if (state.hasClue(clueId)) rows.push(this.clueRow(clueId, rowWidth));
      }
    }

    if (locked && this.hotspot.locked) {
      const opener = this.session.abilities.withEffect('unlock_access', 'investigation');
      if (opener) {
        rows.push(this.abilityRow(opener, 'Force it', rowWidth, () => this.useUnlock(opener)));
      }
    } else {
      for (const offer of this.abilityOffers()) {
        if (offer.remaining === 0) continue;
        rows.push(
          this.abilityRow(offer.ability, offer.ability.name, rowWidth, () => this.useAbility(offer.kind, offer.ability)),
        );
      }
    }

    if (rows.length === 0) {
      rows.push(this.noteRow('Nothing more here that you can see.', rowWidth));
    }

    this.list.setRows(rows);
    this.list.refreshMask();
  }

  private clueRow(clueId: string, width: number): Phaser.GameObjects.Container {
    const found = this.session.content
      .clueIndex()
      .get(clueId);
    const container = this.add.container(0, 0);
    const height = 58;
    container.setSize(width, height);

    const bg = this.add.graphics();
    bg.fillStyle(COLORS.panelLight, 0.6);
    bg.fillRoundedRect(0, 0, width, height, 4);
    bg.lineStyle(1, COLORS.brassDim, 0.5);
    bg.strokeRoundedRect(0, 0, width, height, 4);
    container.add(bg);

    container.add(this.add.image(18, height / 2, 'icons', ICONS.clue).setScale(1.2));
    container.add(
      pixelText(this, 36, 9, found?.clue.title ?? clueId, {
        fontSize: '13px',
        color: CSS.good,
      }),
    );
    container.add(
      pixelText(this, 36, 28, found?.clue.text ?? '', {
        fontSize: '12px',
        color: CSS.muted,
        wordWrap: { width: width - 52 },
      }),
    );
    return container;
  }

  private noteRow(text: string, width: number): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);
    const label = pixelText(this, 0, 6, text, { size: 'md', color: CSS.muted, wrap: width });
    container.setSize(width, label.height + 12);
    container.add(label);
    return container;
  }

  /** A row offering to spend power, with the full price printed on it. */
  private abilityRow(
    ability: AbilityData,
    label: string,
    width: number,
    onUse: () => void,
  ): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);
    const height = 62;
    container.setSize(width, height);

    const check = this.session.abilities.canUse(ability.id, {
      context: 'investigation',
      witnessed: this.witnessed,
    });
    const concealment = this.session.abilities.concealmentCostOf(ability, this.witnessed);
    const costBits = [`${ability.spiritCost} spirit`];
    if (ability.sanityCost) costBits.push(`${ability.sanityCost} sanity`);
    if (concealment) costBits.push(`${concealment} concealment${this.witnessed ? ' — you are watched' : ''}`);

    const button = new Button(
      this,
      0,
      0,
      `${label}`,
      () => {
        if (!check.ok) return;
        onUse();
      },
      {
        width,
        height,
        align: 'left',
        tone: 'occult',
        iconFrame: ICONS.spirituality,
        subtitle: check.ok ? `${ability.summary}   ·   ${costBits.join(', ')}` : (check.reason ?? 'Unavailable'),
        enabled: check.ok,
        fontSize: 14,
      },
    );
    container.add(button);
    return container;
  }

  private useAbility(kind: AbilityEffectKind, ability: AbilityData): void {
    const result = this.session.abilities.use(ability.id, {
      context: 'investigation',
      witnessed: this.witnessed,
    });
    if (!result.ok) {
      bus.emit('notice', { text: result.reason ?? 'It will not come.', tone: 'bad' });
      return;
    }

    const clueIds = this.hotspot.abilityClues?.[kind] ?? [];
    let found = 0;
    for (const clueId of clueIds) {
      if (this.session.cases.grantClue(clueId)) found++;
    }

    // Using a power in character is also how you digest it.
    this.session.progression.act(2, 'You wear the role a little deeper.');

    if (found === 0) bus.emit('notice', { text: 'The vision gives you nothing new.', tone: 'info' });
    this.cameras.main.flash(180, 60, 40, 90);
    this.refresh();
  }

  private useUnlock(ability: AbilityData): void {
    const result = this.session.abilities.use(ability.id, {
      context: 'investigation',
      witnessed: this.witnessed,
    });
    if (!result.ok) {
      bus.emit('notice', { text: result.reason ?? 'It holds fast.', tone: 'bad' });
      return;
    }
    // Opening it counts as satisfying the bypass from here on.
    this.session.state.setFlag(`unlocked_${this.hotspot.id}`);
    bus.emit('notice', { text: `${this.hotspot.name} gives way.`, tone: 'good' });
    this.applyFirstLook();
    this.refresh();
  }

  private close(): void {
    this.scene.stop();
    this.scene.resume('World');
  }
}
