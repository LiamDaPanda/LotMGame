import Phaser from 'phaser';
import { Session } from '@/systems/Session';
import { format } from '@/systems/Money';
import { MAX_SKILL, SKILLS } from '@/systems/Skills';
import { Button, ScrollList, drawPanel, sectionHeader } from '@/ui/widgets';
import { COLORS, CSS, FONT_BODY, FONT_UI, GAME_HEIGHT, GAME_WIDTH, ICONS } from '@/ui/theme';
import { SKILL_IDS, type ClueData } from '@/types/schema';

type Tab = 'case' | 'board' | 'powers' | 'effects' | 'club';

const TABS: { id: Tab; label: string; icon: number }[] = [
  { id: 'case', label: 'Case', icon: ICONS.document },
  { id: 'board', label: 'Deductions', icon: ICONS.clue },
  { id: 'powers', label: 'Powers', icon: ICONS.spirituality },
  { id: 'effects', label: 'Effects', icon: ICONS.key },
  { id: 'club', label: 'The Club', icon: ICONS.card },
];

/**
 * The notebook: case file, deduction board, powers, possessions, and standing
 * with the Club.
 *
 * The board is the game's central verb. Clues are inert on their own; the
 * player selects a set and asserts they connect, and only a set that matches
 * a deduction exactly becomes a conclusion. Conclusions — never raw clues —
 * are what unlock case resolutions.
 */
export class JournalScene extends Phaser.Scene {
  private session!: Session;
  private tab: Tab = 'case';
  private content!: Phaser.GameObjects.Container;
  private list?: ScrollList;
  private selected = new Set<string>();
  private tabButtons = new Map<Tab, Button>();
  private connectButton?: Button;
  private statusText!: Phaser.GameObjects.Text;

  private readonly panelX = 40;
  private readonly panelY = 30;
  private readonly panelW = GAME_WIDTH - 80;
  private readonly panelH = GAME_HEIGHT - 60;
  private readonly bodyX = 210;

  constructor() {
    super('Journal');
  }

  create(): void {
    this.session = Session.get(this);

    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.85).setOrigin(0, 0).setInteractive();
    drawPanel(this, this.panelX, this.panelY, this.panelW, this.panelH);

    const state = this.session.state;
    sectionHeader(
      this,
      this.panelX + 24,
      this.panelY + 16,
      this.panelW - 48,
      'Case Notes',
      `Sequence ${state.sequence} — ${state.sequenceTitle}  ·  Day ${state.day}  ·  ${format(state.pence)}`,
    );

    TABS.forEach((tab, index) => {
      const button = new Button(
        this,
        this.panelX + 24,
        this.panelY + 84 + index * 44,
        tab.label,
        () => this.setTab(tab.id),
        { width: 152, height: 38, align: 'left', fontSize: 14, iconFrame: tab.icon },
      );
      this.tabButtons.set(tab.id, button);
    });

    new Button(
      this,
      this.panelX + 24,
      this.panelY + this.panelH - 56,
      'Close  (Esc)',
      () => this.close(),
      { width: 152, height: 38, fontSize: 13 },
    );

    this.statusText = this.add
      .text(this.panelX + this.bodyX, this.panelY + this.panelH - 40, '', {
        fontFamily: FONT_UI,
        fontSize: '12px',
        color: CSS.muted,
        wordWrap: { width: this.panelW - this.bodyX - 40 },
      })
      .setOrigin(0, 0);

    this.content = this.add.container(0, 0);
    this.input.keyboard?.on('keydown-ESC', () => this.close());
    this.input.keyboard?.on('keydown-J', () => this.close());

