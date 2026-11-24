export interface WorldConfig {
  width: number;
  height: number;
  viewport_width: number;
  viewport_height: number;
}

export interface DanceFloorConfig {
  x: [number, number];
  y: [number, number];
  scale: [number, number];
  brightness: [number, number];
}

export interface ResourceSpec {
  id?: string;
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lock_aspect: boolean;
  flip_x?: boolean;
  scale_x: number;
  scale_y: number;
  origin_x: number;
  origin_y: number;
  opacity: number;
  tint: string;
  visible?: boolean;
}

export interface SceneItemSpec extends ResourceSpec {
  id: string;
}

export interface SkinSpec {
  id: string;
  path: string;
  scale: number;
}

export interface LightConfig {
  top_y: number;
  sway_enabled: boolean;
  sway_speed: number;
  random_colors: boolean;
  count: number;
  base_alpha: number;
  breath: number;
  drift_x: number;
  drift_y: number;
  colors: string[];
  background_wash: {
    color: string;
    alpha: number;
    width: number;
    height: number;
    x: number;
    y: number;
  };
  front_alpha: number;
}

export interface ShotConfig {
  x?: number;
  y?: number;
  zoom: number;
  transition_ms: number;
  hold_ms: number;
  priority: number;
}

export interface CameraConfig {
  start: { x: number; y: number; zoom: number };
  zoom: [number, number];
  free_pan_enabled: boolean;
  free_pan_seconds: number;
  manual_resume_seconds: number;
  gift_coalesce_ms: number;
  gift_min_value: number;
  character_shot: ShotConfig;
  dj_shot: ShotConfig;
}

export interface DiscoConfig {
  enabled: boolean;
  debug: boolean;
  command_prefix: string;
  max_characters: number;
  character_ttl_minutes: number;
  bubble_max_chars: number;
  move_step: number;
  world: WorldConfig;
  dance_floor: DanceFloorConfig;
  skins: SkinSpec[];
  resources: Record<string, ResourceSpec>;
  items: SceneItemSpec[];
  lights: LightConfig;
  camera: CameraConfig;
}

export interface CharacterBubble {
  text: string;
  ttlMs: number;
  expiresAt: number;
}

export type CharacterKind = "viewer" | "npc";

export interface DiscoCharacter {
  uid: string;
  platform: string;
  sourceUid: string;
  name: string;
  roleType: CharacterKind;
  x: number;
  y: number;
  skinId: string;
  bubble: CharacterBubble | null;
  direction?: "left" | "right";
}

export type DiscoAction =
  | "snapshot"
  | "create"
  | "move"
  | "say"
  | "change"
  | "focus"
  | "shot"
  | "despawn"
  | "config";

export interface DiscoMessage {
  kind: "disco";
  action: DiscoAction;
  seq: number;
  enabled?: boolean;
  count?: number;
  config?: DiscoConfig;
  characters?: DiscoCharacter[];
  uid?: string;
  platform?: string;
  sourceUid?: string;
  name?: string;
  roleType?: CharacterKind;
  x?: number;
  y?: number;
  skinId?: string;
  text?: string;
  ttlMs?: number;
  expiresAt?: number;
  reason?: string;
  priority?: number;
  target?: "dj";
  direction?: "left" | "right";
}

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "closed";

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export type CameraMode = "free" | "manual" | "scripted" | "static";

export interface CameraShot {
  target: "character" | "dj";
  x: number;
  y: number;
  zoom: number;
  transitionMs: number;
  holdMs: number;
  priority: number;
  reason: string;
  uid?: string;
  requestedAt: number;
}
