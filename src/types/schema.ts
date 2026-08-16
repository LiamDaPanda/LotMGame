/**
 * Runtime shapes for every JSON file under public/data.
 *
 * Content is loaded at runtime (not bundled), so adding a pathway, case, map
 * or dialogue tree means dropping a file in public/data and listing it in
 * public/data/index.json — no code change and no rebuild of these types.
 *
 * `tools/validate-data.mjs` checks the shipped data against these shapes.
 */

// ---------------------------------------------------------------------------
// Shared condition / effect vocabulary
// ---------------------------------------------------------------------------

/** A gate evaluated against current game state. All present fields must pass. */
export interface Condition {
  /** Player must know this ability (and be able to pay for it). */
  ability?: string;
  /** Player must have discovered this clue. */
  clue?: string;
  /** Player must have formed this deduction. */
  deduction?: string;
  /** Story flag must be set. */
  flag?: string;
  /** Story flag must NOT be set. */
  notFlag?: string;
  /** Player must hold this item. */
  item?: string;
  /** Player must have at least this much money, in pence. */
  pence?: number;
  /** Sequence rank must be this number or lower (lower = more powerful). */
  sequenceAtMost?: number;
  /** Trust with a named club member must be at least this value. */
  trustAtLeast?: { member: string; value: number };
  /** Case must be in this state. */
  caseState?: { caseId: string; state: CaseState };
}

/** A mutation applied to game state when something resolves. */
export interface Effect {
  sanity?: number;
  spirituality?: number;
  concealment?: number;
  digestion?: number;
  pence?: number;
  /** Trust deltas keyed by club member id. */
  trust?: Record<string, number>;
  /** Flags to set. */
  flags?: string[];
  /** Flags to clear. */
  clearFlags?: string[];
  /** Clue ids to grant. */
  clues?: string[];
  /** Item ids to add. */
  items?: string[];
  /** Item ids to remove. */
  removeItems?: string[];
}

// ---------------------------------------------------------------------------
// Pathways & abilities
// ---------------------------------------------------------------------------

export type AbilityTag = 'investigation' | 'social' | 'danger' | 'utility';
export type AbilityContext = 'investigation' | 'dialogue' | 'hub' | 'anywhere';

export type AbilityEffectKind =
  | 'reveal_clue' // surfaces a hidden clue on the targeted hotspot
  | 'reveal_truth' // in dialogue: exposes a lie, unlocking a follow-up
  | 'unlock_access' // bypasses a locked/blocked hotspot
  | 'social_pressure' // forces a truthful or fuller answer
  | 'disguise' // reduces suspicion, opens impersonation routes
  | 'escape' // leaves a dangerous scene without a fight
  | 'sense_danger'; // marks nearby threats / trapped objects

export interface AbilityData {
  id: string;
  name: string;
  pathway: string;
  /** Sequence at which this ability unlocks (9 = weakest). */
  sequence: number;
  tags: AbilityTag[];
  summary: string;
  /** Flavour line shown when the ability fires. */
  flavour: string;
  spiritCost: number;
  sanityCost: number;
  /** Concealment damage — how much using this in public risks exposure. */
  exposure: number;
  usableIn: AbilityContext[];
  effect: { kind: AbilityEffectKind };
  /** Passive abilities are never "used"; they modify the world continuously. */
  passive?: boolean;
}

export interface AdvancementRequirement {
  type: 'case_completed' | 'item' | 'flag' | 'digestion' | 'trust';
  caseId?: string;
  itemId?: string;
  flag?: string;
  /** For type 'digestion': required percentage (0-100). */
  value?: number;
  /** For type 'trust': club member id. */
  member?: string;
  label: string;
}

export interface SequenceData {
  /** 9 (lowest) down to 1 (highest). */
  sequence: number;
  title: string;
  potionName: string;
  description: string;
  /** Permanent stat ceilings granted at this rank. */
  spiritualityMax: number;
  sanityMax: number;
  grantsAbilities: string[];
  /** Narrative beat played on reaching this rank. */
  narrative: string;
  /** How to reach the NEXT rank. Absent on Sequence 1. */
  advancement?: {
    toSequence: number;
    toTitle: string;
    requirements: AdvancementRequirement[];
    ritualText: string;
    /** The risky shortcut: advance without full digestion. */
    temptation: {
      label: string;
      description: string;
      /** Extra sanity lost when taking the shortcut. */
      sanityCost: number;
      /** Extra concealment lost when taking the shortcut. */
      concealmentCost: number;
      /** Chance (0-1) of a loss-of-control incident. */
      lossOfControlChance: number;
    };
  };
}

