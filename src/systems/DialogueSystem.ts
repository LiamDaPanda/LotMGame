/**
 * Branching dialogue.
 *
 * Choices can be gated four ways, matching the four things an investigator
 * actually trades in: a Beyonder ability, a discovered clue, a formed
 * deduction, or money. Locked choices are shown greyed with their reason
 * rather than hidden, so the player learns what a bribe or a power would have
 * bought — that visibility is what makes the money and ability systems feel
 * like they matter.
 */

import { bus } from '@/systems/EventBus';
import type { AbilitySystem } from '@/systems/AbilitySystem';
import type { GameState } from '@/systems/GameState';
import type { DialogueChoice, DialogueNode, DialogueTree } from '@/types/schema';
import { format } from '@/systems/Money';

export interface PresentedChoice {
  index: number;
  text: string;
  enabled: boolean;
  reason?: string;
  /** Set when taking this choice spends money. */
  costPence?: number;
  /** Set when taking this choice burns an ability. */
  abilityId?: string;
}

export interface PresentedNode {
  speaker: string;
  speakerName: string;
  text: string;
  choices: PresentedChoice[];
  isEnd: boolean;
}

export class DialogueSystem {
  private tree?: DialogueTree;
  private nodeId?: string;
  /** Nodes already visited this conversation, to keep effects one-shot. */
  private applied = new Set<string>();

  constructor(
    private state: GameState,
    private abilities: AbilitySystem,
  ) {}

  get active(): boolean {
    return this.tree !== undefined;
  }

  /** Begin a conversation. Returns undefined if the tree is missing. */
  start(treeId: string): PresentedNode | undefined {
    const tree = this.state.content.dialogue.get(treeId);
    if (!tree) {
      console.warn(`Missing dialogue tree: ${treeId}`);
      return undefined;
    }
    this.tree = tree;
    this.applied.clear();
    return this.goto(tree.start);
  }

  stop(): void {
    this.tree = undefined;
    this.nodeId = undefined;
    this.applied.clear();
  }

  private node(): DialogueNode | undefined {
    if (!this.tree || !this.nodeId) return undefined;
    return this.tree.nodes[this.nodeId];
  }

  private goto(nodeId: string): PresentedNode | undefined {
    if (!this.tree) return undefined;
    const node = this.tree.nodes[nodeId];
    if (!node) {
      console.warn(`Missing dialogue node: ${this.tree.id}#${nodeId}`);
      this.stop();
      return undefined;
    }
    this.nodeId = nodeId;

    // Node effects fire once per conversation, on arrival.
    const key = `${this.tree.id}#${nodeId}`;
    if (node.effect && !this.applied.has(key)) {
      this.applied.add(key);
      this.state.apply(node.effect);
      for (const clueId of node.effect.clues ?? []) {
        const clue = [...this.state.content.cases.values()]
          .flatMap((c) => c.clues)
          .find((c) => c.id === clueId);
        if (clue) bus.emit('notice', { text: `Clue: ${clue.title}`, tone: 'good' });
      }
    }

    return this.present(node);
  }

  private present(node: DialogueNode): PresentedNode {
    const speaker = node.speaker ?? this.tree?.speaker ?? 'unknown';
    const choices: PresentedChoice[] = [];

    (node.choices ?? []).forEach((choice, index) => {
      const gate = this.gate(choice);
      if (!gate.enabled && choice.hideIfLocked) return;
      choices.push({
        index,
        text: this.decorate(choice),
        enabled: gate.enabled,
        reason: gate.reason,
        costPence: choice.costPence,
        abilityId: choice.useAbility,
      });
    });

    return {
      speaker,
      speakerName: this.state.content.characterName(speaker),
      text: node.text,
      choices,
      isEnd: choices.length === 0 || node.end === true,
    };
  }

  /** Prefix money costs onto the label so the price is visible before paying. */
  private decorate(choice: DialogueChoice): string {
    if (choice.costPence) return `${choice.text} (${format(choice.costPence)})`;
    return choice.text;
  }

  private gate(choice: DialogueChoice): { enabled: boolean; reason?: string } {
    if (choice.requires && !this.state.check(choice.requires)) {
      return { enabled: false, reason: this.state.explain(choice.requires) };
    }
    if (choice.costPence !== undefined && !this.state.canAfford(choice.costPence)) {
      return { enabled: false, reason: 'You cannot afford it' };
    }
    if (choice.useAbility) {
      const check = this.abilities.canUse(choice.useAbility, { context: 'dialogue' });
      if (!check.ok) return { enabled: false, reason: check.reason };
    }
    return { enabled: true };
  }

  /** Take a choice by its index within the current node's choice list. */
  choose(index: number): PresentedNode | undefined {
    const node = this.node();
    const choice = node?.choices?.[index];
    if (!node || !choice) return undefined;

    const gate = this.gate(choice);
    if (!gate.enabled) return this.present(node);

    // Pay in this order: ability first (it can still fail), then money.
    if (choice.useAbility) {
      // Talking to somebody means being seen using it.
      const result = this.abilities.use(choice.useAbility, { context: 'dialogue', witnessed: true });
      if (!result.ok) return this.present(node);
    }
    if (choice.costPence) {
      if (!this.state.spend(choice.costPence)) return this.present(node);
      bus.emit('notice', { text: `Paid ${format(choice.costPence)}.`, tone: 'info' });
    }
    if (choice.effect) this.state.apply(choice.effect);

    return this.goto(choice.goto);
  }
}
