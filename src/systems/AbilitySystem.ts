/**
 * Spending Beyonder power.
 *
 * Every ability costs spirituality, most cost a little sanity, and using one
 * where somebody can see you costs concealment. That last cost is the reason
 * the investigation verbs are primary: power is always available and almost
 * always the wrong first move.
 */

import { bus } from '@/systems/EventBus';
import type { GameState } from '@/systems/GameState';
import type { AbilityContext, AbilityData, AbilityEffectKind } from '@/types/schema';

export interface AbilityCheck {
  ok: boolean;
  reason?: string;
}

export interface AbilityUseOptions {
  /** Where the ability is being used — gates on the ability's `usableIn`. */
  context: AbilityContext;
  /**
   * Whether anyone is watching. Unwitnessed use costs a third of the normal
   * concealment, so working alone in a locked room is the safe way to cheat.
   */
  witnessed?: boolean;
}

export interface AbilityUseResult {
  ok: boolean;
  reason?: string;
  ability?: AbilityData;
  spiritSpent?: number;
  sanitySpent?: number;
  concealmentSpent?: number;
}

export class AbilitySystem {
  constructor(private state: GameState) {}

  /** Abilities the player knows, newest tier first, passives last. */
  available(context?: AbilityContext): AbilityData[] {
    const abilities = this.state
      .knownAbilities()
      .map((id) => this.state.content.ability(id))
      .filter((a): a is AbilityData => Boolean(a))
      .filter((a) => !context || a.usableIn.includes(context) || a.usableIn.includes('anywhere'));
    return abilities.sort((a, b) => {
      if (Boolean(a.passive) !== Boolean(b.passive)) return a.passive ? 1 : -1;
      return a.sequence - b.sequence;
    });
  }

  /** Does the player have a usable ability with this effect kind here? */
  withEffect(kind: AbilityEffectKind, context: AbilityContext): AbilityData | undefined {
    return this.available(context).find((a) => a.effect.kind === kind && !a.passive);
  }

  hasPassive(kind: AbilityEffectKind): boolean {
    return this.available().some((a) => a.passive && a.effect.kind === kind);
  }

  canUse(abilityId: string, options: AbilityUseOptions): AbilityCheck {
    const ability = this.state.content.ability(abilityId);
    if (!ability) return { ok: false, reason: 'No such ability' };
    if (!this.state.knowsAbility(abilityId)) return { ok: false, reason: 'You have not grasped that yet' };
    if (ability.passive) return { ok: false, reason: 'That works of its own accord' };
    if (!ability.usableIn.includes(options.context) && !ability.usableIn.includes('anywhere')) {
      return { ok: false, reason: 'Not here' };
    }
    if (this.state.spirituality < ability.spiritCost) {
      return { ok: false, reason: `Not enough spirituality (${ability.spiritCost} needed)` };
    }
    // Refuse the use that would end the run rather than letting it happen by
    // accident; a deliberate collapse should come from the story, not a misclick.
    if (ability.sanityCost > 0 && this.state.sanity <= ability.sanityCost) {
      return { ok: false, reason: 'Your mind will not survive it' };
    }
    return { ok: true };
  }

  concealmentCostOf(ability: AbilityData, witnessed: boolean): number {
    if (ability.exposure <= 0) return 0;
    return witnessed ? ability.exposure : Math.max(1, Math.round(ability.exposure / 3));
  }

  use(abilityId: string, options: AbilityUseOptions): AbilityUseResult {
    const check = this.canUse(abilityId, options);
    if (!check.ok) {
      bus.emit('ability:used', { abilityId, success: false, reason: check.reason });
      return { ok: false, reason: check.reason };
    }

    const ability = this.state.content.ability(abilityId) as AbilityData;
    const concealmentCost = this.concealmentCostOf(ability, options.witnessed ?? false);

    this.state.addSpirituality(-ability.spiritCost);
    if (ability.sanityCost) this.state.addSanity(-ability.sanityCost);
    if (concealmentCost) this.state.addConcealment(-concealmentCost);

    // Working a power is itself part of digesting it.
    this.state.addDigestion(1);

    bus.emit('ability:used', { abilityId, success: true });
    bus.emit('notice', { text: ability.flavour, tone: 'occult' });

    return {
      ok: true,
      ability,
      spiritSpent: ability.spiritCost,
      sanitySpent: ability.sanityCost,
      concealmentSpent: concealmentCost,
    };
  }

  /**
   * Rest restores spirituality and a little sanity, and costs a day. The club's
   * parlour is safer than a rented room — hence the `safe` flag.
   */
  rest(safe: boolean): void {
    const state = this.state;
    state.addSpirituality(Math.round(state.spiritualityMax * (safe ? 0.75 : 0.45)));
    state.addSanity(safe ? 14 : 7);
    // Lying low lets rumours cool.
    state.addConcealment(safe ? 6 : 3);
    state.advanceDay(1);
  }
}
