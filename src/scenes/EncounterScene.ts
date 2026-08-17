import Phaser from 'phaser';
import { Session } from '@/systems/Session';
import { format } from '@/systems/Money';
import { SKILLS } from '@/systems/Skills';
import { Button, Typewriter, drawPanel, sectionHeader } from '@/ui/widgets';
import { COLORS, CSS, FONT_BODY, FONT_UI, GAME_HEIGHT, GAME_WIDTH } from '@/ui/theme';
import type { EncounterData } from '@/types/schema';

interface EncounterSceneData {
  encounterId: string;
}

const KIND_TONE = {
  threat: CSS.bad,
  opportunity: CSS.good,
  occult: CSS.occult,
  street: CSS.parchment,
} as const;

/**
 * Something happens to you on the way somewhere.
 *
 * Every option shows what it costs and — when it can fail — the exact odds.
 * A hidden roll in an investigation game reads as the game cheating, and the
 * whole point of training a skill is watching that number move.
 */
export class EncounterScene extends Phaser.Scene {
  private session!: Session;
  private encounter!: EncounterData;
  private buttons: Button[] = [];
  private bodyText!: Phaser.GameObjects.Text;
  private typewriter!: Typewriter;
  private resolved = false;

  private readonly x = 100;
  private readonly y = 50;
  private readonly w = GAME_WIDTH - 200;
  private readonly h = GAME_HEIGHT - 100;

  constructor() {
    super('Encounter');
  }

  create(data: EncounterSceneData): void {
    this.session = Session.get(this);
    const encounter = this.session.content.encounter(data.encounterId);
    if (!encounter) {
      this.close();
      return;
    }
    this.encounter = encounter;

    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.9).setOrigin(0, 0).setInteractive();
    drawPanel(this, this.x, this.y, this.w, this.h, {
      border: encounter.kind === 'threat' ? COLORS.bad : COLORS.brassDim,
    });

    sectionHeader(this, this.x + 24, this.y + 16, this.w - 48, encounter.title);
    this.add
      .text(this.x + this.w - 24, this.y + 26, encounter.kind.toUpperCase(), {
        fontFamily: FONT_UI,
        fontSize: '11px',
        color: KIND_TONE[encounter.kind],
      })
      .setOrigin(1, 0);

    this.bodyText = this.add.text(this.x + 24, this.y + 68, '', {
      fontFamily: FONT_BODY,
      fontSize: '15px',
      color: CSS.parchment,
      lineSpacing: 6,
      wordWrap: { width: this.w - 48 },
    });
    this.typewriter = new Typewriter(this, this.bodyText, 2, 12);

    if (encounter.kind === 'threat') this.cameras.main.shake(220, 0.004);

    this.typewriter.play(encounter.text, () => this.renderOptions());
    this.input.on('pointerdown', () => {
      if (this.typewriter.running) {
        this.typewriter.finish();
        this.renderOptions();
      }
    });
  }

  private renderOptions(): void {
    if (this.buttons.length > 0 || this.resolved) return;

    const options = this.session.encounters.present(this.encounter);
    const height = 46;
    const gap = 6;
    let y = this.y + this.h - 24 - options.length * (height + gap);

    for (const option of options) {
      const bits: string[] = [];
      if (option.costPence) bits.push(format(option.costPence));
      if (option.abilityId) {
        bits.push(this.session.content.ability(option.abilityId)?.name ?? option.abilityId);
      }
      if (option.chance !== undefined) {
        const check = this.encounter.options[option.index]?.check;
        const skillName = check ? SKILLS[check.skill].name : 'chance';
        bits.push(`${Math.round(option.chance * 100)}% — ${skillName}`);
      }
      if (!option.enabled && option.reason) bits.push(option.reason);

      this.buttons.push(
        new Button(this, this.x + 24, y, option.text, () => this.choose(option.index), {
          width: this.w - 48,
          height,
          align: 'left',
          fontSize: 14,
          enabled: option.enabled,
          tone: option.abilityId ? 'occult' : option.costPence ? 'good' : 'default',
          subtitle: bits.join('   ·   ') || undefined,
        }),
      );
      y += height + gap;
    }
  }

  private choose(index: number): void {
    const result = this.session.encounters.choose(this.encounter, index);
    if (!result) return;

    this.resolved = true;
    for (const button of this.buttons) button.destroy();
    this.buttons = [];

    const heading =
      result.chance === undefined ? '' : result.passed ? 'It works.\n\n' : 'It does not work.\n\n';
    this.bodyText.setColor(result.passed ? CSS.parchment : CSS.bad);
    this.typewriter.play(heading + result.outcome.text);

    const fled = result.outcome.flee === true;
    new Button(
      this,
      this.x + this.w / 2 - 100,
      this.y + this.h - 62,
      fled ? 'Get off the street' : 'Move on',
      () => this.close(fled),
      { width: 200, height: 42, tone: result.passed ? 'good' : 'bad' },
    );
  }

  /** `fled` sends the player back to the Club rather than into the map. */
  private close(fled = false): void {
    this.typewriter?.stop();
    this.scene.stop();
    if (fled) {
      this.scene.stop('World');
      this.scene.start('World', { mapId: 'club_hub' });
      return;
    }
    if (this.scene.isPaused('World')) this.scene.resume('World');
  }
}
