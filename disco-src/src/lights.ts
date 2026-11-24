import { Container, Sprite, Texture } from "pixi.js";
import { SCENE_LAYERS } from "./layers";
import { TextureCache } from "./texture-cache";
import type { DiscoConfig, LightConfig } from "./types";

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface ColorState {
  current: RgbColor;
  from: RgbColor;
  to: RgbColor;
  transitionStartedAt: number;
  transitionEndsAt: number;
  nextChangeAt: number;
}

interface LightNode {
  root: Container;
  beam: Sprite;
  baseX: number;
  phase: number;
  swayRate: number;
  color: ColorState;
}

const DEFAULT_LIGHT_COLORS = ["#32dfff", "#ff4fca"];
const SWAY_RATES = [0.73, 1.17, 0.91, 1.31, 1.03, 1.41];

export class LightRig {
  private readonly behind = new Container();
  private readonly front = new Container();
  private readonly textureCache = new TextureCache<"beam" | "wash", Texture>((kind) =>
    createLightTexture(kind),
  );
  private readonly nodes: LightNode[] = [];
  private readonly backgroundWash: Sprite;
  private readonly frontWash: Sprite;
  private readonly backgroundWashColor: ColorState;
  private readonly frontWashColor: ColorState;
  private config: DiscoConfig;
  private quality = 1;
  private elapsed = 0;

  constructor(parent: Container, config: DiscoConfig) {
    this.config = config;
    this.behind.zIndex = SCENE_LAYERS.backgroundLight;
    this.front.zIndex = SCENE_LAYERS.frontLight;
    parent.addChild(this.behind, this.front);
    this.backgroundWash = new Sprite(this.textureCache.get("wash"));
    this.backgroundWash.anchor.set(0.5, 0);
    this.backgroundWash.blendMode = "add";
    this.behind.addChild(this.backgroundWash);
    this.frontWash = new Sprite(this.textureCache.get("wash"));
    this.frontWash.anchor.set(0.5);
    this.frontWash.blendMode = "add";
    this.front.addChild(this.frontWash);
    this.backgroundWashColor = createColorState(
      requiredColor(config.lights.background_wash.color, "#6d4cff"),
    );
    this.frontWashColor = createColorState(requiredColor("#ff65d8", "#ff65d8"));
    this.rebuild(config.lights);
  }

  setConfig(config: DiscoConfig): void {
    this.config = config;
    if (lightCount(config.lights) !== this.nodes.length) {
      this.rebuild(config.lights);
    }
  }

  setQuality(quality: number): void {
    this.quality = quality;
    this.nodes.forEach((node, index) => {
      node.root.visible = quality > 0.5 || index % 2 === 0;
    });
    this.front.alpha = quality > 0.5 ? 1 : 0.55;
  }

  get nodeCount(): number {
    return this.nodes.length;
  }

  update(deltaMs: number): void {
    this.elapsed += deltaMs / 1000;
    const lights = this.config.lights;
    const palette = parsePalette(lights.colors);
    const topY = finiteNumber(lights.top_y, 0);
    const swaySpeed = Math.max(0.05, finiteNumber(lights.sway_speed, 1));
    const swayAmount = Math.max(0, finiteNumber(lights.drift_x, 0)) * qualityScale(this.quality);
    this.nodes.forEach((node, index) => {
      const t = this.elapsed + node.phase;
      node.root.x = lights.sway_enabled
        ? node.baseX + Math.sin(this.elapsed * swaySpeed * node.swayRate + node.phase) * swayAmount
        : node.baseX;
      node.root.y = topY;
      const breath = Math.sin(t * 0.46 + index * 0.7) * finiteNumber(lights.breath, 0) * qualityScale(this.quality);
      node.beam.alpha = lights.base_alpha * (1 + breath);
      const color = resolveColorState(
        node.color,
        palette[index % palette.length],
        palette,
        this.elapsed,
        index + 11,
        lights.random_colors,
      );
      node.beam.tint = rgbNumber(color);
    });
    const wash = lights.background_wash;
    this.backgroundWash.position.set(finiteNumber(wash.x, 1920), topY);
    this.backgroundWash.width = wash.width;
    this.backgroundWash.height = wash.height;
    this.backgroundWash.tint = rgbNumber(
      resolveColorState(
        this.backgroundWashColor,
        requiredColor(wash.color, "#6d4cff"),
        palette,
        this.elapsed,
        101,
        lights.random_colors,
      ),
    );
    this.backgroundWash.alpha = wash.alpha;
    this.frontWash.position.set(1920, topY + 670);
    this.frontWash.width = 3500;
    this.frontWash.height = 720;
    this.frontWash.tint = rgbNumber(
      resolveColorState(
        this.frontWashColor,
        requiredColor("#ff65d8", "#ff65d8"),
        palette,
        this.elapsed,
        211,
        lights.random_colors,
      ),
    );
    this.frontWash.alpha = lights.front_alpha;
  }

