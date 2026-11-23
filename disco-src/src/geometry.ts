import type { CameraState, DanceFloorConfig, WorldConfig } from "./types";

export interface CameraBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

export function easeInOutCubic(value: number): number {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function cameraBounds(
  world: WorldConfig,
  viewportWidth: number,
  viewportHeight: number,
  baseScale: number,
  zoom: number,
): CameraBounds {
  const safeZoom = Math.max(0.0001, zoom);
  const visibleWidth = viewportWidth / (baseScale * safeZoom);
  const visibleHeight = viewportHeight / (baseScale * safeZoom);
  const halfWidth = Math.min(world.width / 2, visibleWidth / 2);
  const halfHeight = Math.min(world.height / 2, visibleHeight / 2);
  return {
    minX: halfWidth,
    maxX: world.width - halfWidth,
    minY: halfHeight,
    maxY: world.height - halfHeight,
  };
}

export function clampCamera(
  state: CameraState,
  world: WorldConfig,
  viewportWidth: number,
  viewportHeight: number,
  baseScale: number,
  zoomRange: [number, number],
): CameraState {
  const zoom = clamp(state.zoom, zoomRange[0], zoomRange[1]);
  const bounds = cameraBounds(world, viewportWidth, viewportHeight, baseScale, zoom);
  return {
    x: clamp(state.x, bounds.minX, bounds.maxX),
    y: clamp(state.y, bounds.minY, bounds.maxY),
    zoom,
  };
}

export function clampToDanceFloor(
  floor: DanceFloorConfig,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: clamp(x, floor.x[0], floor.x[1]),
    y: clamp(y, floor.y[0], floor.y[1]),
  };
}

export function danceFloorScale(floor: DanceFloorConfig, y: number): number {
  const span = Math.max(1, floor.y[1] - floor.y[0]);
  const progress = clamp((y - floor.y[0]) / span, 0, 1);
  return lerp(floor.scale[0], floor.scale[1], progress);
}

export function danceFloorBrightness(floor: DanceFloorConfig, y: number): number {
  const span = Math.max(1, floor.y[1] - floor.y[0]);
  const progress = clamp((y - floor.y[0]) / span, 0, 1);
  return lerp(floor.brightness[0], floor.brightness[1], progress);
}

export function layerZ(y: number): number {
  return y;
}
