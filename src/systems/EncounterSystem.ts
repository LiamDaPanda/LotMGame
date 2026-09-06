/**
 * Random encounters.
 *
 * The street is not a corridor between objectives. Arriving somewhere can put a
 * person in front of you: a thug, a Church watcher who is not reading his paper,
 * a fence with something to sell, a drunk with a rumour.
 *
 * Weighting is the design: encounters marked `suspicionWeighted` get more likely
 * the more concealment you have burned. Use power in public often enough and the
 * city starts noticing you back — which turns the concealment meter from a number
 * into a thing that happens to you.
 */

import { bus } from '@/systems/EventBus';
import type { AbilitySystem } from '@/systems/AbilitySystem';
import type { GameState } from '@/systems/GameState';
import { chanceOf, rollCheck } from '@/systems/Skills';
import type { EncounterData, EncounterOption, EncounterOutcome } from '@/types/schema';

export interface PresentedOption {
  index: number;
  text: string;
  enabled: boolean;
  reason?: string;
  /** Odds shown up front; undefined when the option cannot fail. */
  chance?: number;
  costPence?: number;
  abilityId?: string;
}

export interface OptionResult {
  passed: boolean;
  outcome: EncounterOutcome;
  chance?: number;
}

export class EncounterSystem {
  constructor(
    private state: GameState,
    private abilities: AbilitySystem,
  ) {}

  /** Encounters that could fire in this map right now. */
  eligible(mapId: string): EncounterData[] {
    return [...this.state.content.encounters.values()].filter((encounter) => {
      if (encounter.maps && !encounter.maps.includes(mapId)) return false;
      if (encounter.once && this.state.seenEncounters.has(encounter.id)) return false;
      return this.state.check(encounter.requires);
    });
  }

  /**
   * Roll for an encounter on arrival. Returns the chosen encounter, or
   * undefined when the street minds its own business.
   */
  roll(mapId: string, chance: number): EncounterData | undefined {
    if (chance <= 0) return undefined;
    if (Math.random() >= chance) return undefined;

    const candidates = this.eligible(mapId);
    if (candidates.length === 0) return undefined;

    // Suspicion scales the dangerous ones from "rare" up to "double weight".
    const exposure = this.state.suspicion / 100;
    const weights = candidates.map((encounter) =>
      Math.max(0.01, encounter.weight * (encounter.suspicionWeighted ? 0.25 + exposure * 1.75 : 1)),
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);

    let target = Math.random() * total;
    for (let i = 0; i < candidates.length; i++) {
      target -= weights[i] as number;
      if (target <= 0) return this.begin(candidates[i] as EncounterData);
    }
    return this.begin(candidates[candidates.length - 1] as EncounterData);
  }

  /** Force a specific encounter — used by story beats and by the playtest. */
  begin(encounter: EncounterData): EncounterData {
    if (encounter.once) this.state.seenEncounters.add(encounter.id);
    bus.emit('encounter:started', { encounterId: encounter.id });
    return encounter;
  }

  /** Options with their gates resolved and their odds computed. */
  present(encounter: EncounterData): PresentedOption[] {
    const presented: PresentedOption[] = [];
    encounter.options.forEach((option, index) => {
      const gate = this.gate(option);
      if (!gate.enabled && option.hideIfLocked) return;
      presented.push({
        index,
        text: option.text,
        enabled: gate.enabled,
        reason: gate.reason,
        chance: option.check ? chanceOf(option.check, this.state.skill(option.check.skill)) : undefined,
        costPence: option.costPence,
        abilityId: this.abilityFor(option),
      });
    });
    return presented;
  }

  private gate(option: EncounterOption): { enabled: boolean; reason?: string } {
    if (option.requires && !this.state.check(option.requires)) {
      return { enabled: false, reason: this.state.explain(option.requires) };
    }
    if (option.costPence !== undefined && !this.state.canAfford(option.costPence)) {
      return { enabled: false, reason: 'You cannot afford it' };
    }
    const abilityId = this.abilityFor(option);
    if (abilityId) {
      const check = this.abilities.canUse(abilityId, { context: 'encounter' });
      if (!check.ok) return { enabled: false, reason: check.reason };
    } else if (option.useAbilityEffect) {
      return { enabled: false, reason: 'Your pathway offers nothing that would do this' };
    }
    return { enabled: true };
  }

  /** See DialogueSystem.abilityFor — same idea, in an encounter's context. */
  private abilityFor(option: EncounterOption): string | undefined {
    if (option.useAbility) return option.useAbility;
    if (!option.useAbilityEffect) return undefined;
    return this.abilities.withEffect(option.useAbilityEffect, 'encounter')?.id;
  }

  /** Take an option: pay for it, roll if it can fail, apply the outcome. */
  choose(encounter: EncounterData, index: number): OptionResult | undefined {
    const option = encounter.options[index];
    if (!option) return undefined;
    if (!this.gate(option).enabled) return undefined;

    const abilityId = this.abilityFor(option);
    if (abilityId) {
      // An encounter is by definition somebody looking at you.
      const used = this.abilities.use(abilityId, { context: 'encounter', witnessed: true });
      if (!used.ok) return undefined;
    }
    if (option.costPence && !this.state.spend(option.costPence)) return undefined;

    if (!option.check) {
      this.state.apply(option.success.effect);
      return { passed: true, outcome: option.success };
    }

    const { passed, chance } = rollCheck(option.check, this.state.skill(option.check.skill));
    const outcome = passed ? option.success : (option.failure ?? option.success);
    this.state.apply(outcome.effect);
    return { passed, outcome, chance };
  }
}
