/**
 * The spine.
 *
 * The city is open from the first minute — you can walk to the market before
 * you have a case, sleep through the afternoon, or stand in the street reading
 * notices. What keeps that from being aimless is that exactly one chapter is
 * always current, it says in one line what the story is waiting for, and the
 * world will point at the door that leads there.
 *
 * Chapters are not gates. Nothing here locks a door; the doors that are locked
 * are locked in the map files, for reasons of their own. This only ever answers
 * "what were we doing?" — which is the question a player who put the game down
 * on Tuesday actually has.
 */

import { bus } from '@/systems/EventBus';
import type { Content } from '@/systems/Content';
import type { GameState } from '@/systems/GameState';
import type { ChapterData } from '@/types/schema';

export class StorySystem {
  private lastAnnounced?: string;

  constructor(
    private readonly state: GameState,
    private readonly content: Content,
  ) {}

  /** Every chapter, in order. */
  all(): ChapterData[] {
    return this.content.chapters;
  }

  /** A chapter is behind you once its condition holds. */
  isDone(chapter: ChapterData): boolean {
    // No condition means an ending: it stays current for the rest of the run.
    if (!chapter.doneWhen) return false;
    return this.state.check(chapter.doneWhen);
  }

  /**
   * The chapter the story is on: the first one not yet finished.
   *
   * Deliberately the *first* unfinished chapter rather than the furthest one
   * reached. Solve step five out of order and the card still shows step four,
   * because step four is genuinely still undone.
   */
  current(): ChapterData | undefined {
    return this.content.chapters.find((chapter) => !this.isDone(chapter));
  }

  /** Chapters already behind you, oldest first. */
  completed(): ChapterData[] {
    const current = this.current();
    if (!current) return [...this.content.chapters];
    const index = this.content.chapters.indexOf(current);
    return this.content.chapters.slice(0, index).filter((chapter) => this.isDone(chapter));
  }

  /** 1-based position of the current chapter, for "3 of 9". */
  progress(): { index: number; total: number } {
    const total = this.content.chapters.length;
    const current = this.current();
    return { index: current ? this.content.chapters.indexOf(current) + 1 : total, total };
  }

  /**
   * Re-check after anything that could have advanced the story, and announce a
   * new chapter once. Called wherever objectives are refreshed.
   */
  refresh(): void {
    const current = this.current();
    const id = current?.id ?? 'done';
    if (this.lastAnnounced === undefined) {
      // First look of the session: adopt the state silently. Announcing here
      // would fire on every room change and on every load.
      this.lastAnnounced = id;
      return;
    }
    if (id === this.lastAnnounced) return;
    this.lastAnnounced = id;
    if (current) bus.emit('story:advanced', { chapterId: current.id, objective: current.objective });
  }

  /**
   * The first step of the walk from `fromMap` to the current chapter's map:
   * which exit of the room you are standing in leads that way.
   *
   * Breadth-first over the exits, so the signpost points along the shortest
   * route rather than at whichever door happens to be listed first. Returns
   * undefined when you are already there, when there is no objective, or when
   * no route exists (the cellar, if you have not found the stairs).
   */
  routeFrom(fromMap: string): { toMap: string; hops: number } | undefined {
    const target = this.current()?.where;
    if (!target || target === fromMap) return undefined;
    if (!this.content.map(target)) return undefined;

    const seen = new Set<string>([fromMap]);
    // Each entry remembers the door out of the *starting* room that began it.
    let frontier: { at: string; first: string; hops: number }[] = [];
    for (const exit of this.content.map(fromMap)?.exits ?? []) {
      if (seen.has(exit.toMap)) continue;
      seen.add(exit.toMap);
      frontier.push({ at: exit.toMap, first: exit.toMap, hops: 1 });
    }

    while (frontier.length > 0) {
      const next: typeof frontier = [];
      for (const step of frontier) {
        if (step.at === target) return { toMap: step.first, hops: step.hops };
        for (const exit of this.content.map(step.at)?.exits ?? []) {
          if (seen.has(exit.toMap)) continue;
          seen.add(exit.toMap);
          next.push({ at: exit.toMap, first: step.first, hops: step.hops + 1 });
        }
      }
      frontier = next;
    }
    return undefined;
  }

  /** Human-readable name of the map the story is pointing at. */
  destinationName(): string | undefined {
    const where = this.current()?.where;
    if (!where) return undefined;
    return this.content.map(where)?.name;
  }
}
