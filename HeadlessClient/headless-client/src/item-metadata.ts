import * as fs from 'fs';
import * as path from 'path';

export interface ItemInfo {
  id: number;
  name: string;
  displayName?: string;
  className?: string;
  source: string;
  /** XML `<Item />`; only these participate in auto-loot desirability. */
  isItem: boolean;
  /** XML `<SlotType>`, or -1 when absent. Auto-loot slot buckets key off this. */
  slotType: number;
  /** XML `<Tier>`, or null when the tag is absent (untiered/UT items). */
  tier: number | null;
  /** XML `<BagType>`, or -1 when absent. 6 and 9 mark the UT/white-bag pool. */
  bagType: number;
  soulbound: boolean;
  consumable: boolean;
  /** XML `<Potion />`; gates the potion branch of the desirability chain. */
  potion: boolean;
  /** `<Rarity>` from pet eggs (Common/Uncommon/Rare/Legendary). */
  rarity?: string;
  /** XML `<feedPower>` (lower-case in the live asset), or 0 when absent. */
  feedPower: number;
  /** XML `<XPBonus>`, or 0 when absent. */
  xpBonus: number;
  /** Every `<Activate>` value, e.g. `UnlockSkin`, `CreatePortal`, `CreatePet`. */
  activate: readonly string[];
  /** `<QuickslotAllowed maxstack>`, or -1 when the item cannot be quick-slotted. */
  maxQuickStack: number;
  /** ObjectProperties.stackable_: stack limit minus current quantity is positive. */
  stackable: boolean;
  /**
   * Both `<Quantity>` and a "Stack limit" tooltip are present, i.e. the object
   * belongs to a stacking family even when this member is already a full stack.
   */
  stackLimited: boolean;
  /** The eight 8/8 stat caps, present only on `<Player />` class objects. */
  statMaximums?: PlayerStatMaximums;
  /** `<SlotTypes>` of a `<Player />` class object; index 0-3 are the equip slots. */
  slotTypes?: readonly number[];
}

/**
 * The `max` attribute of the eight per-class stat tags. `vitality` and `wisdom`
 * are the `HpRegen` / `MpRegen` tags, matching the asset's naming.
 */
export interface PlayerStatMaximums {
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  dexterity: number;
  vitality: number;
  wisdom: number;
}

export interface ItemRef {
  id: number;
  name?: string;
  displayName?: string;
  className?: string;
}

export class ItemCatalog {
  constructor(private readonly byId: Map<number, ItemInfo>) {}

  get size(): number {
    return this.byId.size;
  }

  ref(id: number): ItemRef {
    const item = this.byId.get(id);
    return item ? { id, name: item.name, displayName: item.displayName, className: item.className } : { id };
  }

  name(id: number): string | undefined {
    return this.byId.get(id)?.name;
  }

  /** Full metadata for an object type, or undefined when the XML was unavailable. */
  info(id: number): ItemInfo | undefined {
    return this.byId.get(id);
  }

  /** 8/8 stat caps for a class object type (`PlayerData.class`), if known. */
  statMaximums(classType: number): PlayerStatMaximums | undefined {
    return this.byId.get(classType)?.statMaximums;
  }
}

/**
 * Loads RotMG XML object metadata when available. Set ROTMG_XML_DIR to one or
 * more asset directories; otherwise common extractor output locations are
 * discovered relative to the workspace.
 */
export function loadItemCatalog(cwd = process.cwd()): ItemCatalog {
  const files = discoverXmlFiles(cwd);
  const byId = new Map<number, ItemInfo>();
  for (const file of files) {
    parseObjects(file, byId);
  }
  if (byId.size > 0) {
    console.log(`item metadata loaded: ${byId.size} object id(s) from ${files.length} xml file(s)`);
  } else {
    console.warn('item metadata unavailable - set ROTMG_XML_DIR to the extracted TextAsset xml directory');
  }
  return new ItemCatalog(byId);
}

function discoverXmlFiles(cwd: string): string[] {
  const envDirs = (process.env.ROTMG_XML_DIR ?? '')
    .split(path.delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean);
  const candidates = [
    ...envDirs,
    path.resolve(cwd, 'xml'),
    path.resolve(cwd, 'data/xml'),
    path.resolve(cwd, 'assets/xml'),
    path.resolve(cwd, '../rotmg-extractor/output'),
  ];
  const files = new Set<string>();
  for (const candidate of candidates) {
    collectXmlFiles(candidate, files, 0);
  }
  return [...files].sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
}

function collectXmlFiles(target: string, files: Set<string>, depth: number): void {
  if (depth > 8 || !fs.existsSync(target)) {
    return;
  }
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (target.endsWith('.xml') && looksUsefulXml(target)) {
      files.add(target);
    }
    return;
  }
  if (!stat.isDirectory()) {
    return;
  }
  const base = path.basename(target);
  if (base === 'node_modules' || base.startsWith('.')) {
    return;
  }
  for (const entry of fs.readdirSync(target)) {
    collectXmlFiles(path.join(target, entry), files, depth + 1);
  }
}

function looksUsefulXml(file: string): boolean {
  const name = path.basename(file).toLowerCase();
  return (
    name === 'object.xml' ||
    name === 'objects.xml' ||
    name.startsWith('equip') ||
    name.endsWith('objects.xml') ||
    ['containers.xml', 'portals.xml', 'players.xml', 'pets.xml', 'skins.xml', 'dyes.xml', 'token.xml'].includes(name)
  );
}

