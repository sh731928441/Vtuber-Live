import type { CharacterBubble, DiscoCharacter, DiscoConfig, DiscoMessage } from "./types";

export type StoreUpdate =
  | { type: "snapshot"; characters: DiscoCharacter[]; config: DiscoConfig }
  | { type: "upsert"; character: DiscoCharacter }
  | { type: "remove"; uid: string }
  | { type: "config"; config: DiscoConfig; clear: boolean }
  | { type: "focus"; uid: string; reason: string; priority: number }
  | { type: "shot"; target: "dj"; priority: number }
  | { type: "ignored"; reason: string };

export class DiscoStateStore {
  private characterMap = new Map<string, DiscoCharacter>();
  private lastSeq = 0;
  private currentConfig: DiscoConfig;

  constructor(config: DiscoConfig) {
    this.currentConfig = config;
  }

  get config(): DiscoConfig {
    return this.currentConfig;
  }

  get characters(): DiscoCharacter[] {
    return [...this.characterMap.values()];
  }

  getCharacter(uid: string): DiscoCharacter | undefined {
    return this.characterMap.get(uid);
  }

  apply(message: DiscoMessage): StoreUpdate {
    if (message.kind !== "disco" || !Number.isFinite(message.seq)) {
      return { type: "ignored", reason: "not-disco" };
    }
    if (message.seq <= this.lastSeq) {
      return { type: "ignored", reason: "stale" };
    }
    if (message.action === "snapshot") {
      this.lastSeq = message.seq;
      this.currentConfig = message.config ?? this.currentConfig;
      const now = Date.now();
      this.characterMap = new Map(
        (message.characters ?? [])
          .filter((character) => isCharacterData(character))
          .map((character) => [character.uid, normalizeCharacter(character, now)]),
      );
      return {
        type: "snapshot",
        characters: [...this.characterMap.values()],
        config: this.currentConfig,
      };
    }
    if (message.action === "config") {
      this.lastSeq = message.seq;
      this.currentConfig = message.config ?? this.currentConfig;
      const clear = message.enabled === false || !this.currentConfig.enabled;
      if (clear) {
        this.characterMap.clear();
      }
      return { type: "config", config: this.currentConfig, clear };
    }
    if (message.action === "focus" && message.uid) {
      this.lastSeq = message.seq;
      return {
        type: "focus",
        uid: message.uid,
        reason: message.reason ?? "gift",
        priority: message.priority ?? 2,
      };
    }
    if (message.action === "shot" && message.target === "dj") {
      this.lastSeq = message.seq;
      return { type: "shot", target: "dj", priority: message.priority ?? 3 };
    }
    if (message.action === "despawn" && message.uid) {
      this.lastSeq = message.seq;
      this.characterMap.delete(message.uid);
      return { type: "remove", uid: message.uid };
    }
    if (message.action === "create" && isCharacter(message)) {
      this.lastSeq = message.seq;
      const character = normalizeCharacter(message, Date.now());
      this.characterMap.set(character.uid, character);
      return { type: "upsert", character };
    }
    if (message.uid && this.characterMap.has(message.uid)) {
      const previous = this.characterMap.get(message.uid)!;
      const next = { ...previous };
      const now = Date.now();
      if (message.action !== "say") {
        clearExpiredBubble(next, now);
      }
      if (message.action === "move") {
        if (typeof message.x === "number") next.x = message.x;
        if (typeof message.y === "number") next.y = message.y;
        if (message.direction) next.direction = message.direction;
      } else if (message.action === "say" && message.text) {
        const ttlMs = Number.isFinite(message.ttlMs) && message.ttlMs! > 0
          ? message.ttlMs!
          : 4200;
        const expiresAt = Number.isFinite(message.expiresAt)
          ? message.expiresAt!
          : now + ttlMs;
        next.bubble = { text: message.text, ttlMs, expiresAt };
      } else if (message.action === "change" && message.skinId) {
        next.skinId = message.skinId;
      } else {
        return { type: "ignored", reason: "unknown-action" };
      }
      this.lastSeq = message.seq;
      this.characterMap.set(next.uid, next);
      return { type: "upsert", character: next };
    }
    return { type: "ignored", reason: "unknown-action" };
  }
}

function isCharacter(value: DiscoMessage): value is DiscoMessage & DiscoCharacter {
  return (
    typeof value.uid === "string" &&
    typeof value.name === "string" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    typeof value.skinId === "string"
  );
}

function isCharacterData(value: DiscoCharacter): value is DiscoCharacter {
  return (
    typeof value.uid === "string" &&
    typeof value.name === "string" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    typeof value.skinId === "string"
  );
}

function normalizeCharacter(character: DiscoCharacter, now = Date.now()): DiscoCharacter {
  const normalized: DiscoCharacter = {
    ...character,
    platform: character.platform ?? "bilibili",
    sourceUid: character.sourceUid ?? "",
    roleType: character.roleType === "npc" ? "npc" : "viewer",
    bubble: normalizeBubble(character.bubble, now),
    direction: character.direction ?? "left",
  };
  delete (normalized as DiscoCharacter & { band?: unknown }).band;
  return normalized;
}

function normalizeBubble(value: unknown, now: number): CharacterBubble | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const bubble = value as Partial<CharacterBubble>;
  const text = String(bubble.text ?? "");
  if (!text) {
    return null;
  }
  const ttlMs = Number.isFinite(bubble.ttlMs) && bubble.ttlMs! > 0
    ? bubble.ttlMs!
    : 4200;
  const expiresAt = Number.isFinite(bubble.expiresAt)
    ? bubble.expiresAt!
    : now + ttlMs;
  return expiresAt > now ? { text, ttlMs, expiresAt } : null;
}

function clearExpiredBubble(character: DiscoCharacter, now: number): void {
  if (character.bubble && character.bubble.expiresAt <= now) {
    character.bubble = null;
  }
}
