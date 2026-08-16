/**
 * Case lifecycle: offered → accepted → investigated → resolved.
 *
 * The deduction board is the heart of it. Clues alone prove nothing; the player
 * selects a set of clues and asserts they connect. A matching set becomes a
 * deduction, and it is deductions — not clues — that unlock resolutions. That
 * keeps the solve in the player's head rather than in an inventory check.
 */

import { bus } from '@/systems/EventBus';
import type { GameState } from '@/systems/GameState';
import type {
  CaseData,
  ClueData,
  DeductionData,
  ObjectiveData,
  ResolutionData,
  ResolutionGrade,
} from '@/types/schema';

/** Share of the base reward paid out for each quality of outcome. */
const GRADE_MULTIPLIER: Record<ResolutionGrade, number> = {
  clean: 1,
  messy: 0.75,
  partial: 0.5,
  failed: 0,
};

export interface DeduceResult {
  ok: boolean;
  deduction?: DeductionData;
  /** Set when the clues do connect but the player already knew it. */
  duplicate?: boolean;
  reason?: string;
}

export interface ResolveResult {
  ok: boolean;
  reason?: string;
  resolution?: ResolutionData;
  grade?: ResolutionGrade;
  basePence?: number;
  bonusPence?: number;
  totalPence?: number;
}

export class CaseSystem {
  constructor(private state: GameState) {}

  // -------------------------------------------------------------------------
  // Availability & acceptance
  // -------------------------------------------------------------------------

  /**
   * Re-evaluate which cases the club can offer. Called when entering the hub
   * so newly-unlocked cases appear on the board.
   */
  refreshAvailability(): void {
    for (const caseData of this.state.content.cases.values()) {
      const progress = this.state.caseProgress(caseData.id);
      if (progress.state !== 'unavailable') continue;
      if (this.state.check(caseData.requires)) {
        this.state.setCaseState(caseData.id, 'available');
      }
    }
  }

  availableCases(): CaseData[] {
    return [...this.state.content.cases.values()].filter(
      (c) => this.state.caseState(c.id) === 'available',
    );
  }

  activeCase(): CaseData | undefined {
    const id = this.state.activeCaseId();
    return id ? this.state.content.case(id) : undefined;
  }

  accept(caseId: string): boolean {
    const caseData = this.state.content.case(caseId);
    if (!caseData) return false;
    if (this.state.caseState(caseId) !== 'available') return false;
    if (this.state.activeCaseId()) return false; // one case at a time
    this.state.setCaseState(caseId, 'active');
    bus.emit('notice', { text: `Case accepted: ${caseData.title}`, tone: 'info' });
    this.refreshObjectives();
    return true;
  }

  // -------------------------------------------------------------------------
  // Objectives
  // -------------------------------------------------------------------------

  /** Mark any objective whose condition now holds. */
  refreshObjectives(): void {
    const caseData = this.activeCase();
    if (!caseData) return;
    const progress = this.state.caseProgress(caseData.id);
    for (const objective of caseData.objectives) {
      if (progress.completedObjectives.includes(objective.id)) continue;
      if (!this.state.check(objective.completeWhen)) continue;
      progress.completedObjectives.push(objective.id);
      bus.emit('objective:completed', { caseId: caseData.id, objectiveId: objective.id });
      bus.emit('notice', { text: `Objective: ${objective.text}`, tone: 'good' });
    }
  }

  objectiveStatus(): { objective: ObjectiveData; done: boolean }[] {
    const caseData = this.activeCase();
    if (!caseData) return [];
    const progress = this.state.caseProgress(caseData.id);
    return caseData.objectives.map((objective) => ({
      objective,
      done: progress.completedObjectives.includes(objective.id),
    }));
  }

  // -------------------------------------------------------------------------
  // Clues & deductions
  // -------------------------------------------------------------------------

  /** Clue definitions the player has actually discovered, for the board. */
  discoveredClues(): ClueData[] {
    const caseData = this.activeCase();
    if (!caseData) return [];
    return caseData.clues.filter((clue) => this.state.hasClue(clue.id));
  }

  formedDeductions(): DeductionData[] {
    const caseData = this.activeCase();
    if (!caseData) return [];
    return caseData.deductions.filter((deduction) => this.state.hasDeduction(deduction.id));
  }

