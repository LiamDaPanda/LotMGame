/**
 * The single source of truth for a playthrough.
 *
 * Everything mutable lives here; every mutation goes through a method that
 * clamps the value and announces it on the bus. Scenes never write fields
 * directly, so the HUD can stay in sync by listening alone.
 */

import { bus } from '@/systems/EventBus';
import type { Content } from '@/systems/Content';
import { MAX_SKILL } from '@/systems/Skills';
import { SKILL_IDS, type CaseState, type Condition, type Effect, type ResolutionGrade, type SkillId } from '@/types/schema';

export interface CaseProgress {
  state: CaseState;
  resolutionId?: string;
  grade?: ResolutionGrade;
  completedObjectives: string[];
}

export interface SaveData {
  version: number;
  pathwayId: string;
  sequence: number;
  digestion: number;
  sanity: number;
  spirituality: number;
  concealment: number;
  pence: number;
  day: number;
  daysUntilRent: number;
  rentPence: number;
  inventory: Record<string, number>;
  flags: string[];
  clues: string[];
  deductions: string[];
  trust: Record<string, number>;
  cases: Record<string, CaseProgress>;
  currentMap: string;
  extraAbilities: string[];
  lossOfControlCount: number;
  skills: Record<SkillId, number>;
  spentLeads: string[];
  seenEncounters: string[];
}

const SAVE_VERSION = 1;

/** Starting purse: £2 10s — a month's rent and not much else. */
export const STARTING_PENCE = 600;
/** Weekly rent on a room off Whitlock Row. */
export const DEFAULT_RENT_PENCE = 216; // 18s
export const DAYS_PER_RENT_CYCLE = 7;

export class GameState {
  readonly content: Content;

  pathwayId = 'seer';
  sequence = 9;
  /**
   * How thoroughly the current potion has been digested, 0-100. Advancing
   * before this reaches 100 is possible but dangerous — see Progression.
   *
   * A new player starts part-way through: recently a Seer, still settling into
   * the role. That leaves the temptation route live from the first rank-up,
   * which is the point of having it.
   */
  digestion = 55;

  sanity = 100;
  spirituality = 40;
  /** 100 = nobody suspects a thing, 0 = the Church knows your name. */
  concealment = 100;

  pence = STARTING_PENCE;
  day = 1;
  daysUntilRent = DAYS_PER_RENT_CYCLE;
  rentPence = DEFAULT_RENT_PENCE;

  inventory = new Map<string, number>();
  flags = new Set<string>();
  clues = new Set<string>();
  deductions = new Set<string>();
  trust = new Map<string, number>();
  cases = new Map<string, CaseProgress>();
  /** Abilities granted outside the pathway ladder (artefacts, story beats). */
  extraAbilities = new Set<string>();

  currentMap = 'club_hub';
  lossOfControlCount = 0;

  /** Trained skills, 0-10. Everyone starts competent at nothing in particular. */
  skills: Record<SkillId, number> = {
    observation: 1,
    rhetoric: 1,
    occultism: 1,
    streetwise: 1,
  };

  /** Leads already followed to a conclusion — they do not pay twice. */
  spentLeads = new Set<string>();
  /** One-shot encounters already played. */
  seenEncounters = new Set<string>();

  constructor(content: Content) {
    this.content = content;
    for (const member of content.clubMembers()) this.trust.set(member.id, 20);
    this.sanity = this.sanityMax;
    this.spirituality = this.spiritualityMax;
  }

  /**
   * Choose the pathway this run walks. Only meaningful before play starts —
   * the ladder, the abilities and the stat ceilings all hang off it — so the
   * main menu calls it and nothing else does.
   */
  setPathway(pathwayId: string): void {
    const pathway = this.content.pathway(pathwayId);
    this.pathwayId = pathway.id;
    // Entry rung is the lowest-ranked tier the pathway defines.
    this.sequence = Math.max(...pathway.sequences.map((tier) => tier.sequence));
    this.sanity = this.sanityMax;
    this.spirituality = this.spiritualityMax;
  }

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  get sequenceData() {
    return this.content.sequence(this.pathwayId, this.sequence);
  }

