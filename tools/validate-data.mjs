#!/usr/bin/env node
// Checks every file under public/data for the mistakes that JSON cannot catch
// on its own: dangling ids, unreachable clues, deductions that can never be
// formed, resolutions that can never be unlocked, and maps whose rows do not
// line up with their legend.
//
//   npm run validate:data
//
// Content is loaded at runtime, so a typo here is a black screen at play time
// rather than a compile error. This is the safety net for that.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');

const problems = [];
const warnings = [];
const fail = (message) => problems.push(message);
const warn = (message) => warnings.push(message);

const read = (relPath) => {
  const full = path.join(DATA, relPath);
  if (!fs.existsSync(full)) {
    fail(`Missing file: data/${relPath}`);
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (error) {
    fail(`Invalid JSON in data/${relPath}: ${error.message}`);
    return undefined;
  }
};

const index = read('index.json');
if (!index) {
  console.error('Cannot continue without data/index.json');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load everything the index names
// ---------------------------------------------------------------------------

const pathways = index.pathways.map((name) => read(`pathways/${name}.json`)).filter(Boolean);
const abilityFiles = index.abilities.map((name) => read(`abilities/${name}.json`)).filter(Boolean);
const cases = index.cases.map((name) => read(`cases/${name}.json`)).filter(Boolean);
const maps = index.maps.map((name) => read(`maps/${name}.json`)).filter(Boolean);
const dialogueFiles = index.dialogue.map((name) => read(`dialogue/${name}.json`)).filter(Boolean);
const encounterFiles = (index.encounters ?? [])
  .map((name) => read(`encounters/${name}.json`))
  .filter(Boolean);
const items = read(`items/${index.items}.json`) ?? [];
const characters = read(`characters/${index.characters}.json`) ?? [];
const chapters = index.story ? (read(`story/${index.story}.json`) ?? []) : [];

const abilities = abilityFiles.flat();
const dialogues = dialogueFiles.flat();
const encounters = encounterFiles.flat();

const abilityIds = new Set(abilities.map((a) => a.id));
/** Mirrors AbilityEffectKind in src/types/schema.ts. */
const EFFECT_KINDS = new Set([
  'reveal_clue',
  'reveal_truth',
  'unlock_access',
  'social_pressure',
  'disguise',
  'escape',
  'sense_danger',
  'restore_sanity',
  'practice_role',
]);
const itemIds = new Set(items.map((i) => i.id));
const characterIds = new Set(characters.map((c) => c.id));
const caseIds = new Set(cases.map((c) => c.id));
const mapIds = new Set(maps.map((m) => m.id));
const dialogueIds = new Set(dialogues.map((d) => d.id));
const allClueIds = new Set(cases.flatMap((c) => c.clues.map((clue) => clue.id)));
const allDeductionIds = new Set(cases.flatMap((c) => c.deductions.map((d) => d.id)));

// ---------------------------------------------------------------------------
// Shared reference checks
// ---------------------------------------------------------------------------

const SKILLS = new Set(['observation', 'rhetoric', 'occultism', 'streetwise']);
const METHODS = new Set(['ask_around', 'informant', 'stakeout', 'archives']);

function checkSkillCheck(check, where) {
  if (!check) return;
  if (!SKILLS.has(check.skill)) fail(`${where}: unknown skill "${check.skill}"`);
  if (typeof check.base !== 'number' || check.base < 0 || check.base > 1) {
    fail(`${where}: base odds must be between 0 and 1`);
  }
}

function checkCondition(condition, where) {
  if (!condition) return;
  for (const option of condition.anyOf ?? []) checkCondition(option, `${where} (anyOf)`);
  if (condition.skillAtLeast && !SKILLS.has(condition.skillAtLeast.skill)) {
    fail(`${where}: unknown skill "${condition.skillAtLeast.skill}"`);
  }
  if (condition.ability && !abilityIds.has(condition.ability)) {
    fail(`${where}: unknown ability "${condition.ability}"`);
  }
  if (condition.item && !itemIds.has(condition.item)) {
    fail(`${where}: unknown item "${condition.item}"`);
  }
  if (condition.clue && !allClueIds.has(condition.clue)) {
    fail(`${where}: unknown clue "${condition.clue}"`);
  }
  if (condition.deduction && !allDeductionIds.has(condition.deduction)) {
    fail(`${where}: unknown deduction "${condition.deduction}"`);
  }
  if (condition.caseState && !caseIds.has(condition.caseState.caseId)) {
    fail(`${where}: unknown case "${condition.caseState.caseId}"`);
  }
  if (condition.trustAtLeast && !characterIds.has(condition.trustAtLeast.member)) {
    fail(`${where}: unknown character "${condition.trustAtLeast.member}"`);
  }
}

function checkEffect(effect, where) {
  if (!effect) return;
  for (const id of effect.items ?? []) {
    if (!itemIds.has(id)) fail(`${where}: grants unknown item "${id}"`);
  }
  for (const id of effect.removeItems ?? []) {
    if (!itemIds.has(id)) fail(`${where}: removes unknown item "${id}"`);
  }
  for (const id of effect.clues ?? []) {
    if (!allClueIds.has(id)) fail(`${where}: grants unknown clue "${id}"`);
  }
  for (const member of Object.keys(effect.trust ?? {})) {
    if (!characterIds.has(member)) fail(`${where}: trust with unknown character "${member}"`);
  }
  for (const skill of Object.keys(effect.skills ?? {})) {
    if (!SKILLS.has(skill)) fail(`${where}: unknown skill "${skill}"`);
  }
}

// ---------------------------------------------------------------------------
// Every flag anything in the data sets, plus the ones the engine derives.
// Used to catch advancement requirements that can never be satisfied — the
// failure mode where the Sequence ladder silently dead-ends.
// ---------------------------------------------------------------------------

const settableFlags = new Set();
(function collectFlags(node) {
  if (Array.isArray(node)) {
    for (const child of node) collectFlags(child);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'flags' && Array.isArray(value)) for (const flag of value) settableFlags.add(flag);
      else collectFlags(value);
    }
  }
})([pathways, cases, maps, dialogues, encounters, items, characters]);