function priority(file: string): number {
  const name = path.basename(file).toLowerCase();
  if (name === 'equip.xml') return 0;
  if (name.startsWith('equip')) return 1;
  if (name === 'object.xml' || name === 'objects.xml') return 2;
  return 3;
}

function parseObjects(file: string, byId: Map<number, ItemInfo>): void {
  const xml = fs.readFileSync(file, 'utf8');
  const objectPattern = /<Object\b([^>]*)>([\s\S]*?)<\/Object>/g;
  let match: RegExpExecArray | null;
  while ((match = objectPattern.exec(xml))) {
    const attrs = match[1];
    const body = match[2];
    const type = readAttr(attrs, 'type');
    const id = readAttr(attrs, 'id');
    if (!type || !id) {
      continue;
    }
    const numeric = Number(type);
    if (!Number.isInteger(numeric)) {
      continue;
    }
    const displayName = readTag(body, 'DisplayId');
    const className = readTag(body, 'Class');
    const name = decodeXml(displayName || id);
    const rarity = readTag(body, 'Rarity');
    const stackHeadroom = readStackable(body);
    const isClassObject = hasTag(body, 'Player');
    byId.set(numeric, {
      id: numeric,
      name,
      displayName: displayName ? decodeXml(displayName) : undefined,
      className: className ? decodeXml(className) : undefined,
      source: path.basename(file),
      isItem: hasTag(body, 'Item'),
      slotType: readNumberTag(body, 'SlotType', -1),
      tier: readTag(body, 'Tier') === undefined ? null : readNumberTag(body, 'Tier', 0),
      bagType: readNumberTag(body, 'BagType', -1),
      soulbound: hasTag(body, 'Soulbound'),
      consumable: hasTag(body, 'Consumable'),
      potion: hasTag(body, 'Potion'),
      rarity: rarity ? decodeXml(rarity) : undefined,
      // The live asset spells this tag `feedPower`; accept both casings.
      feedPower: readNumberTag(body, 'feedPower', readNumberTag(body, 'FeedPower', 0)),
      xpBonus: readNumberTag(body, 'XPBonus', 0),
      activate: readActivateEffects(body),
      maxQuickStack: readMaxQuickStack(body),
      stackable: stackHeadroom !== null && stackHeadroom > 0,
      stackLimited: stackHeadroom !== null,
      statMaximums: isClassObject ? readStatMaximums(body) : undefined,
      slotTypes: isClassObject ? readSlotTypes(body) : undefined,
    });
  }
}

/** True when `<Name />` or `<Name>...</Name>` is present anywhere in the body. */
function hasTag(body: string, name: string): boolean {
  return new RegExp(`<${name}\\b[^>]*/>|<${name}\\b[^>]*>`).test(body);
}

function readNumberTag(body: string, name: string, fallback: number): number {
  const raw = readTag(body, name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readActivateEffects(body: string): string[] {
  const pattern = /<Activate\b[^>]*>([\s\S]*?)<\/Activate>/g;
  const effects: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body))) {
    effects.push(decodeXml(match[1].trim()));
  }
  return effects;
}

function readMaxQuickStack(body: string): number {
  const match = /<QuickslotAllowed\b([^>]*)>/.exec(body);
  if (!match) {
    return -1;
  }
  const maxStack = Number(readAttr(match[1], 'maxstack') ?? Number.NaN);
  // A bare `<QuickslotAllowed />` still permits one item in the slot.
  return Number.isFinite(maxStack) ? maxStack : 1;
}

/**
 * Mirrors ObjectProperties: an item stacks when its "Stack limit" tooltip
 * exceeds the quantity this particular object type represents. Both tags must
 * be present, matching the reference client's guard.
 *
 * Returns null when the object is not part of a stacking family at all, so
 * callers can distinguish "no stack tags" from "stack is already full".
 */
function readStackable(body: string): number | null {
  const quantity = readTag(body, 'Quantity');
  const limit = /<EffectInfo\b([^>]*name="Stack limit"[^>]*)\/>/.exec(body);
  if (quantity === undefined || !limit) {
    return null;
  }
  return Number(readAttr(limit[1], 'description') ?? 0) - Number(quantity);
}

function readStatMaximums(body: string): PlayerStatMaximums {
  return {
    maxHp: readStatMaximum(body, 'MaxHitPoints'),
    maxMp: readStatMaximum(body, 'MaxMagicPoints'),
    attack: readStatMaximum(body, 'Attack'),
    defense: readStatMaximum(body, 'Defense'),
    speed: readStatMaximum(body, 'Speed'),
    dexterity: readStatMaximum(body, 'Dexterity'),
    vitality: readStatMaximum(body, 'HpRegen'),
    wisdom: readStatMaximum(body, 'MpRegen'),
  };
}

function readSlotTypes(body: string): number[] {
  const raw = readTag(body, 'SlotTypes');
  if (raw === undefined) {
    return [];
  }
  return raw.split(',')
    .map((entry) => Number(entry.trim()))
    .map((entry) => (Number.isFinite(entry) ? Math.trunc(entry) : 0));
}

function readStatMaximum(body: string, name: string): number {
  const match = new RegExp(`<${name}\\b([^>]*)>`).exec(body);
  const value = Number(match ? readAttr(match[1], 'max') ?? Number.NaN : Number.NaN);
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function readAttr(attrs: string, name: string): string | undefined {
  const match = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return match ? decodeXml(match[1]) : undefined;
}

function readTag(body: string, name: string): string | undefined {
  const match = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`).exec(body);
  return match ? match[1].trim() : undefined;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