  get sequenceTitle(): string {
    return this.sequenceData?.title ?? `Sequence ${this.sequence}`;
  }

  get sanityMax(): number {
    return this.sequenceData?.sanityMax ?? 100;
  }

  get spiritualityMax(): number {
    return this.sequenceData?.spiritualityMax ?? 40;
  }

  /** Every ability unlocked at or below the current rank, plus story grants. */
  knownAbilities(): string[] {
    const pathway = this.content.pathway(this.pathwayId);
    const ids: string[] = [];
    for (const tier of pathway.sequences) {
      // Lower sequence number = higher rank, so tiers at or above the player's
      // number are already earned.
      if (tier.sequence >= this.sequence) ids.push(...tier.grantsAbilities);
    }
    ids.push(...this.extraAbilities);
    return [...new Set(ids)].filter((id) => this.content.ability(id));
  }

  knowsAbility(id: string): boolean {
    return this.knownAbilities().includes(id);
  }

  /** Suspicion is the inverse of concealment — what the HUD shows as risk. */
  get suspicion(): number {
    return 100 - this.concealment;
  }

  skill(id: SkillId): number {
    return this.skills[id] ?? 0;
  }

  /** Returns false when already at the ceiling. */
  addSkill(id: SkillId, delta: number): boolean {
    const current = this.skill(id);
    const next = Math.max(0, Math.min(MAX_SKILL, current + delta));
    if (next === current) return false;
    this.skills[id] = next;
    bus.emit('skill:changed', { skill: id, value: next, delta: next - current });
    return true;
  }

  // -------------------------------------------------------------------------
  // Meters
  // -------------------------------------------------------------------------

  private setMeter(
    stat: 'sanity' | 'spirituality' | 'concealment' | 'digestion',
    next: number,
    max: number,
  ): void {
    const current = this[stat];
    const clamped = Math.max(0, Math.min(max, Math.round(next)));
    if (clamped === current) return;
    this[stat] = clamped;
    bus.emit('stat:changed', { stat, value: clamped, max, delta: clamped - current });

    if (stat === 'sanity' && clamped === 0) {
      this.lossOfControlCount += 1;
      bus.emit('loss-of-control', { reason: 'Your spirit body tears loose of its moorings.' });
      // Surviving the episode leaves you hollowed out but functional.
      this.sanity = Math.round(this.sanityMax * 0.35);
      this.concealment = Math.max(0, this.concealment - 15);
    }
  }

  addSanity(delta: number): void {
    this.setMeter('sanity', this.sanity + delta, this.sanityMax);
  }

  addSpirituality(delta: number): void {
    this.setMeter('spirituality', this.spirituality + delta, this.spiritualityMax);
  }

  /** Negative delta = more suspicion. */
  addConcealment(delta: number): void {
    this.setMeter('concealment', this.concealment + delta, 100);
  }

  addDigestion(delta: number): void {
    this.setMeter('digestion', this.digestion + delta, 100);
  }

  // -------------------------------------------------------------------------
  // Money
  // -------------------------------------------------------------------------

  canAfford(pence: number): boolean {
    return this.pence >= pence;
  }

  /** Add (or, with a negative delta, deduct) money. Returns the new total. */
  addPence(delta: number): number {
    const rounded = Math.trunc(delta);
    if (rounded === 0) return this.pence;
    this.pence += rounded;
    bus.emit('money:changed', { pence: this.pence, delta: rounded });
    return this.pence;
  }

  /** Deduct money only if it is all there. */
  spend(pence: number): boolean {
    if (!this.canAfford(pence)) return false;
    this.addPence(-pence);
    return true;
  }

  // -------------------------------------------------------------------------
  // Inventory
  // -------------------------------------------------------------------------

  itemCount(itemId: string): number {
    return this.inventory.get(itemId) ?? 0;
  }

  hasItem(itemId: string): boolean {
    return this.itemCount(itemId) > 0;
  }

  addItem(itemId: string, count = 1): void {
    const next = Math.max(0, this.itemCount(itemId) + count);
    if (next === 0) this.inventory.delete(itemId);
    else this.inventory.set(itemId, next);
    bus.emit('inventory:changed', { itemId, count: next, delta: count });
  }