  /** Grant a clue and run any follow-on bookkeeping. */
  grantClue(clueId: string): boolean {
    const isNew = this.state.addClue(clueId);
    if (isNew) {
      const caseData = this.activeCase();
      const clue = caseData?.clues.find((c) => c.id === clueId);
      bus.emit('notice', { text: `Clue: ${clue?.title ?? clueId}`, tone: 'good' });
      this.refreshObjectives();
    }
    return isNew;
  }

  /**
   * Assert that a set of clues connects. Order does not matter, but the set
   * must match a deduction's requirements exactly — a superset is not a
   * conclusion, it is a pile of paper.
   */
  deduce(clueIds: string[]): DeduceResult {
    const caseData = this.activeCase();
    if (!caseData) return { ok: false, reason: 'No case is open.' };
    if (clueIds.length < 2) return { ok: false, reason: 'Connect at least two facts.' };

    // The board can only offer discovered clues, but nothing else guarantees
    // that — so the rule lives here rather than in the UI.
    const undiscovered = clueIds.filter((id) => !this.state.hasClue(id));
    if (undiscovered.length > 0) {
      return { ok: false, reason: 'You cannot connect a fact you have not found.' };
    }

    const selected = [...new Set(clueIds)].sort();
    const match = caseData.deductions.find((deduction) => {
      const required = [...new Set(deduction.requires)].sort();
      return (
        required.length === selected.length && required.every((id, index) => id === selected[index])
      );
    });

    if (!match) return { ok: false, reason: 'These do not add up to anything.' };
    if (this.state.hasDeduction(match.id)) {
      return { ok: true, deduction: match, duplicate: true };
    }

    this.state.addDeduction(match.id);
    this.state.apply(match.effect);
    for (const clueId of match.unlocksClues ?? []) this.grantClue(clueId);
    bus.emit('notice', { text: `Deduction: ${match.title}`, tone: 'good' });
    this.refreshObjectives();
    return { ok: true, deduction: match };
  }

  // -------------------------------------------------------------------------
  // Resolution
  // -------------------------------------------------------------------------

  /** Every resolution, with whether it is currently selectable and why not. */
  resolutionOptions(): { resolution: ResolutionData; unlocked: boolean; reason?: string }[] {
    const caseData = this.activeCase();
    if (!caseData) return [];
    return caseData.resolutions.map((resolution) => {
      const missing = (resolution.requiresDeductions ?? []).filter(
        (id) => !this.state.hasDeduction(id),
      );
      if (missing.length > 0) {
        return {
          resolution,
          unlocked: false,
          reason: `${missing.length} conclusion${missing.length === 1 ? '' : 's'} still missing`,
        };
      }
      if (!this.state.check(resolution.requires)) {
        return { resolution, unlocked: false, reason: this.state.explain(resolution.requires) };
      }
      return { resolution, unlocked: true };
    });
  }

  /**
   * Close the case. Pays the base reward scaled by outcome quality, plus any
   * resolution-specific bonus (which may be negative — a messy solve can cost
   * you a bribe you already promised).
   */
  resolve(resolutionId: string): ResolveResult {
    const caseData = this.activeCase();
    if (!caseData) return { ok: false, reason: 'No case is open.' };

    const option = this.resolutionOptions().find((o) => o.resolution.id === resolutionId);
    if (!option) return { ok: false, reason: 'No such resolution.' };
    if (!option.unlocked) return { ok: false, reason: option.reason ?? 'Not available.' };

    const resolution = option.resolution;
    const basePence = Math.round(caseData.rewardPence * GRADE_MULTIPLIER[resolution.grade]);
    const bonusPence = resolution.bonusPence ?? 0;
    const totalPence = basePence + bonusPence;

    if (totalPence !== 0) this.state.addPence(totalPence);
    this.state.apply(resolution.effect);

    this.state.setCaseState(
      caseData.id,
      resolution.grade === 'failed' ? 'failed' : 'resolved',
      resolution.grade,
    );
    this.state.caseProgress(caseData.id).resolutionId = resolution.id;

    // Closing a case takes a day of writing up and knocking on doors.
    this.state.advanceDay(1);

    return { ok: true, resolution, grade: resolution.grade, basePence, bonusPence, totalPence };
  }
}
