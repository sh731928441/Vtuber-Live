import type { DiscoConfig } from "./types";

export const FALLBACK_CONFIG: DiscoConfig = {
  enabled: true,
  debug: false,
  command_prefix: "/disco",
  max_characters: 100,
  character_ttl_minutes: 10,
  bubble_max_chars: 50,
  move_step: 20,
  world: { width: 3840, height: 1080, viewport_width: 1920, viewport_height: 1080 },
  dance_floor: {
    x: [140, 3700],
    y: [620, 1040],
    scale: [0.4, 0.64],
    brightness: [0.88, 1],
  },
  skins: [
    { id: "default", path: "/disco/assets/role/default.png", scale: 1 },
    { id: "dog1", path: "/disco/assets/role/dog1.gif", scale: 1 },
    { id: "dog2", path: "/disco/assets/role/dog2.gif", scale: 1 },
    { id: "dog3", path: "/disco/assets/role/dog3.gif", scale: 1 },
    { id: "dog4", path: "/disco/assets/role/dog4.gif", scale: 1 },
    { id: "dsh1", path: "/disco/assets/role/dsh1.png", scale: 1 },
  ],
  resources: {
    ceilingWall: resource("/disco/assets/scene/ceiling-wall.svg", 1920, 540, 3840, 1080),
    djBooth: resource("/disco/assets/scene/dj-booth.svg", 1920, 530, 380, 160),
  },
  items: [],
  lights: {
    count: 5,
    base_alpha: 0.38,
    breath: 0.1,
    drift_x: 46,
    drift_y: 14,
    colors: ["#31d7ff", "#ff4fca", "#7c62ff", "#ffb347", "#35f2c4"],
    background_wash: {
      color: "#6d4cff",
      alpha: 0.15,
      width: 2800,
      height: 720,
      x: 1920,
      y: 300,
    },
    front_alpha: 0.12,
  },
  camera: {
    start: { x: 1920, y: 540, zoom: 1 },
    zoom: [1, 2],
    free_pan_enabled: true,
    free_pan_seconds: 30,
    manual_resume_seconds: 8,
    gift_coalesce_ms: 5000,
    gift_min_value: 0,
    character_shot: { zoom: 1.6, transition_ms: 1000, hold_ms: 3500, priority: 2 },
    dj_shot: { x: 1920, y: 370, zoom: 1.35, transition_ms: 1000, hold_ms: 4000, priority: 3 },
  },
};

function resource(path: string, x: number, y: number, width: number, height: number) {
  return {
    path,
    x,
    y,
    width,
    height,
    lock_aspect: true,
    scale_x: 1,
    scale_y: 1,
    origin_x: 0.5,
    origin_y: 0.5,
    opacity: 1,
    tint: "#ffffff",
  };
}