    this.setTab(this.session.cases.activeCase() ? 'case' : 'powers');
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    for (const [id, button] of this.tabButtons) button.setEnabled(id !== tab);
    this.render();
  }

  private clearBody(): void {
    this.content.removeAll(true);
    this.list?.destroy();
    this.list = undefined;
    this.connectButton?.destroy();
    this.connectButton = undefined;
    this.statusText.setText('');
  }

  private bodyBounds() {
    return {
      x: this.panelX + this.bodyX,
      y: this.panelY + 84,
      width: this.panelW - this.bodyX - 40,
      height: this.panelH - 150,
    };
  }

  private render(): void {
    this.clearBody();
    switch (this.tab) {
      case 'case':
        this.renderCase();
        break;
      case 'board':
        this.renderBoard();
        break;
      case 'powers':
        this.renderPowers();
        break;
      case 'effects':
        this.renderEffects();
        break;
      case 'club':
        this.renderClub();
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Case tab
  // -------------------------------------------------------------------------

  private renderCase(): void {
    const bounds = this.bodyBounds();
    const caseData = this.session.cases.activeCase();

    if (!caseData) {
      this.content.add(
        this.add.text(bounds.x, bounds.y, 'No case is open.\n\nThe Club keeps a board of work in the parlour.', {
          fontFamily: FONT_BODY,
          fontSize: '15px',
          color: CSS.muted,
          lineSpacing: 6,
        }),
      );
      return;
    }

    this.content.add(
      this.add.text(bounds.x, bounds.y, caseData.title, {
        fontFamily: FONT_BODY,
        fontSize: '20px',
        color: CSS.brass,
      }),
    );
    this.content.add(
      this.add.text(bounds.x, bounds.y + 28, `Client: ${caseData.client}   ·   Fee: ${format(caseData.rewardPence)}`, {
        fontFamily: FONT_UI,
        fontSize: '12px',
        color: CSS.muted,
      }),
    );

    const rows: Phaser.GameObjects.Container[] = [];
    rows.push(this.paragraphRow(caseData.briefing, bounds.width));

    const objectives = this.session.cases.objectiveStatus();
    rows.push(this.headingRow('Objectives', bounds.width));
    for (const { objective, done } of objectives) {
      rows.push(
        this.bulletRow(
          `${done ? '✓' : '·'}  ${objective.text}${objective.optional ? '  (optional)' : ''}`,
          bounds.width,
          done ? CSS.good : CSS.parchment,
        ),
      );
    }

    const options = this.session.cases.resolutionOptions();
    const unlocked = options.filter((o) => o.unlocked);
    rows.push(this.headingRow('Findings', bounds.width));
    if (unlocked.length === 0) {
      rows.push(
        this.bulletRow('You have nothing you could put before a magistrate yet.', bounds.width, CSS.muted),
      );
    } else {
      rows.push(
        this.bulletRow(
          `${unlocked.length} conclusion${unlocked.length === 1 ? '' : 's'} you could act on.`,
          bounds.width,
          CSS.good,
        ),
      );
      const button = new Button(
        this,
        0,
        0,
        'Present your findings',
        () => this.openResolve(),
        { width: 240, height: 40, tone: 'good', fontSize: 14 },
      );
      const wrapper = this.add.container(0, 0);
      wrapper.setSize(bounds.width, 46);
      wrapper.add(button);
      rows.push(wrapper);
    }

    this.list = new ScrollList(this, bounds.x, bounds.y + 54, {
      width: bounds.width,
      height: bounds.height - 54,
      gap: 6,
    });
    this.list.setRows(rows);
    this.list.refreshMask();
  }

  private openResolve(): void {
    this.scene.launch('Resolve');
    this.scene.stop();
  }

  // -------------------------------------------------------------------------
  // Deduction board
  // -------------------------------------------------------------------------

  private renderBoard(): void {
    const bounds = this.bodyBounds();
    const clues = this.session.cases.discoveredClues();
    const deductions = this.session.cases.formedDeductions();

    this.content.add(
      this.add.text(bounds.x, bounds.y, 'Deduction Board', {
        fontFamily: FONT_BODY,
        fontSize: '20px',
        color: CSS.brass,
      }),
    );
    this.content.add(
      this.add.text(bounds.x, bounds.y + 28, 'Select the facts that belong together, then connect them.', {
        fontFamily: FONT_UI,
        fontSize: '12px',
        color: CSS.muted,
      }),
    );

    const rows: Phaser.GameObjects.Container[] = [];

    if (deductions.length > 0) {
      rows.push(this.headingRow('Concluded', bounds.width));
      for (const deduction of deductions) {
        rows.push(this.conclusionRow(deduction.title, deduction.text, bounds.width));
      }
    }

    rows.push(this.headingRow(`Facts (${clues.length})`, bounds.width));
    if (clues.length === 0) {
      rows.push(this.bulletRow('You have learned nothing worth writing down.', bounds.width, CSS.muted));
    }
    for (const clue of clues) rows.push(this.clueCard(clue, bounds.width));

    this.list = new ScrollList(this, bounds.x, bounds.y + 54, {
      width: bounds.width,
      height: bounds.height - 104,
      gap: 6,
    });
    this.list.setRows(rows);
    this.list.refreshMask();

    this.connectButton = new Button(
      this,
      bounds.x,
      bounds.y + bounds.height - 42,
      'Connect',
      () => this.tryConnect(),
      { width: 160, height: 38, tone: 'good', fontSize: 14, enabled: false },
    );
    this.updateConnectState();
  }

  private updateConnectState(): void {
    const count = this.selected.size;
    this.connectButton?.setEnabled(count >= 2);
    this.connectButton?.setLabel(count >= 2 ? `Connect ${count} facts` : 'Connect');
    if (count > 0 && count < 2) {
      this.statusText.setText('Select at least one more fact.');
    } else if (count === 0) {
      this.statusText.setText('');
    }
  }

  private tryConnect(): void {
    const result = this.session.cases.deduce([...this.selected]);
    if (!result.ok) {
      this.statusText.setText(result.reason ?? 'Nothing follows from that.');
      this.cameras.main.shake(180, 0.004);
      return;
    }
    if (result.duplicate) {
      this.statusText.setText('You have already drawn that conclusion.');
      return;
    }
    this.statusText.setText(`Concluded: ${result.deduction?.title ?? ''}`);
    this.selected.clear();
    this.cameras.main.flash(220, 90, 80, 40);
    this.render();
  }

  /** A selectable fact card. Selection is local to the board, not game state. */
  private clueCard(clue: ClueData, width: number): Phaser.GameObjects.Container {
    const height = 62;
    const container = this.add.container(0, 0);
    container.setSize(width, height);

    const bg = this.add.graphics();
    const draw = () => {
      const chosen = this.selected.has(clue.id);
      bg.clear();
      bg.fillStyle(chosen ? COLORS.panelLight : COLORS.panel, 0.95);
      bg.fillRoundedRect(0, 0, width, height, 5);
      bg.lineStyle(chosen ? 2 : 1, chosen ? COLORS.brass : COLORS.brassDim, chosen ? 1 : 0.5);
      bg.strokeRoundedRect(0, 0, width, height, 5);
    };
    draw();
    container.add(bg);

    const categoryIcon = {
      scene: ICONS.clue,
      testimony: ICONS.trust,
      document: ICONS.document,
      occult: ICONS.spirituality,
    }[clue.category];
    container.add(this.add.image(20, height / 2, 'icons', categoryIcon).setScale(1.2));

    container.add(
      this.add.text(40, 10, clue.title, { fontFamily: FONT_UI, fontSize: '13px', color: CSS.parchment }),
    );
    container.add(
      this.add.text(40, 30, clue.text, {
        fontFamily: FONT_BODY,
        fontSize: '12px',
        color: CSS.muted,
        wordWrap: { width: width - 60 },
      }),
    );

    container.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, width, height),
      Phaser.Geom.Rectangle.Contains,
    );
    let downAt = { x: 0, y: 0 };
    container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      downAt = { x: pointer.x, y: pointer.y };
    });
    container.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      // Do not toggle when the gesture was a scroll.
      if (Phaser.Math.Distance.Between(downAt.x, downAt.y, pointer.x, pointer.y) > 8) return;
      if (this.selected.has(clue.id)) this.selected.delete(clue.id);
      else this.selected.add(clue.id);
      draw();
      this.updateConnectState();
    });

    return container;
  }

  private conclusionRow(title: string, text: string, width: number): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);
    const height = 56;
    container.setSize(width, height);
    const bg = this.add.graphics();
    bg.fillStyle(COLORS.panelLight, 0.5);
    bg.fillRoundedRect(0, 0, width, height, 4);
    bg.lineStyle(1, COLORS.good, 0.5);
    bg.strokeRoundedRect(0, 0, width, height, 4);
    container.add(bg);
    container.add(this.add.text(12, 8, title, { fontFamily: FONT_UI, fontSize: '13px', color: CSS.good }));
    container.add(
      this.add.text(12, 26, text, {
        fontFamily: FONT_BODY,
        fontSize: '12px',
        color: CSS.muted,
        wordWrap: { width: width - 24 },
      }),
    );
    return container;
  }

  // -------------------------------------------------------------------------
  // Powers tab
  // -------------------------------------------------------------------------

  private renderPowers(): void {
    const bounds = this.bodyBounds();
    const state = this.session.state;
    const pathway = this.session.content.pathway(state.pathwayId);

    this.content.add(
      this.add.text(bounds.x, bounds.y, `${pathway.name} Pathway`, {
        fontFamily: FONT_BODY,
        fontSize: '20px',
        color: CSS.brass,
      }),
    );
    this.content.add(
      this.add.text(bounds.x, bounds.y + 28, pathway.epithet, {
        fontFamily: FONT_UI,
        fontSize: '12px',
        color: CSS.occult,
      }),
    );

    const rows: Phaser.GameObjects.Container[] = [];
    rows.push(this.paragraphRow(state.sequenceData?.description ?? '', bounds.width));

    // Skills live beside powers: both are "what you can do", and seeing the
    // trained numbers next to the occult ones keeps training feeling relevant.
    rows.push(this.headingRow('Trained skills', bounds.width));
    for (const id of SKILL_IDS) {
      const info = SKILLS[id];
      const level = state.skill(id);
      rows.push(
        this.conclusionRow(
          `${info.name}   ${'●'.repeat(level)}${'○'.repeat(MAX_SKILL - level)}   ${level}/${MAX_SKILL}`,
          `${info.summary}\n${info.benefit}`,
          bounds.width,
        ),
      );
    }

    rows.push(this.headingRow('Powers', bounds.width));
    for (const ability of this.session.abilities.available()) {
      const bits = [`${ability.spiritCost} spirit`];
      if (ability.sanityCost) bits.push(`${ability.sanityCost} sanity`);
      if (ability.exposure) bits.push(`${ability.exposure} exposure`);
      rows.push(
        this.conclusionRow(
          `${ability.name}${ability.passive ? '  (passive)' : ''}  —  Sequence ${ability.sequence}`,
          `${ability.summary}\n${ability.passive ? 'Always in effect.' : bits.join(' · ')}`,
          bounds.width,
        ),
      );
    }

    // What the next rung would grant, so advancement has a visible target.
    const advancement = this.session.progression.next();
    if (advancement) {
      rows.push(this.headingRow(`Next: Sequence ${advancement.toSequence} — ${advancement.toTitle}`, bounds.width));
      for (const status of this.session.progression.requirements()) {
        rows.push(
          this.bulletRow(
            `${status.met ? '✓' : '·'}  ${status.requirement.label}${status.detail ? `  (${status.detail})` : ''}`,
            bounds.width,
            status.met ? CSS.good : CSS.muted,
          ),
        );
      }
    }

    this.list = new ScrollList(this, bounds.x, bounds.y + 54, {
      width: bounds.width,
      height: bounds.height - 54,
      gap: 6,
    });
    this.list.setRows(rows);
    this.list.refreshMask();
  }

  // -------------------------------------------------------------------------
  // Effects & club tabs
  // -------------------------------------------------------------------------

  private renderEffects(): void {
    const bounds = this.bodyBounds();
    const state = this.session.state;

    this.content.add(
      this.add.text(bounds.x, bounds.y, 'Effects', {
        fontFamily: FONT_BODY,
        fontSize: '20px',
        color: CSS.brass,
      }),
    );
    this.content.add(
      this.add.text(bounds.x, bounds.y + 28, `Purse: ${format(state.pence)}`, {
        fontFamily: FONT_UI,
        fontSize: '12px',
        color: CSS.muted,
      }),
    );

    const rows: Phaser.GameObjects.Container[] = [];
    if (state.inventory.size === 0) {
      rows.push(this.bulletRow('Your pockets hold lint and a tram ticket.', bounds.width, CSS.muted));
    }
    for (const [itemId, count] of state.inventory) {
      const item = this.session.content.item(itemId);
      if (!item) continue;
      rows.push(
        this.conclusionRow(
          `${item.name}${count > 1 ? ` ×${count}` : ''}`,
          `${item.description}${item.sellPence ? `\nThe Club would pay ${format(item.sellPence)}.` : ''}`,
          bounds.width,
        ),
      );
    }

    this.list = new ScrollList(this, bounds.x, bounds.y + 54, {
      width: bounds.width,
      height: bounds.height - 54,
      gap: 6,
    });
    this.list.setRows(rows);
    this.list.refreshMask();
  }

  private renderClub(): void {
    const bounds = this.bodyBounds();
    this.content.add(
      this.add.text(bounds.x, bounds.y, 'The Tarot Club', {
        fontFamily: FONT_BODY,
        fontSize: '20px',
        color: CSS.brass,
      }),
    );
    this.content.add(
      this.add.text(bounds.x, bounds.y + 28, 'Names are not used. Cards are.', {
        fontFamily: FONT_UI,
        fontSize: '12px',
        color: CSS.muted,
      }),
    );

    const rows: Phaser.GameObjects.Container[] = [];
    for (const member of this.session.content.clubMembers()) {
      const trust = this.session.state.trustWith(member.id);
      const mood =
        trust >= 60 ? 'trusts you' : trust >= 30 ? 'is warming to you' : trust >= 0 ? 'is civil' : 'is wary of you';
      rows.push(
        this.conclusionRow(`${member.title} — ${member.name}`, `${member.bio}\nTrust ${trust} · ${mood}`, bounds.width),
      );
    }

    this.list = new ScrollList(this, bounds.x, bounds.y + 54, {
      width: bounds.width,
      height: bounds.height - 54,
      gap: 6,
    });
    this.list.setRows(rows);
    this.list.refreshMask();
  }

  // -------------------------------------------------------------------------
  // Row helpers
  // -------------------------------------------------------------------------

  private headingRow(text: string, width: number): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);
    container.setSize(width, 26);
    container.add(
      this.add.text(0, 6, text.toUpperCase(), {
        fontFamily: FONT_UI,
        fontSize: '11px',
        color: CSS.brass,
      }),
    );
    const rule = this.add.graphics();
    rule.lineStyle(1, COLORS.brassDim, 0.4);
    rule.lineBetween(0, 24, width, 24);
    container.add(rule);
    return container;
  }

  private bulletRow(text: string, width: number, color: string): Phaser.GameObjects.Container {
    const label = this.add.text(0, 0, text, {
      fontFamily: FONT_BODY,
      fontSize: '13px',
      color,
      wordWrap: { width },
    });
    const container = this.add.container(0, 0);
    container.setSize(width, label.height + 6);
    container.add(label);
    return container;
  }

  private paragraphRow(text: string, width: number): Phaser.GameObjects.Container {
    const label = this.add.text(0, 0, text, {
      fontFamily: FONT_BODY,
      fontSize: '13px',
      color: CSS.parchment,
      lineSpacing: 5,
      wordWrap: { width },
    });
    const container = this.add.container(0, 0);
    container.setSize(width, label.height + 8);
    container.add(label);
    return container;
  }

  private close(): void {
    this.scene.stop();
    if (this.scene.isPaused('World')) this.scene.resume('World');
  }
}
