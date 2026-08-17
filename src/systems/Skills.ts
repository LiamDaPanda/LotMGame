/**
 * Trained skills.
 *
 * Skills are bought with money and days, never earned by repetition — this is a
 * game about a working investigator, and an investigator who wants to be better
 * at reading a room pays somebody to teach them. Every skill has at least one
 * concrete mechanical effect outside the check system, so levelling one is never
 * an abstract number going up.
 */

import type { SkillCheck, SkillId } from '@/types/schema';

export const MAX_SKILL = 10;

/** Default odds gained per point when a check does not say otherwise. */
const DEFAULT_PER_POINT = 0.07;

/** Odds are never certain in either direction; there is always a way it goes wrong. */
const MIN_CHANCE = 0.05;
const MAX_CHANCE = 0.95;

export interface SkillInfo {
  id: SkillId;
  name: string;
  /** What it is. */
  summary: string;
  /** The passive effect, phrased so the player can verify it themselves. */
  benefit: string;
}

export const SKILLS: Record<SkillId, SkillInfo> = {
  observation: {
    id: 'observation',
    name: 'Observation',
    summary: 'Noticing the thing that is one degree out of place.',
    benefit: 'Better odds on stakeouts and searches. At 3+, hotspots reveal what you have missed.',
  },
  rhetoric: {
    id: 'rhetoric',
    name: 'Rhetoric',
    summary: 'Making a person want to keep talking to you.',
    benefit: 'Bribes cost 4% less per point. Better odds on talking your way out.',
  },
  occultism: {
    id: 'occultism',
    name: 'Occultism',
    summary: 'Theory, ritual grammar, and what the Church files under heresy.',
    benefit: 'Powers cost 4% less spirituality per point, and you digest a role faster.',
  },
  streetwise: {
    id: 'streetwise',
    name: 'Streetwise',
    summary: 'Who to ask, who to avoid, and what a thing is really worth.',
    benefit: 'Better prices from a fence, and better odds of getting off a street quietly.',
  },
};

/** Tuition for the next level. Getting good is expensive on purpose. */
export function trainingCost(currentLevel: number): number {
  return 180 + currentLevel * 180;
}

/** Days a lesson consumes. */
export const TRAINING_DAYS = 1;

/** Resolve a check's odds. Always shown to the player before they commit. */
export function chanceOf(check: SkillCheck, level: number): number {
  const perPoint = check.perPoint ?? DEFAULT_PER_POINT;
  return Math.max(MIN_CHANCE, Math.min(MAX_CHANCE, check.base + level * perPoint));
}

export function rollCheck(check: SkillCheck, level: number): { passed: boolean; chance: number } {
  const chance = chanceOf(check, level);
  return { passed: Math.random() < chance, chance };
}

/** Multiplier applied to spirituality costs. */
export function occultDiscount(level: number): number {
  return Math.max(0.5, 1 - level * 0.04);
}

/** Multiplier applied to bribes and paid information. */
export function bribeDiscount(level: number): number {
  return Math.max(0.5, 1 - level * 0.04);
}

/** Multiplier applied to a fence's asking price (and, inverted, to their offers). */
export function marketDiscount(level: number): number {
  return Math.max(0.6, 1 - level * 0.035);
}
