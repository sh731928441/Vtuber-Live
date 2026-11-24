import { Container, Sprite, Texture } from "pixi.js";
import { TextureCache } from "./texture-cache";
import type { DiscoConfig, LightConfig } from "./types";

interface LightNode {
  root: Container;
  beam: Sprite;
  baseX: number;
  phase: number;
}

export class LightRig {
  private readonly behind = new Container();
  private readonly front = new Container();
  private readonly textureCache = new TextureCache<"beam" | "wash", Texture>((kind) =>
    createLightTexture(kind),
  );
  private readonly nodes: LightNode[] = [];
  private readonly backgroundWash: Sprite;
  private readonly frontWash: Sprite;
  private config: DiscoConfig;
  private quality = 1;
  private elapsed = 0;

  constructor(parent: Container, config: DiscoConfig) {
    this.config = config;
    this.behind.zIndex = 20;
    this.front.zIndex = 50;
    parent.addChild(this.behind, this.front);
    this.backgroundWash = new Sprite(this.textureCache.get("wash"));
    this.backgroundWash.anchor.set(0.5);
    this.backgroundWash.blendMode = "add";
    this.behind.addChild(this.backgroundWash);
    this.frontWash = new Sprite(this.textureCache.get("wash"));
    this.frontWash.anchor.set(0.5);
    this.frontWash.blendMode = "add";
    this.front.addChild(this.frontWash);
    this.rebuild(config.lights);
  }

  setConfig(config: DiscoConfig): void {
    this.config = config;
    this.rebuild(config.lights);
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
    this.nodes.forEach((node, index) => {
      const drift = qualityScale(this.quality);
      const t = this.elapsed + node.phase;
      node.root.x = node.baseX + Math.sin(t * 0.19) * lights.drift_x * drift;
      //  灯光的Y轴
      node.root.y = -50 + Math.cos(t * 0.13 + index) * lights.drift_y * drift;
      const breath = Math.sin(t * 0.46 + index * 0.7) * lights.breath * drift;
      node.beam.alpha = lights.base_alpha * (1 + breath);
    });
    const wash = lights.background_wash;
    this.backgroundWash.position.set(wash.x, wash.y);
    this.backgroundWash.width = wash.width;
    this.backgroundWash.height = wash.height;
    this.backgroundWash.tint = wash.color;
    this.backgroundWash.alpha = wash.alpha;
    this.frontWash.position.set(1920, 670);
    this.frontWash.width = 3500;
    this.frontWash.height = 720;
    this.frontWash.tint = 0xff65d8;
    this.frontWash.alpha = lights.front_alpha;
  }

  private rebuild(lights: LightConfig): void {
    for (const node of this.nodes) {
      node.root.destroy({ children: true, texture: false });
    }
    this.nodes.length = 0;
    const count = Math.min(6, Math.max(4, Math.round(lights.count)));
    const colors = lights.colors.length ? lights.colors : ["#32dfff", "#ff4fca"];
    for (let index = 0; index < count; index += 1) {
      const root = new Container();
      const beam = new Sprite(this.textureCache.get("beam"));
      beam.anchor.set(0.5, 0);
      beam.width = 760;
      beam.height = 1010;
      beam.tint = colors[index % colors.length];
      beam.blendMode = "add";
      root.addChild(beam);
      const baseX = 520 + (index * 2800) / Math.max(1, count - 1);
      root.x = baseX;
      this.behind.addChild(root);
      this.nodes.push({ root, beam, baseX, phase: index * 0.91 });
    }
    this.setQuality(this.quality);
  }
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
  const visibleStart = 0.012;
  const maxAlpha = 190;

  for (let y = 0; y < height; y += 1) {
    const progress = y / (height - 1);
    if (progress < visibleStart) {
      continue;
    }
    const beamProgress = (progress - visibleStart) / (1 - visibleStart);
    const halfWidth =
      apexHalfWidth +
      (baseHalfWidth - apexHalfWidth) * Math.pow(beamProgress, 0.76);
    const apexFade = smoothstep(0, 0.055, beamProgress);
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
  vertical.addColorStop(0.16, "rgba(255,255,255,1)");
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