  removeItem(itemId: string, count = 1): boolean {
    if (this.itemCount(itemId) < count) return false;
    this.addItem(itemId, -count);
    return true;
  }

  /**
   * Use a carried item. Returns the line to show, or a refusal.
   *
   * Items without a `use` block are carried, sold or checked for by a
   * condition — evidence and formulae are like that. Anything the player can
   * buy and then do something with goes through here.
   */
  useItem(itemId: string): { ok: boolean; text: string } {
    const item = this.content.item(itemId);
    if (!item?.use) return { ok: false, text: 'There is nothing to be done with it.' };
    if (!this.hasItem(itemId)) return { ok: false, text: 'You do not have it.' };
    if (!this.check(item.use.requires)) {
      return { ok: false, text: this.explain(item.use.requires) ?? 'Not now.' };
    }
    // Spend it before applying, so an effect that grants the same item works.
    if (item.use.consume !== false) this.removeItem(itemId);
    this.apply(item.use.effect);
    bus.emit('notice', { text: `Used: ${item.name}`, tone: 'good' });
    return { ok: true, text: item.use.description };
  }

  // -------------------------------------------------------------------------
  // Flags, clues, deductions, trust
  // -------------------------------------------------------------------------

  setFlag(flag: string): void {
    if (this.flags.has(flag)) return;
    this.flags.add(flag);
    bus.emit('flag:set', { flag });
  }

  clearFlag(flag: string): void {
    this.flags.delete(flag);
  }

  hasFlag(flag: string): boolean {
    return this.flags.has(flag);
  }

  /** Returns true if this clue is new. */
  addClue(clueId: string): boolean {
    if (this.clues.has(clueId)) return false;
    this.clues.add(clueId);
    bus.emit('clue:found', { clueId });
    return true;
  }

  hasClue(clueId: string): boolean {
    return this.clues.has(clueId);
  }

  addDeduction(deductionId: string): boolean {
    if (this.deductions.has(deductionId)) return false;
    this.deductions.add(deductionId);
    bus.emit('deduction:formed', { deductionId });
    return true;
  }

  hasDeduction(deductionId: string): boolean {
    return this.deductions.has(deductionId);
  }

  trustWith(member: string): number {
    return this.trust.get(member) ?? 0;
  }

  addTrust(member: string, delta: number): void {
    const next = Math.max(-100, Math.min(100, this.trustWith(member) + delta));
    this.trust.set(member, next);
    bus.emit('trust:changed', { member, value: next, delta });
  }

  // -------------------------------------------------------------------------
  // Cases
  // -------------------------------------------------------------------------

  caseProgress(caseId: string): CaseProgress {
    let progress = this.cases.get(caseId);
    if (!progress) {
      progress = { state: 'unavailable', completedObjectives: [] };
      this.cases.set(caseId, progress);
    }
    return progress;
  }

  caseState(caseId: string): CaseState {
    return this.caseProgress(caseId).state;
  }

  setCaseState(caseId: string, state: CaseState, grade?: ResolutionGrade): void {
    const progress = this.caseProgress(caseId);
    if (progress.state === state && progress.grade === grade) return;
    progress.state = state;
    if (grade) progress.grade = grade;
    bus.emit('case:changed', { caseId, state, grade });
  }

