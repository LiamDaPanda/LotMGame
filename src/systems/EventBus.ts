/**
 * A tiny typed pub/sub bus. Systems mutate state and announce it here; scenes
 * and HUD widgets subscribe. Keeping this separate from Phaser's own emitter
 * means game logic stays testable without booting a scene.
 */

import type { CaseState, ResolutionGrade, SkillId } from '@/types/schema';

export interface GameEvents {
  'stat:changed': { stat: 'sanity' | 'spirituality' | 'concealment' | 'digestion'; value: number; max: number; delta: number };
  'money:changed': { pence: number; delta: number };
  'inventory:changed': { itemId: string; count: number; delta: number };
  'clue:found': { clueId: string };
  'deduction:formed': { deductionId: string };
  'flag:set': { flag: string };
  'case:changed': { caseId: string; state: CaseState; grade?: ResolutionGrade };
  'objective:completed': { caseId: string; objectiveId: string };
  'sequence:changed': { sequence: number; title: string };
  'trust:changed': { member: string; value: number; delta: number };
  'skill:changed': { skill: SkillId; value: number; delta: number };
  'encounter:started': { encounterId: string };
  'ability:used': { abilityId: string; success: boolean; reason?: string };
  /** Transient message for the HUD ticker. */
  notice: { text: string; tone?: 'info' | 'good' | 'bad' | 'occult' };
  /** Sanity hit zero, or a botched advancement — the player loses control. */
  'loss-of-control': { reason: string };
  'day:advanced': { day: number };
  /** The spine moved on: a new chapter is current. */
  'story:advanced': { chapterId: string; objective: string };
}

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  once<K extends keyof GameEvents>(event: K, handler: Handler<K>): () => void {
    const off = this.on(event, ((payload: GameEvents[K]) => {
      off();
      handler(payload);
    }) as Handler<K>);
    return off;
  }

  off<K extends keyof GameEvents>(event: K, handler: Handler<K>): void {
    this.handlers.get(event)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Copy first: handlers may unsubscribe themselves while we iterate.
    for (const handler of [...set]) (handler as Handler<K>)(payload);
  }

  /** Drop every subscription — used when returning to the main menu. */
  clear(): void {
    this.handlers.clear();
  }
}

export const bus = new EventBus();
