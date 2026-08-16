/**
 * localStorage persistence. Kept deliberately small: one slot, explicit
 * save/load, and every failure path returns rather than throwing, because
 * iOS Safari denies storage entirely in Private Browsing.
 */

import type { GameState, SaveData } from '@/systems/GameState';

const KEY = 'tarot-club:save:v1';

export const SaveManager = {
  available(): boolean {
    try {
      const probe = '__tc_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  },

  save(state: GameState): boolean {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state.toSave()));
      return true;
    } catch {
      return false;
    }
  },

  read(): SaveData | undefined {
    try {
      const raw = window.localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as SaveData) : undefined;
    } catch {
      return undefined;
    }
  },

  hasSave(): boolean {
    return this.read() !== undefined;
  },

  load(state: GameState): boolean {
    const data = this.read();
    if (!data) return false;
    try {
      state.loadSave(data);
      return true;
    } catch (error) {
      console.warn('Discarding incompatible save:', error);
      this.clear();
      return false;
    }
  },

  clear(): void {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* nothing we can do */
    }
  },
};
