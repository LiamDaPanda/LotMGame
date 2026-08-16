/**
 * Sequence advancement: 9 → 1, one rung at a time.
 *
 * Rank-ups are never bought with experience points. Each one needs a named set
 * of narrative and mechanical conditions — a case closed, a formula obtained, a
 * potion brewed, and the previous potion digested — and each grants a permanent
 * change to what the player is.
 *
 * The temptation route lets an impatient player skip the digestion requirement.
 * It works. It is also how Beyonders become monsters.
 */

import { bus } from '@/systems/EventBus';
import type { GameState } from '@/systems/GameState';
import type { AdvancementRequirement, SequenceData } from '@/types/schema';

export interface RequirementStatus {
  requirement: AdvancementRequirement;
  met: boolean;
  /** Progress text, e.g. "62 / 100". */
  detail?: string;
}

export interface AdvanceResult {
  ok: boolean;
  reason?: string;
  fromSequence?: number;
  toSequence?: number;
  toTitle?: string;
  narrative?: string;
  forced?: boolean;
  lostControl?: boolean;
  grantedAbilities?: string[];
}

export class Progression {
  constructor(private state: GameState) {}

  /** The tier the player currently occupies. */
  current(): SequenceData | undefined {
    return this.state.sequenceData;
  }

  /** The advancement block describing the next rung, if there is one. */
  next() {
    return this.current()?.advancement;
  }

  /** Status of every requirement for the next rung. */
  requirements(): RequirementStatus[] {
    const advancement = this.next();
    if (!advancement) return [];
    return advancement.requirements.map((requirement) => this.evaluate(requirement));
  }

  private evaluate(requirement: AdvancementRequirement): RequirementStatus {
    const state = this.state;
    switch (requirement.type) {
      case 'case_completed': {
        const met = requirement.caseId ? state.caseState(requirement.caseId) === 'resolved' : false;
        return { requirement, met };
      }
      case 'item': {
        const met = requirement.itemId ? state.hasItem(requirement.itemId) : false;
        return { requirement, met };
      }
      case 'flag': {
        const met = requirement.flag ? state.hasFlag(requirement.flag) : false;
        return { requirement, met };
      }
      case 'digestion': {
        const target = requirement.value ?? 100;
        return {
          requirement,
          met: state.digestion >= target,
          detail: `${state.digestion} / ${target}`,
        };
      }
      case 'trust': {
        const target = requirement.value ?? 0;
        const value = requirement.member ? state.trustWith(requirement.member) : 0;
        return { requirement, met: value >= target, detail: `${value} / ${target}` };
      }
      default:
        return { requirement, met: false };
    }
  }

  /** Every requirement satisfied — the clean route is open. */
  canAdvance(): boolean {
    const statuses = this.requirements();
    return statuses.length > 0 && statuses.every((s) => s.met);
  }

  /**
   * The shortcut is open when everything *except* digestion is in place. You
   * have the formula and the potion; you simply have not made the last one
   * yours yet.
   */
  canForceAdvance(): boolean {
    const statuses = this.requirements();
    if (statuses.length === 0) return false;
    if (statuses.every((s) => s.met)) return false; // clean route already open
    return statuses.every((s) => s.met || s.requirement.type === 'digestion');
  }

  /** Advance a rung. `force` takes the temptation route. */
  advance(force = false): AdvanceResult {
    const from = this.current();
    const advancement = from?.advancement;
    if (!from || !advancement) {
      return { ok: false, reason: 'There is no further rung on this ladder.' };
    }

    if (force) {
      if (!this.canForceAdvance()) {
        return { ok: false, reason: 'Even the reckless route needs the formula and the potion.' };
      }
    } else if (!this.canAdvance()) {
      return { ok: false, reason: 'You are not ready.' };
    }

    const state = this.state;
    const target = state.content.sequence(state.pathwayId, advancement.toSequence);
    if (!target) {
      return { ok: false, reason: 'That Sequence has not been written yet.' };
    }

    // Consume the potion the requirements asked for.
    for (const requirement of advancement.requirements) {
      if (requirement.type === 'item' && requirement.itemId) {
        const item = state.content.item(requirement.itemId);
        if (item?.kind === 'potion') state.removeItem(requirement.itemId);
      }
    }

    let lostControl = false;
    if (force) {
      const temptation = advancement.temptation;
      state.addSanity(-temptation.sanityCost);
      state.addConcealment(-temptation.concealmentCost);
      // Undigested power carries over as a deficit, not a clean slate.
      state.digestion = Math.min(40, state.digestion);
      state.setFlag(`forced_advance_${advancement.toSequence}`);
      lostControl = Math.random() < temptation.lossOfControlChance;
      if (lostControl) {
        state.lossOfControlCount += 1;
        state.addSanity(-12);
        state.addConcealment(-10);
        bus.emit('loss-of-control', {
          reason: 'The potion is still moving in you, and for a moment it moves you.',
        });
      }
    } else {
      state.digestion = 0; // a fresh potion always starts undigested
    }

    const previousSequence = state.sequence;
    state.sequence = advancement.toSequence;

    // Permanent change: new ceilings, and the new tier's abilities are now in
    // knownAbilities() by virtue of the rank alone.
    state.spirituality = target.spiritualityMax;
    state.sanity = Math.min(target.sanityMax, Math.max(state.sanity, Math.round(target.sanityMax * 0.5)));

    state.setFlag(`sequence_${target.sequence}`);
    bus.emit('sequence:changed', { sequence: target.sequence, title: target.title });

    return {
      ok: true,
      fromSequence: previousSequence,
      toSequence: target.sequence,
      toTitle: target.title,
      narrative: target.narrative,
      forced: force,
      lostControl,
      grantedAbilities: target.grantsAbilities,
    };
  }

  /**
   * The acting method: playing your Sequence's role in public digests the
   * potion. Called when the player takes an in-character action — a Seer
   * reading fortunes, a Clown drawing laughter.
   */
  act(amount: number, description: string): void {
    if (this.state.digestion >= 100) return;
    this.state.addDigestion(amount);
    bus.emit('notice', { text: `${description} (digestion ${this.state.digestion}%)`, tone: 'occult' });
  }
}