  activeCaseId(): string | undefined {
    for (const [caseId, progress] of this.cases) {
      if (progress.state === 'active') return caseId;
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Time & upkeep
  // -------------------------------------------------------------------------

  /**
   * Advance the calendar. Rent falls due on a cycle; missing it costs trust
   * with the landlady and gnaws at sanity, which is the whole point of keeping
   * mundane living costs in a game about occult ascension.
   */
  advanceDay(days = 1): { rentPaid: boolean; rentOwed: number } {
    let rentPaid = false;
    let rentOwed = 0;
    for (let i = 0; i < days; i++) {
      this.day += 1;
      this.daysUntilRent -= 1;
      if (this.daysUntilRent <= 0) {
        this.daysUntilRent = DAYS_PER_RENT_CYCLE;
        if (this.spend(this.rentPence)) {
          rentPaid = true;
        } else {
          rentOwed += this.rentPence;
          this.addSanity(-6);
          this.addTrust('landlady', -10);
          this.setFlag('rent_missed');
        }
      }
    }
    bus.emit('day:advanced', { day: this.day });
    return { rentPaid, rentOwed };
  }

  // -------------------------------------------------------------------------
  // Conditions & effects
  // -------------------------------------------------------------------------

  /** Evaluate a data-defined gate. Every present field must pass. */
  /**
   * Item ids the next rung's advancement asks for, split by what they are. A
   * requirement may list substitutes (`itemAnyOf`), and a grey-market copy of a
   * formula is still a formula, so every candidate counts.
   */
  private nextRankItems(kind: 'ritual' | 'potion'): string[] {
    const advancement = this.sequenceData?.advancement;
    if (!advancement) return [];
    const ids: string[] = [];
    for (const requirement of advancement.requirements) {
      if (requirement.type !== 'item') continue;
      const candidates = requirement.itemAnyOf ?? (requirement.itemId ? [requirement.itemId] : []);
      for (const id of candidates) {
        if (this.content.item(id)?.kind === kind) ids.push(id);
      }
    }
    return ids;
  }

  /** Does the player hold a formula their next rank would accept? */
  holdsNextFormula(): boolean {
    return this.nextRankItems('ritual').some((id) => this.hasItem(id));
  }

  check(condition?: Condition): boolean {
    if (!condition) return true;
    if (condition.holdsNextFormula && !this.holdsNextFormula()) return false;
    // `anyOf` is the one disjunction; everything else on the object still ANDs.
    if (condition.anyOf && !condition.anyOf.some((option) => this.check(option))) return false;
    if (condition.ability && !this.knowsAbility(condition.ability)) return false;
    if (condition.clue && !this.hasClue(condition.clue)) return false;
    if (condition.deduction && !this.hasDeduction(condition.deduction)) return false;
    if (condition.flag && !this.hasFlag(condition.flag)) return false;
    if (condition.notFlag && this.hasFlag(condition.notFlag)) return false;
    if (condition.item && !this.hasItem(condition.item)) return false;
    if (condition.pence !== undefined && this.pence < condition.pence) return false;
    if (condition.sequenceAtMost !== undefined && this.sequence > condition.sequenceAtMost) return false;
    if (condition.trustAtLeast && this.trustWith(condition.trustAtLeast.member) < condition.trustAtLeast.value) {
      return false;
    }
    if (condition.caseState && this.caseState(condition.caseState.caseId) !== condition.caseState.state) {
      return false;
    }
    if (condition.skillAtLeast && this.skill(condition.skillAtLeast.skill) < condition.skillAtLeast.value) {
      return false;
    }
    return true;
  }

  /** Human-readable reason a gate failed, for greyed-out dialogue options. */
  explain(condition?: Condition): string | undefined {
    if (!condition || this.check(condition)) return undefined;
    if (condition.ability && !this.knowsAbility(condition.ability)) {
      const ability = this.content.ability(condition.ability);
      return `Requires ${ability?.name ?? condition.ability}`;
    }
    if (condition.holdsNextFormula && !this.holdsNextFormula()) {
      return 'You have no formula for the next rung';
    }
    if (condition.clue && !this.hasClue(condition.clue)) return 'You have nothing to put to them';
    if (condition.deduction && !this.hasDeduction(condition.deduction)) return 'You have not worked it out yet';
    if (condition.item && !this.hasItem(condition.item)) {
      return `Requires ${this.content.item(condition.item)?.name ?? condition.item}`;
    }
    if (condition.pence !== undefined && this.pence < condition.pence) return 'You cannot afford it';
    if (condition.sequenceAtMost !== undefined && this.sequence > condition.sequenceAtMost) {
      return `Requires Sequence ${condition.sequenceAtMost} or higher`;
    }
    if (condition.trustAtLeast && this.trustWith(condition.trustAtLeast.member) < condition.trustAtLeast.value) {
      return `${this.content.characterName(condition.trustAtLeast.member)} does not trust you that far`;
    }
    if (condition.skillAtLeast && this.skill(condition.skillAtLeast.skill) < condition.skillAtLeast.value) {
      return `Requires ${condition.skillAtLeast.skill} ${condition.skillAtLeast.value}`;
    }
    if (condition.anyOf) {
      const reasons = condition.anyOf.map((option) => this.explain(option)).filter(Boolean);
      if (reasons.length) return reasons.join(', or ');
    }
    if (condition.flag || condition.notFlag || condition.caseState) return 'Not now';
    return 'Not available';
  }

  /** Apply a data-defined mutation bundle. */
  apply(effect?: Effect): void {
    if (!effect) return;
    if (effect.sanity) this.addSanity(effect.sanity);
    if (effect.spirituality) this.addSpirituality(effect.spirituality);
    if (effect.concealment) this.addConcealment(effect.concealment);
    if (effect.digestion) this.addDigestion(effect.digestion);
    if (effect.pence) this.addPence(effect.pence);
    if (effect.trust) for (const [member, delta] of Object.entries(effect.trust)) this.addTrust(member, delta);
    if (effect.flags) for (const flag of effect.flags) this.setFlag(flag);
    if (effect.clearFlags) for (const flag of effect.clearFlags) this.clearFlag(flag);
    if (effect.clues) for (const clue of effect.clues) this.addClue(clue);
    if (effect.items) for (const item of effect.items) this.addItem(item);
    if (effect.brewNextPotion) {
      // Only the first: a rung asks for one potion, and a batch of doubtful
      // reagents makes one bottle.
      const potion = this.nextRankItems('potion')[0];
      if (potion) this.addItem(potion);
    }
    if (effect.removeItems) for (const item of effect.removeItems) this.removeItem(item);
    if (effect.skills) {
      for (const [skill, delta] of Object.entries(effect.skills)) {
        if (delta) this.addSkill(skill as SkillId, delta);
      }
    }
    // Time last: a day passing can trigger rent, which should settle after the
    // rest of the outcome has been paid out.
    if (effect.days) this.advanceDay(effect.days);
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  toSave(): SaveData {
    return {
      version: SAVE_VERSION,
      pathwayId: this.pathwayId,
      sequence: this.sequence,
      digestion: this.digestion,
      sanity: this.sanity,
      spirituality: this.spirituality,
      concealment: this.concealment,
      pence: this.pence,
      day: this.day,
      daysUntilRent: this.daysUntilRent,
      rentPence: this.rentPence,
      inventory: Object.fromEntries(this.inventory),
      flags: [...this.flags],
      clues: [...this.clues],
      deductions: [...this.deductions],
      trust: Object.fromEntries(this.trust),
      cases: Object.fromEntries(this.cases),
      currentMap: this.currentMap,
      extraAbilities: [...this.extraAbilities],
      lossOfControlCount: this.lossOfControlCount,
      skills: { ...this.skills },
      spentLeads: [...this.spentLeads],
      seenEncounters: [...this.seenEncounters],
    };
  }

  loadSave(data: SaveData): void {
    if (data.version !== SAVE_VERSION) {
      throw new Error(`Save is version ${data.version}; this build reads version ${SAVE_VERSION}.`);
    }
    this.pathwayId = data.pathwayId;
    this.sequence = data.sequence;
    this.digestion = data.digestion;
    this.sanity = data.sanity;
    this.spirituality = data.spirituality;
    this.concealment = data.concealment;
    this.pence = data.pence;
    this.day = data.day;
    this.daysUntilRent = data.daysUntilRent;
    this.rentPence = data.rentPence;
    this.inventory = new Map(Object.entries(data.inventory));
    this.flags = new Set(data.flags);
    this.clues = new Set(data.clues);
    this.deductions = new Set(data.deductions);
    this.trust = new Map(Object.entries(data.trust));
    this.cases = new Map(Object.entries(data.cases));
    this.currentMap = data.currentMap;
    this.extraAbilities = new Set(data.extraAbilities);
    this.lossOfControlCount = data.lossOfControlCount;
    // Tolerate a save written before a skill existed rather than throwing.
    for (const id of SKILL_IDS) this.skills[id] = data.skills?.[id] ?? 1;
    this.spentLeads = new Set(data.spentLeads ?? []);
    this.seenEncounters = new Set(data.seenEncounters ?? []);
  }
}
