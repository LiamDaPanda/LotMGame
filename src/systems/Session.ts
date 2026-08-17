/**
 * Everything a running playthrough needs, in one object.
 *
 * Stashed in the Phaser registry under `Session.KEY` so any scene can reach it
 * with `Session.get(this)` instead of threading it through scene data.
 */

import type Phaser from 'phaser';
import { AbilitySystem } from '@/systems/AbilitySystem';
import { CaseSystem } from '@/systems/CaseSystem';
import { Content } from '@/systems/Content';
import { DialogueSystem } from '@/systems/DialogueSystem';
import { EncounterSystem } from '@/systems/EncounterSystem';
import { InquirySystem } from '@/systems/InquirySystem';
import { GameState } from '@/systems/GameState';
import { Progression } from '@/systems/Progression';

export class Session {
  static readonly KEY = 'session';

  readonly state: GameState;
  readonly abilities: AbilitySystem;
  readonly progression: Progression;
  readonly cases: CaseSystem;
  readonly dialogue: DialogueSystem;
  readonly encounters: EncounterSystem;
  readonly inquiries: InquirySystem;

  constructor(readonly content: Content) {
    this.state = new GameState(content);
    this.abilities = new AbilitySystem(this.state);
    this.progression = new Progression(this.state);
    this.cases = new CaseSystem(this.state);
    this.dialogue = new DialogueSystem(this.state, this.abilities);
    this.encounters = new EncounterSystem(this.state, this.abilities);
    this.inquiries = new InquirySystem(this.state, this.cases);
  }

  static get(scene: Phaser.Scene): Session {
    const session = scene.registry.get(Session.KEY) as Session | undefined;
    if (!session) throw new Error('Session missing from registry — did PreloadScene run?');
    return session;
  }

  /** Wipe progress and start over, keeping the loaded content. */
  reset(): Session {
    return new Session(this.content);
  }
}
