import type { BandConfig, CameraState, DiscoConfig, WorldConfig } from "./types";

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

export function clampToBand(band: BandConfig, x: number, y: number): { x: number; y: number } {
  return {
    x: clamp(x, band.x[0], band.x[1]),
    y: clamp(y, band.y[0], band.y[1]),
  };
}

export function bandScale(band: BandConfig, y: number): number {
  const span = Math.max(1, band.y[1] - band.y[0]);
  const progress = clamp((y - band.y[0]) / span, 0, 1);
  return lerp(band.scale[0], band.scale[1], progress);
}

export function layerZ(config: DiscoConfig, bandName: "mid" | "near", y: number): number {
  return config.bands[bandName].z * 10000 + y;
}
