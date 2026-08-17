/**
 * Legwork — the third way to learn something.
 *
 * A clue can be found by searching a room, extracted from a person in
 * conversation, or *bought*: with money, with days off the calendar, and with a
 * trained skill. That last route is what stops training and the purse from being
 * purely about advancement, and it gives a stuck player something to do that
 * isn't wandering the map clicking on furniture.
 *
 * Leads are declared per case, so a new case brings its own legwork.
 */

import { bus } from '@/systems/EventBus';
import type { CaseSystem } from '@/systems/CaseSystem';
import type { GameState } from '@/systems/GameState';
import { bribeDiscount, chanceOf, rollCheck } from '@/systems/Skills';
import type { LeadData } from '@/types/schema';

export interface PresentedLead {
  lead: LeadData;
  enabled: boolean;
  reason?: string;
  /** Cost after Rhetoric haggling. */
  costPence: number;
  chance?: number;
  spent: boolean;
}

export interface LeadResult {
  ok: boolean;
  reason?: string;
  passed?: boolean;
  chance?: number;
  text?: string;
  cluesFound?: string[];
}

/** Framing shown above each method's leads. */
export const METHOD_LABEL = {
  ask_around: 'Ask around',
  informant: 'Pay an informant',
  stakeout: 'Keep watch',
  archives: 'Search the records',
} as const;

export class InquirySystem {
  constructor(
    private state: GameState,
    private cases: CaseSystem,
  ) {}

  /** Money actually asked for, after Rhetoric. */
  costOf(lead: LeadData): number {
    if (!lead.costPence) return 0;
    // Paying for information is haggling, so rhetoric moves the price.
    return Math.max(0, Math.round(lead.costPence * bribeDiscount(this.state.skill('rhetoric'))));
  }

  available(): PresentedLead[] {
    const caseData = this.cases.activeCase();
    if (!caseData?.leads) return [];

    return caseData.leads.map((lead) => {
      const spent = this.state.spentLeads.has(lead.id);
      const costPence = this.costOf(lead);
      const chance = lead.check ? chanceOf(lead.check, this.state.skill(lead.check.skill)) : undefined;

      let enabled = true;
      let reason: string | undefined;
      if (spent) {
        enabled = false;
        reason = 'Already followed as far as it goes';
      } else if (!this.state.check(lead.requires)) {
        enabled = false;
        reason = this.state.explain(lead.requires);
      } else if (!this.state.canAfford(costPence)) {
        enabled = false;
        reason = 'You cannot afford it';
      }

      return { lead, enabled, reason, costPence, chance, spent };
    });
  }

  /** Follow a lead. Time and money are spent whether or not it pays off. */
  follow(leadId: string): LeadResult {
    const entry = this.available().find((option) => option.lead.id === leadId);
    if (!entry) return { ok: false, reason: 'No such lead.' };
    if (!entry.enabled) return { ok: false, reason: entry.reason ?? 'Not available.' };

    const { lead, costPence } = entry;
    if (costPence > 0 && !this.state.spend(costPence)) {
      return { ok: false, reason: 'You cannot afford it.' };
    }

    const roll = lead.check
      ? rollCheck(lead.check, this.state.skill(lead.check.skill))
      : { passed: true, chance: 1 };

    const cluesFound: string[] = [];
    if (roll.passed) {
      for (const clueId of lead.grants ?? []) {
        if (this.cases.grantClue(clueId)) cluesFound.push(clueId);
      }
      this.state.apply(lead.successEffect);
      if (lead.once !== false) this.state.spentLeads.add(lead.id);
    } else {
      this.state.apply(lead.failureEffect);
    }

    // Days pass either way — a wasted night is still a night.
    if (lead.days) this.state.advanceDay(lead.days);

    bus.emit('notice', {
      text: roll.passed ? 'The legwork pays.' : 'Nothing comes of it.',
      tone: roll.passed ? 'good' : 'bad',
    });

    return {
      ok: true,
      passed: roll.passed,
      chance: roll.chance,
      text: roll.passed ? lead.successText : lead.failureText,
      cluesFound,
    };
  }
}
