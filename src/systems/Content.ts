/**
 * The content registry: every JSON file under public/data, loaded at runtime
 * and indexed by id.
 *
 * Content is deliberately *not* bundled by Vite. Adding a case, pathway, map or
 * dialogue tree is a matter of dropping a file into public/data and adding its
 * name to public/data/index.json — no TypeScript changes, no rebuild.
 */

import type {
  AbilityData,
  CaseData,
  ChapterData,
  CharacterData,
  ContentIndex,
  DialogueTree,
  EncounterData,
  ItemData,
  MapData,
  PathwayData,
  SequenceData,
} from '@/types/schema';

export class Content {
  readonly pathways = new Map<string, PathwayData>();
  readonly abilities = new Map<string, AbilityData>();
  readonly cases = new Map<string, CaseData>();
  readonly maps = new Map<string, MapData>();
  readonly dialogue = new Map<string, DialogueTree>();
  readonly encounters = new Map<string, EncounterData>();
  readonly items = new Map<string, ItemData>();
  readonly characters = new Map<string, CharacterData>();
  /** The story spine, in the order the file lists it. */
  readonly chapters: ChapterData[] = [];

  /**
   * Read everything the index points at. `read` is supplied by the caller so
   * this works with Phaser's loader cache in-game and with plain fetch/fs in
   * tooling.
   */
  static fromLoaded(
    index: ContentIndex,
    read: (kind: keyof ContentIndex, name: string) => unknown,
  ): Content {
    const content = new Content();

    for (const name of index.pathways) {
      const data = read('pathways', name) as PathwayData;
      // Keep sequences ordered weakest-first so tier lookups are predictable.
      data.sequences.sort((a, b) => b.sequence - a.sequence);
      content.pathways.set(data.id, data);
    }
    for (const name of index.abilities) {
      const list = read('abilities', name) as AbilityData[];
      for (const ability of list) content.abilities.set(ability.id, ability);
    }
    for (const name of index.cases) {
      const data = read('cases', name) as CaseData;
      content.cases.set(data.id, data);
    }
    for (const name of index.maps) {
      const data = read('maps', name) as MapData;
      content.maps.set(data.id, data);
    }
    for (const name of index.dialogue) {
      const list = read('dialogue', name) as DialogueTree[];
      for (const tree of list) content.dialogue.set(tree.id, tree);
    }
    for (const name of index.encounters ?? []) {
      const list = read('encounters', name) as EncounterData[];
      for (const encounter of list) content.encounters.set(encounter.id, encounter);
    }
    for (const item of read('items', index.items) as ItemData[]) {
      content.items.set(item.id, item);
    }
    for (const character of read('characters', index.characters) as CharacterData[]) {
      content.characters.set(character.id, character);
    }
    if (index.story) {
      content.chapters.push(...(read('story', index.story) as ChapterData[]));
    }

    return content;
  }

  pathway(id: string): PathwayData {
    const found = this.pathways.get(id);
    if (!found) throw new Error(`Unknown pathway: ${id}`);
    return found;
  }

  /** Every pathway, in the order index.json lists them. */
  pathwayList(): PathwayData[] {
    return [...this.pathways.values()];
  }

  /** The tier data for a given rank on a pathway. */
  sequence(pathwayId: string, sequence: number): SequenceData | undefined {
    return this.pathway(pathwayId).sequences.find((s) => s.sequence === sequence);
  }

  ability(id: string): AbilityData | undefined {
    return this.abilities.get(id);
  }

  case(id: string): CaseData | undefined {
    return this.cases.get(id);
  }

  map(id: string): MapData | undefined {
    return this.maps.get(id);
  }

  encounter(id: string): EncounterData | undefined {
    return this.encounters.get(id);
  }

  item(id: string): ItemData | undefined {
    return this.items.get(id);
  }

  chapter(id: string): ChapterData | undefined {
    return this.chapters.find((chapter) => chapter.id === id);
  }

  character(id: string): CharacterData | undefined {
    return this.characters.get(id);
  }

  /** Display name for a character id, falling back to the raw id. */
  characterName(id: string): string {
    return this.characters.get(id)?.name ?? id;
  }

  /** Every clue definition across all cases, indexed by clue id. */
  clueIndex() {
    const index = new Map<string, { caseId: string; clue: CaseData['clues'][number] }>();
    for (const caseData of this.cases.values()) {
      for (const clue of caseData.clues) index.set(clue.id, { caseId: caseData.id, clue });
    }
    return index;
  }

  /** Club members, in the order they should appear in the hub roster. */
  clubMembers(): CharacterData[] {
    return [...this.characters.values()].filter((c) => c.clubMember);
  }
}