  private rebuild(lights: LightConfig): void {
    for (const node of this.nodes) {
      node.root.destroy({ children: true, texture: false });
    }
    this.nodes.length = 0;
    const count = lightCount(lights);
    const colors = parsePalette(lights.colors);
    for (let index = 0; index < count; index += 1) {
      const root = new Container();
      const beam = new Sprite(this.textureCache.get("beam"));
      beam.anchor.set(0.5, 0);
      beam.width = 760;
      beam.height = 1010;
      beam.tint = rgbNumber(colors[index % colors.length]);
      beam.blendMode = "add";
      root.addChild(beam);
      const baseX = 520 + (index * 2800) / Math.max(1, count - 1);
      root.x = baseX;
      root.y = finiteNumber(lights.top_y, 0);
      this.behind.addChild(root);
      this.nodes.push({
        root,
        beam,
        baseX,
        phase: index * 2.17 + noise(index + 31) * Math.PI * 2,
        swayRate: SWAY_RATES[index % SWAY_RATES.length],
        color: createColorState(colors[index % colors.length]),
      });
    }
    this.setQuality(this.quality);
  }
}

function lightCount(lights: LightConfig): number {
  return Math.min(6, Math.max(4, Math.round(finiteNumber(lights.count, 5))));
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parsePalette(values: unknown): RgbColor[] {
  const source = Array.isArray(values) ? values : [];
  const parsed = source
    .map((value) => parseColor(value, ""))
    .filter((value): value is RgbColor => value !== null);
  if (!parsed.length) {
    return DEFAULT_LIGHT_COLORS.map((color) => parseColor(color, "#ffffff")!);
  }
  return parsed;
}

function parseColor(value: unknown, fallback: string): RgbColor | null {
  const raw = String(value ?? "").trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (match) {
    const hex = match[1].length === 3
      ? match[1].split("").map((part) => part + part).join("")
      : match[1];
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }
  if (!fallback || raw === fallback) {
    return null;
  }
  return parseColor(fallback, "");
}

function requiredColor(value: unknown, fallback: string): RgbColor {
  return parseColor(value, fallback) ?? parseColor(fallback, "") ?? { r: 255, g: 255, b: 255 };
}

function createColorState(color: RgbColor): ColorState {
  return {
    current: { ...color },
    from: { ...color },
    to: { ...color },
    transitionStartedAt: 0,
    transitionEndsAt: 0,
    nextChangeAt: 0,
  };
}

function resolveColorState(
  state: ColorState,
  inactiveColor: RgbColor,
  palette: RgbColor[],
  now: number,
  seed: number,
  enabled: boolean,
): RgbColor {
  if (!enabled) {
    state.current = { ...inactiveColor };
    state.from = { ...inactiveColor };
    state.to = { ...inactiveColor };
    state.transitionStartedAt = 0;
    state.transitionEndsAt = 0;
    state.nextChangeAt = 0;
    return state.current;
  }
  if (state.nextChangeAt === 0) {
    state.current = { ...inactiveColor };
    state.from = { ...inactiveColor };
    state.to = { ...inactiveColor };
    state.transitionStartedAt = now;
    state.transitionEndsAt = now;
    state.nextChangeAt = now + 0.2 + noise(seed) * 1.6;
  }
  if (now >= state.nextChangeAt) {
    state.from = { ...state.current };
    state.to = pickDifferentColor(palette, state.current, seed + Math.floor(now * 10));
    state.transitionStartedAt = now;
    state.transitionEndsAt = now + 1.5 + noise(seed * 7 + Math.floor(now * 10)) * 1;
    state.nextChangeAt = state.transitionEndsAt + 1 + noise(seed * 13 + Math.floor(now * 10)) * 2.5;
  }
  if (now < state.transitionEndsAt) {
    const duration = Math.max(0.001, state.transitionEndsAt - state.transitionStartedAt);
    const progress = smoothstep(
      0,
      1,
      Math.min(1, Math.max(0, (now - state.transitionStartedAt) / duration)),
    );
    state.current = mixColor(state.from, state.to, progress);
  } else {
    state.current = { ...state.to };
  }
  return state.current;
}

function pickDifferentColor(palette: RgbColor[], current: RgbColor, seed: number): RgbColor {
  if (palette.length <= 1) {
    return { ...palette[0] };
  }
  const start = Math.floor(noise(seed) * palette.length) % palette.length;
  for (let offset = 0; offset < palette.length; offset += 1) {
    const candidate = palette[(start + offset) % palette.length];
    if (rgbNumber(candidate) !== rgbNumber(current)) {
      return { ...candidate };
    }
  }
  return { ...palette[0] };
}

function mixColor(from: RgbColor, to: RgbColor, amount: number): RgbColor {
  return {
    r: Math.round(from.r + (to.r - from.r) * amount),
    g: Math.round(from.g + (to.g - from.g) * amount),
    b: Math.round(from.b + (to.b - from.b) * amount),
  };
}

function rgbNumber(color: RgbColor): number {
  return (color.r << 16) | (color.g << 8) | color.b;
}

function noise(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function qualityScale(quality: number): number {
  return quality > 0.5 ? 1 : 0.45;
}

function createLightTexture(kind: "beam" | "wash"): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 1024;
  const context = canvas.getContext("2d")!;
  if (kind === "beam") {
    drawBeamCone(context, canvas.width, canvas.height);
  } else {
    drawWashGlow(context, canvas.width, canvas.height);
  }
  return Texture.from(canvas);
}

function drawBeamCone(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  context.clearRect(0, 0, width, height);
  const image = context.createImageData(width, height);
  const data = image.data;
  const center = (width - 1) / 2;
  const apexHalfWidth = width * 0.045;
  const baseHalfWidth = width * 0.48;
  const maxAlpha = 190;

  for (let y = 0; y < height; y += 1) {
    const progress = y / (height - 1);
    const beamProgress = progress;
    const halfWidth =
      apexHalfWidth +
      (baseHalfWidth - apexHalfWidth) * Math.pow(beamProgress, 0.76);
    const apexFade = smoothstep(0, 0.018, beamProgress);
    const tailFade = 1 - smoothstep(0.8, 1, beamProgress);
    const longitudinal = (1 - beamProgress * 0.42) * apexFade * tailFade;
    if (longitudinal <= 0) {
      continue;
    }

    for (let x = 0; x < width; x += 1) {
      const lateralDistance = Math.abs(x + 0.5 - center) / halfWidth;
      if (lateralDistance >= 1) {
        continue;
      }
      const softWide = 1 - smoothstep(0.12, 1, lateralDistance);
      const softCore = 1 - smoothstep(0, 0.58, lateralDistance);
      const lateral = softWide * 0.72 + softCore * 0.28;
      const index = (y * width + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(maxAlpha * longitudinal * lateral);
    }
  }

  context.putImageData(image, 0, 0);
  clearTextureEdges(context, width, height);
}

function drawWashGlow(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  context.clearRect(0, 0, width, height);
  const radial = context.createRadialGradient(
    width / 2,
    420,
    0,
    width / 2,
    420,
    360,
  );
  radial.addColorStop(0, "rgba(255,255,255,0.95)");
  radial.addColorStop(0.25, "rgba(255,255,255,0.68)");
  radial.addColorStop(0.6, "rgba(255,255,255,0.2)");
  radial.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = radial;
  context.fillRect(0, 0, width, height);

  context.globalCompositeOperation = "destination-in";
  const vertical = context.createLinearGradient(0, 0, 0, height);
  vertical.addColorStop(0, "rgba(255,255,255,0)");
  vertical.addColorStop(0.02, "rgba(255,255,255,1)");
  vertical.addColorStop(0.82, "rgba(255,255,255,1)");
  vertical.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = vertical;
  context.fillRect(0, 0, width, height);

  const horizontal = context.createLinearGradient(0, 0, width, 0);
  horizontal.addColorStop(0, "rgba(255,255,255,0)");
  horizontal.addColorStop(0.16, "rgba(255,255,255,1)");
  horizontal.addColorStop(0.84, "rgba(255,255,255,1)");
  horizontal.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = horizontal;
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = "source-over";

  clearTextureEdges(context, width, height);
}

function clearTextureEdges(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  context.clearRect(0, 0, width, 1);
  context.clearRect(0, height - 1, width, 1);
  context.clearRect(0, 0, 1, height);
  context.clearRect(width - 1, 0, 1, height);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