// AbilitySystem sets act_<sequence title>_public when a practice_role power is
// used in company; mirror that derivation rather than hard-coding the names.
for (const pathway of pathways) {
  for (const tier of pathway.sequences) {
    settableFlags.add(`act_${tier.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_public`);
  }
}
// Set by ExamineScene when a locked hotspot is forced, and by the rite.
for (const map of maps) {
  for (const hotspot of map.hotspots ?? []) settableFlags.add(`unlocked_${hotspot.id}`);
  for (const hotspot of map.hotspots ?? []) settableFlags.add(`examined_${hotspot.id}`);
}
for (const pathway of pathways) {
  for (const tier of pathway.sequences) {
    settableFlags.add(`sequence_${tier.sequence}`);
    if (tier.advancement) settableFlags.add(`forced_advance_${tier.advancement.toSequence}`);
  }
}
settableFlags.add('rent_missed');

// ---------------------------------------------------------------------------
// Pathways & abilities
// ---------------------------------------------------------------------------

for (const pathway of pathways) {
  const seen = new Set();
  for (const tier of pathway.sequences) {
    if (seen.has(tier.sequence)) fail(`${pathway.id}: duplicate Sequence ${tier.sequence}`);
    seen.add(tier.sequence);

    for (const abilityId of tier.grantsAbilities) {
      if (!abilityIds.has(abilityId)) {
        fail(`${pathway.id} Sequence ${tier.sequence}: unknown ability "${abilityId}"`);
      }
    }

    const advancement = tier.advancement;
    if (!advancement) continue;
    if (!seen.has(advancement.toSequence) && !pathway.sequences.some((s) => s.sequence === advancement.toSequence)) {
      fail(`${pathway.id} Sequence ${tier.sequence}: advances to undefined Sequence ${advancement.toSequence}`);
    }
    for (const requirement of advancement.requirements) {
      const where = `${pathway.id} Sequence ${tier.sequence} requirement "${requirement.label}"`;
      if (requirement.type === 'item') {
        const candidates = requirement.itemAnyOf ?? [requirement.itemId];
        if (candidates.length === 0) fail(`${where}: names no item`);
        for (const id of candidates) {
          if (!itemIds.has(id)) fail(`${where}: unknown item "${id}"`);
        }
      }
      if (requirement.type === 'flag' && !settableFlags.has(requirement.flag)) {
        // The ladder would dead-end here with no way forward.
        fail(`${where}: requires flag "${requirement.flag}", which nothing can set.`);
      }
      if (requirement.type === 'case_completed' && !caseIds.has(requirement.caseId)) {
        fail(`${where}: unknown case "${requirement.caseId}"`);
      }
      if (requirement.type === 'trust' && !characterIds.has(requirement.member)) {
        fail(`${where}: unknown character "${requirement.member}"`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Every pathway must be able to play the content
// ---------------------------------------------------------------------------
//
// Content names capabilities (`abilityClues`, `useAbilityEffect`), never
// abilities, so that a case works whichever pathway is reading it. That only
// holds if each pathway actually supplies every capability the content asks
// for — otherwise picking the wrong pathway at the main menu silently makes a
// case unsolvable.
const requiredEffectKinds = new Set();
(function collectEffectKinds(node) {
  if (Array.isArray(node)) {
    for (const child of node) collectEffectKinds(child);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'abilityClues' && value && typeof value === 'object') {
        for (const kind of Object.keys(value)) requiredEffectKinds.add(kind);
      } else if (key === 'useAbilityEffect' && typeof value === 'string') {
        requiredEffectKinds.add(value);
      } else collectEffectKinds(value);
    }
  }
})([cases, maps, dialogues, encounters]);

// ExamineScene reaches for these directly, whatever the case data says.
requiredEffectKinds.add('unlock_access');
// The ladder's digestion requirement can only be met by performing the role.
requiredEffectKinds.add('practice_role');

for (const pathway of pathways) {
  const supplied = new Map();
  for (const tier of pathway.sequences) {
    for (const abilityId of tier.grantsAbilities) {
      const ability = abilities.find((a) => a.id === abilityId);
      if (!ability || ability.passive) continue;
      const kind = ability.effect?.kind;
      if (kind && !supplied.has(kind)) supplied.set(kind, tier.sequence);
    }
  }
  for (const kind of requiredEffectKinds) {
    if (!supplied.has(kind)) {
      fail(`Pathway ${pathway.id}: no ability with effect "${kind}", which the content requires.`);
    }
  }
}

// The starting rung has to be self-sufficient enough to close the first case:
// a player who picks a pathway and never advances still needs to find clues,
// steady themselves, and digest the role they are wearing.
const STARTING_KINDS = ['reveal_clue', 'restore_sanity', 'practice_role'];
for (const pathway of pathways) {
  const entry = Math.max(...pathway.sequences.map((tier) => tier.sequence));
  const tier = pathway.sequences.find((candidate) => candidate.sequence === entry);
  const kinds = new Set(
    (tier?.grantsAbilities ?? [])
      .map((id) => abilities.find((a) => a.id === id))
      .filter((ability) => ability && !ability.passive)
      .map((ability) => ability.effect?.kind),
  );
  for (const kind of STARTING_KINDS) {
    if (!kinds.has(kind)) {
      fail(`Pathway ${pathway.id}: Sequence ${entry} grants no "${kind}" ability, so a fresh run cannot use it.`);
    }
  }
}

// Anything the player can buy should do something: be usable, be required by
// an advancement, or be referenced by a condition somewhere.
const referencedItems = new Set();
(function collectItems(node) {
  if (Array.isArray(node)) {
    for (const child of node) collectItems(child);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if ((key === 'item' || key === 'itemId') && typeof value === 'string') referencedItems.add(value);
      else if ((key === 'items' || key === 'removeItems' || key === 'itemAnyOf') && Array.isArray(value)) {
        for (const id of value) referencedItems.add(id);
      } else collectItems(value);
    }
  }
})([pathways, cases, maps, dialogues, encounters, characters]);

for (const item of items) {
  checkCondition(item.requires, `Item "${item.id}"`);
  if (item.use) {
    checkCondition(item.use.requires, `Item "${item.id}" use`);
    checkEffect(item.use.effect, `Item "${item.id}" use`);
  }
  if (item.pricePence === undefined) continue;
  const inert = !item.use && !referencedItems.has(item.id) && !item.sellPence;
  if (inert) {
    fail(`Item "${item.id}" can be bought but has no use, no sale value and nothing references it.`);
  }
}

for (const ability of abilities) {
  if (!pathways.some((p) => p.id === ability.pathway)) {
    fail(`Ability ${ability.id}: unknown pathway "${ability.pathway}"`);
  }
  const granted = pathways.some((p) =>
    p.sequences.some((s) => s.grantsAbilities.includes(ability.id)),
  );
  if (!granted) warn(`Ability ${ability.id} is never granted by any Sequence.`);
}

// ---------------------------------------------------------------------------
// Cases: every clue reachable, every deduction formable, every resolution live
// ---------------------------------------------------------------------------

/** Clue ids a player could actually obtain, gathered from maps and dialogue. */
const obtainableClues = new Set();
for (const map of maps) {
  for (const hotspot of map.hotspots ?? []) {
    for (const id of hotspot.clues ?? []) obtainableClues.add(id);
    for (const list of Object.values(hotspot.abilityClues ?? {})) {
      for (const id of list) obtainableClues.add(id);
    }
  }
}
for (const tree of dialogues) {
  for (const node of Object.values(tree.nodes)) {
    for (const id of node.effect?.clues ?? []) obtainableClues.add(id);
    for (const choice of node.choices ?? []) {
      for (const id of choice.effect?.clues ?? []) obtainableClues.add(id);
    }
  }
}
for (const caseData of cases) {
  for (const deduction of caseData.deductions) {
    for (const id of deduction.unlocksClues ?? []) obtainableClues.add(id);
  }
  for (const lead of caseData.leads ?? []) {
    for (const id of lead.grants ?? []) obtainableClues.add(id);
  }
}
for (const encounter of encounters) {
  for (const option of encounter.options ?? []) {
    for (const id of option.success?.effect?.clues ?? []) obtainableClues.add(id);
    for (const id of option.failure?.effect?.clues ?? []) obtainableClues.add(id);
  }
}

for (const caseData of cases) {
  const clueIds = new Set(caseData.clues.map((c) => c.id));
  const deductionIds = new Set(caseData.deductions.map((d) => d.id));

  for (const clue of caseData.clues) {
    if (!obtainableClues.has(clue.id)) {
      fail(`${caseData.id}: clue "${clue.id}" is defined but nothing grants it.`);
    }
  }

  // A deduction whose clue set collides with another's can never be told apart,
  // because the board matches an exact set.
  const signatures = new Map();
  for (const deduction of caseData.deductions) {
    for (const clueId of deduction.requires) {
      if (!clueIds.has(clueId)) {
        fail(`${caseData.id} deduction "${deduction.id}": unknown clue "${clueId}"`);
      }
    }
    if (deduction.requires.length < 2) {
      fail(`${caseData.id} deduction "${deduction.id}": needs at least two clues.`);
    }
    const signature = [...new Set(deduction.requires)].sort().join('|');
    if (signatures.has(signature)) {
      fail(
        `${caseData.id}: deductions "${deduction.id}" and "${signatures.get(signature)}" require the same clue set.`,
      );
    }
    signatures.set(signature, deduction.id);
    checkEffect(deduction.effect, `${caseData.id} deduction "${deduction.id}"`);
  }

  for (const objective of caseData.objectives) {
    checkCondition(objective.completeWhen, `${caseData.id} objective "${objective.id}"`);
  }

  let hasAlwaysAvailable = false;
  for (const resolution of caseData.resolutions) {
    for (const id of resolution.requiresDeductions ?? []) {
      if (!deductionIds.has(id)) {
        fail(`${caseData.id} resolution "${resolution.id}": unknown deduction "${id}"`);
      }
    }
    checkCondition(resolution.requires, `${caseData.id} resolution "${resolution.id}"`);
    checkEffect(resolution.effect, `${caseData.id} resolution "${resolution.id}"`);
    if ((resolution.requiresDeductions ?? []).length === 0 && !resolution.requires) {
      hasAlwaysAvailable = true;
    }
  }
  if (!hasAlwaysAvailable) {
    warn(
      `${caseData.id}: no resolution is unconditionally available — a stuck player cannot close the case.`,
    );
  }

  const leadIds = new Set();
  for (const lead of caseData.leads ?? []) {
    const where = `${caseData.id} lead "${lead.id}"`;
    if (leadIds.has(lead.id)) fail(`${where}: duplicate lead id`);
    leadIds.add(lead.id);
    if (!METHODS.has(lead.method)) fail(`${where}: unknown method "${lead.method}"`);
    for (const id of lead.grants ?? []) {
      if (!clueIds.has(id)) fail(`${where}: grants clue "${id}" that is not part of this case`);
    }
    checkSkillCheck(lead.check, where);
    checkCondition(lead.requires, where);
    checkEffect(lead.successEffect, where);
    checkEffect(lead.failureEffect, where);
    // A lead that costs nothing and cannot fail is a free clue, not legwork.
    if (!lead.costPence && !lead.days && !lead.check) {
      warn(`${where}: costs nothing and cannot fail.`);
    }
  }

  for (const mapId of caseData.maps) {
    if (!mapIds.has(mapId)) fail(`${caseData.id}: unknown map "${mapId}"`);
  }
  checkCondition(caseData.requires, `${caseData.id} requires`);
}

// ---------------------------------------------------------------------------
// Encounters
// ---------------------------------------------------------------------------

const encounterIds = new Set();
for (const encounter of encounters) {
  const where = `Encounter "${encounter.id}"`;
  if (encounterIds.has(encounter.id)) fail(`${where}: duplicate id`);
  encounterIds.add(encounter.id);
  if (!(encounter.weight > 0)) fail(`${where}: weight must be positive`);
  checkCondition(encounter.requires, where);
  for (const mapId of encounter.maps ?? []) {
    if (!mapIds.has(mapId)) fail(`${where}: unknown map "${mapId}"`);
  }
  if (!encounter.options?.length) fail(`${where}: has no options — the player would be stuck.`);

  let hasUnconditional = false;
  for (const option of encounter.options ?? []) {
    checkCondition(option.requires, `${where} option "${option.text}"`);
    checkSkillCheck(option.check, `${where} option "${option.text}"`);
    checkEffect(option.success?.effect, `${where} option "${option.text}" success`);
    checkEffect(option.failure?.effect, `${where} option "${option.text}" failure`);
    if (option.useAbility && !abilityIds.has(option.useAbility)) {
      fail(`${where}: unknown ability "${option.useAbility}"`);
    }
    if (option.useAbilityEffect && !EFFECT_KINDS.has(option.useAbilityEffect)) {
      fail(`${where}: unknown ability effect "${option.useAbilityEffect}"`);
    }
    if (!option.success) fail(`${where} option "${option.text}": missing a success outcome`);
    if (option.check && !option.failure) {
      warn(`${where} option "${option.text}": can fail but defines no failure outcome.`);
    }
    if (!option.requires && !option.useAbility && !option.useAbilityEffect && option.costPence === undefined) {
      hasUnconditional = true;
    }
  }
  if (!hasUnconditional) {
    fail(`${where}: every option is gated — a player with nothing could not leave.`);
  }
}

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

for (const map of maps) {
  const width = map.rows[0]?.length ?? 0;
  map.rows.forEach((row, y) => {
    if (row.length !== width) {
      fail(`Map ${map.id}: row ${y} is ${row.length} wide, expected ${width}.`);
    }
    for (const symbol of row) {
      if (!map.legend[symbol]) {
        fail(`Map ${map.id}: row ${y} uses "${symbol}", which is not in the legend.`);
      }
    }
  });

  const height = map.rows.length;
  const walkable = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const entry = map.legend[map.rows[y][x]];
    return Boolean(entry) && entry.collide !== true;
  };
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  const hasWalkableNeighbour = (x, y) =>
    walkable(x, y) || walkable(x + 1, y) || walkable(x - 1, y) || walkable(x, y + 1) || walkable(x, y - 1);

  if (!walkable(map.spawn.x, map.spawn.y)) {
    fail(`Map ${map.id}: spawn (${map.spawn.x},${map.spawn.y}) is not walkable.`);
  }

  const occupied = new Map();
  const claim = (x, y, what) => {
    const key = `${x},${y}`;
    if (occupied.has(key)) {
      fail(`Map ${map.id}: ${what} and ${occupied.get(key)} both sit on (${x},${y}); only one is reachable.`);
    }
    occupied.set(key, what);
  };

  for (const hotspot of map.hotspots ?? []) {
    if (!inBounds(hotspot.x, hotspot.y)) {
      fail(`Map ${map.id}: hotspot "${hotspot.id}" is outside the map.`);
    } else if (!hasWalkableNeighbour(hotspot.x, hotspot.y)) {
      fail(`Map ${map.id}: hotspot "${hotspot.id}" cannot be reached — no walkable tile beside it.`);
    }
    claim(hotspot.x, hotspot.y, `hotspot "${hotspot.id}"`);
    for (const id of hotspot.clues ?? []) {
      if (!allClueIds.has(id)) fail(`Map ${map.id} hotspot "${hotspot.id}": unknown clue "${id}"`);
    }
    for (const list of Object.values(hotspot.abilityClues ?? {})) {
      for (const id of list) {
        if (!allClueIds.has(id)) fail(`Map ${map.id} hotspot "${hotspot.id}": unknown clue "${id}"`);
      }
    }
    checkEffect(hotspot.effect, `Map ${map.id} hotspot "${hotspot.id}"`);
    checkCondition(hotspot.locked?.bypass, `Map ${map.id} hotspot "${hotspot.id}" bypass`);
  }

  for (const npc of map.npcs ?? []) {
    if (!characterIds.has(npc.id)) fail(`Map ${map.id}: unknown character "${npc.id}"`);
    if (!dialogueIds.has(npc.dialogue)) {
      fail(`Map ${map.id} npc "${npc.id}": unknown dialogue tree "${npc.dialogue}"`);
    }
    if (!walkable(npc.x, npc.y)) {
      fail(`Map ${map.id}: npc "${npc.id}" stands on a blocked tile (${npc.x},${npc.y}).`);
    }
    claim(npc.x, npc.y, `npc "${npc.id}"`);
    checkCondition(npc.requires, `Map ${map.id} npc "${npc.id}"`);
  }

  for (const exit of map.exits ?? []) {
    if (!mapIds.has(exit.toMap)) {
      fail(`Map ${map.id}: exit "${exit.label}" leads to unknown map "${exit.toMap}"`);
    }
    claim(exit.x, exit.y, `exit "${exit.label}"`);
    if (!hasWalkableNeighbour(exit.x, exit.y)) {
      fail(`Map ${map.id}: exit "${exit.label}" cannot be reached.`);
    }
    const destination = maps.find((m) => m.id === exit.toMap);
    if (destination) {
      const destWidth = destination.rows[0]?.length ?? 0;
      const row = destination.rows[exit.toY];
      const entry = row ? destination.legend[row[exit.toX]] : undefined;
      if (!row || exit.toX >= destWidth || !entry || entry.collide === true) {
        fail(
          `Map ${map.id}: exit "${exit.label}" drops the player on a blocked tile (${exit.toX},${exit.toY}) of ${exit.toMap}.`,
        );
      }
    }
    checkCondition(exit.requires, `Map ${map.id} exit "${exit.label}"`);
  }
}

// ---------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------

for (const tree of dialogues) {
  if (!characterIds.has(tree.speaker)) {
    fail(`Dialogue ${tree.id}: unknown speaker "${tree.speaker}"`);
  }
  if (!tree.nodes[tree.start]) {
    fail(`Dialogue ${tree.id}: start node "${tree.start}" does not exist.`);
  }

  const reached = new Set([tree.start]);
  const queue = [tree.start];
  while (queue.length) {
    const nodeId = queue.shift();
    const node = tree.nodes[nodeId];
    if (!node) continue;
    checkEffect(node.effect, `Dialogue ${tree.id}#${nodeId}`);
    for (const choice of node.choices ?? []) {
      if (!tree.nodes[choice.goto]) {
        fail(`Dialogue ${tree.id}#${nodeId}: choice points at missing node "${choice.goto}"`);
        continue;
      }
      checkCondition(choice.requires, `Dialogue ${tree.id}#${nodeId} choice`);
      checkEffect(choice.effect, `Dialogue ${tree.id}#${nodeId} choice`);
      if (choice.useAbility && !abilityIds.has(choice.useAbility)) {
        fail(`Dialogue ${tree.id}#${nodeId}: unknown ability "${choice.useAbility}"`);
      }
      if (choice.useAbilityEffect && !EFFECT_KINDS.has(choice.useAbilityEffect)) {
        fail(`Dialogue ${tree.id}#${nodeId}: unknown ability effect "${choice.useAbilityEffect}"`);
      }
      if (!reached.has(choice.goto)) {
        reached.add(choice.goto);
        queue.push(choice.goto);
      }
    }
  }
  for (const nodeId of Object.keys(tree.nodes)) {
    if (!reached.has(nodeId)) warn(`Dialogue ${tree.id}: node "${nodeId}" is unreachable.`);
  }
}

// ---------------------------------------------------------------------------
// The story spine
// ---------------------------------------------------------------------------

const chapterIds = new Set();
for (const [order, chapter] of chapters.entries()) {
  const where = `Chapter "${chapter.id}"`;
  if (!chapter.id) fail(`Chapter ${order}: missing id`);
  if (chapterIds.has(chapter.id)) fail(`${where}: duplicate id`);
  chapterIds.add(chapter.id);
  if (!chapter.title) fail(`${where}: missing title`);
  if (!chapter.objective) fail(`${where}: missing objective`);
  if (chapter.where && !mapIds.has(chapter.where)) {
    fail(`${where}: points at unknown map "${chapter.where}"`);
  }
  checkCondition(chapter.doneWhen, where);
  // A chapter with no completion condition is an ending, and nothing can come
  // after it — the spine would stop there for the rest of the run.
  if (!chapter.doneWhen && order !== chapters.length - 1) {
    fail(`${where}: has no doneWhen but is not the last chapter`);
  }
  for (const flag of [chapter.doneWhen?.flag, ...(chapter.doneWhen?.anyOf ?? []).map((c) => c.flag)]) {
    if (flag && !settableFlags.has(flag)) {
      fail(`${where}: waits on flag "${flag}", which nothing sets`);
    }
  }
}

// Every map named by a chapter must be reachable by walking, or the signpost
// would point at a door that does not exist.
if (chapters.length > 0) {
  const graph = new Map(maps.map((m) => [m.id, (m.exits ?? []).map((e) => e.toMap)]));
  const start = maps.find((m) => m.id === 'lodgings')?.id ?? maps[0]?.id;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    for (const next of graph.get(queue.shift()) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  for (const chapter of chapters) {
    if (chapter.where && !seen.has(chapter.where)) {
      fail(`Chapter "${chapter.id}": map "${chapter.where}" cannot be walked to from ${start}`);
    }
  }
}

// ---------------------------------------------------------------------------

for (const message of warnings) console.warn(`  warn   ${message}`);
for (const message of problems) console.error(`  ERROR  ${message}`);

const leadCount = cases.reduce((sum, c) => sum + (c.leads?.length ?? 0), 0);
console.log(
  `\n${cases.length} case(s), ${maps.length} map(s), ${dialogues.length} dialogue tree(s), ` +
    `${encounters.length} encounter(s), ${leadCount} lead(s), ` +
    `${abilities.length} abilities, ${items.length} items, ${characters.length} characters, ` +
    `${chapters.length} chapter(s)`,
);

if (problems.length) {
  console.error(`\n${problems.length} problem(s) found.`);
  process.exit(1);
}
console.log(`No problems found${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);