export interface PathwayData {
  id: string;
  name: string;
  epithet: string;
  description: string;
  accentColor: string;
  /** Ordered 9 → 1. Only the implemented tiers need to be present. */
  sequences: SequenceData[];
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type ItemKind = 'mundane' | 'evidence' | 'ritual' | 'potion' | 'document';

export interface ItemData {
  id: string;
  name: string;
  kind: ItemKind;
  description: string;
  /** Shop price in pence. Omit for items that are never sold. */
  pricePence?: number;
  /** What the club will pay for it, in pence. */
  sellPence?: number;
  /** Icon index into public/assets/ui/icons.png. */
  icon: number;
  /** Requisition gate at the club shop. */
  requires?: Condition;
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export interface CharacterData {
  id: string;
  name: string;
  /** Tarot title for club members, role for everyone else. */
  title: string;
  /** Row index into the character spritesheet / portrait sheet. */
  spriteRow: number;
  /** Club members are tracked for trust and appear in the hub. */
  clubMember: boolean;
  bio: string;
}

// ---------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------

export interface DialogueChoice {
  text: string;
  goto: string;
  /** Gate on state; failed gates are shown greyed with a reason, or hidden. */
  requires?: Condition;
  /** Hide entirely rather than showing as locked. */
  hideIfLocked?: boolean;
  /** Ability spent when this choice is taken (pays spirit/sanity/exposure). */
  useAbility?: string;
  /** Money spent when this choice is taken, in pence. */
  costPence?: number;
  /** Applied when the choice is taken. */
  effect?: Effect;
}

export interface DialogueNode {
  /** Speaker override; defaults to the tree's speaker. */
  speaker?: string;
  text: string;
  effect?: Effect;
  choices?: DialogueChoice[];
  /** With no choices, the node ends the conversation. */
  end?: boolean;
}

export interface DialogueTree {
  id: string;
  speaker: string;
  start: string;
  nodes: Record<string, DialogueNode>;
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export type CaseState = 'unavailable' | 'available' | 'active' | 'resolved' | 'failed';
export type ResolutionGrade = 'clean' | 'messy' | 'partial' | 'failed';

export interface ClueData {
  id: string;
  title: string;
  text: string;
  /** Shown on the deduction board for grouping. */
  category: 'scene' | 'testimony' | 'document' | 'occult';
  /**
   * Hidden clues need a Beyonder ability (or a prior deduction) to surface —
   * a mundane search will not find them.
   */
  hidden?: boolean;
}

export interface DeductionData {
  id: string;
  title: string;
  text: string;
  /** Clue ids that must all be selected together on the board. */
  requires: string[];
  effect?: Effect;
  /** Clues revealed by reaching this conclusion. */
  unlocksClues?: string[];
}

export interface ObjectiveData {
  id: string;
  text: string;
  /** Objective completes when this condition holds. */
  completeWhen: Condition;
  optional?: boolean;
}

export interface ResolutionData {
  id: string;
  grade: ResolutionGrade;
  label: string;
  /** Accusation text shown when this resolution is chosen. */
  summary: string;
  /** Every listed deduction must be formed for this option to be selectable. */
  requiresDeductions?: string[];
  requires?: Condition;
  /** Paid on top of the case's base reward. Can be negative. */
  bonusPence?: number;
  effect?: Effect;
  epilogue: string;
}

export interface CaseData {
  id: string;
  title: string;
  client: string;
  /** Sequence rank the case is tuned for. */
  recommendedSequence: number;
  briefing: string;
  /** Base reward in pence, paid on any non-failed resolution. */
  rewardPence: number;
  /** Map ids this case unlocks for travel while active. */
  maps: string[];
  /** Gate for the case appearing on the club's board. */
  requires?: Condition;
  objectives: ObjectiveData[];
  clues: ClueData[];
  deductions: DeductionData[];
  resolutions: ResolutionData[];
}

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

/**
 * Hub fixtures do something other than yield clues: they open a UI. A hotspot
 * with an `action` never shows the examine panel.
 */
export type HotspotAction = 'case_board' | 'shop' | 'ritual' | 'rest' | 'resolve';

export interface HotspotData {
  id: string;
  /** Tile coordinates. */
  x: number;
  y: number;
  name: string;
  /** Shown on examine. */
  description: string;
  /** Opens a UI instead of the examine panel. */
  action?: HotspotAction;
  /** Clues granted by a plain examine. */
  clues?: string[];
  /**
   * Clues that only an ability can surface, keyed by the ability effect kind
   * that works here (e.g. "reveal_clue": ["clue_residue"]).
   */
  abilityClues?: Partial<Record<AbilityEffectKind, string[]>>;
  /** Blocked until the condition passes or an unlock_access ability is used. */
  locked?: { reason: string; bypass?: Condition };
  effect?: Effect;
  /** Icon index for the world marker. */
  icon?: number;
}

export interface MapNpcData {
  id: string;
  x: number;
  y: number;
  dialogue: string;
  /** NPC only present when this passes. */
  requires?: Condition;
  /** Wander radius in tiles; 0 for stationary. */
  wander?: number;
}

export interface MapExitData {
  x: number;
  y: number;
  toMap: string;
  /** Spawn tile in the destination map. */
  toX: number;
  toY: number;
  label: string;
  requires?: Condition;
}

export interface MapLegendEntry {
  /** Floor tile index into the tileset. */
  floor: number;
  /** Optional object tile drawn above the floor. */
  object?: number;
  collide?: boolean;
}

export interface MapData {
  id: string;
  name: string;
  /** Ambient tint applied to the scene, e.g. "#1b2030". */
  ambient?: string;
  legend: Record<string, MapLegendEntry>;
  /** ASCII rows keyed by the legend. All rows must be the same length. */
  rows: string[];
  spawn: { x: number; y: number };
  hotspots?: HotspotData[];
  npcs?: MapNpcData[];
  exits?: MapExitData[];
}

// ---------------------------------------------------------------------------
// Content index
// ---------------------------------------------------------------------------

export interface ContentIndex {
  pathways: string[];
  abilities: string[];
  cases: string[];
  maps: string[];
  dialogue: string[];
  items: string;
  characters: string;
}
