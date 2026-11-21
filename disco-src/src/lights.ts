import { Container, Sprite, Texture } from "pixi.js";
import { TextureCache } from "./texture-cache";
import type { DiscoConfig, LightConfig } from "./types";

interface LightNode {
  root: Container;
  wash: Sprite;
  core: Sprite;
  baseX: number;
  phase: number;
}

export class LightRig {
  private readonly behind = new Container();
  private readonly front = new Container();
  private readonly textureCache = new TextureCache<"wash" | "core", Texture>((kind) =>
    createGlowTexture(kind),
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
      node.root.y = 42 + Math.cos(t * 0.13 + index) * lights.drift_y * drift;
      const breath = Math.sin(t * 0.46 + index * 0.7) * lights.breath * drift;
      node.wash.alpha = lights.base_alpha * (1 + breath);
      node.core.alpha = 0.34 * (1 + breath * 0.65);
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
      const wash = new Sprite(this.textureCache.get("wash"));
      wash.anchor.set(0.5, 0);
      wash.width = 610;
      wash.height = 940;
      wash.tint = colors[index % colors.length];
      wash.blendMode = "add";
      const core = new Sprite(this.textureCache.get("core"));
      core.anchor.set(0.5);
      core.position.set(0, 86);
      core.width = 230;
      core.height = 230;
      core.tint = colors[index % colors.length];
      core.blendMode = "add";
      root.addChild(wash, core);
      const baseX = 520 + (index * 2800) / Math.max(1, count - 1);
      root.x = baseX;
      this.behind.addChild(root);
      this.nodes.push({ root, wash, core, baseX, phase: index * 0.91 });
    }
    this.setQuality(this.quality);
  }
}

function qualityScale(quality: number): number {
  return quality > 0.5 ? 1 : 0.45;
}

function createGlowTexture(kind: "wash" | "core"): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = kind === "core" ? 512 : 768;
  canvas.height = kind === "core" ? 512 : 1024;
  const context = canvas.getContext("2d")!;
  const gradient =
    kind === "core"
      ? context.createRadialGradient(256, 256, 0, 256, 256, 256)
      : context.createRadialGradient(384, 160, 8, 384, 500, 660);
  gradient.addColorStop(0, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.18, "rgba(255,255,255,0.65)");
  gradient.addColorStop(0.52, "rgba(255,255,255,0.18)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return Texture.from(canvas);
}
