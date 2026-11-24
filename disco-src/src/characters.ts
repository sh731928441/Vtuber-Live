import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { danceFloorBrightness, danceFloorScale, layerZ } from "./geometry";
import { loadResourceManifest, type ResourceError } from "./resources";
import type { DiscoCharacter, DiscoConfig } from "./types";

interface VisibleBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function fitSkinScale(width: number, height: number): number {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return 1;
  }
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  return Math.min(180 / safeWidth, 220 / safeHeight);
}

export class CharacterLayer {
  readonly dancers: Container;
  private readonly views = new Map<string, CharacterView>();
  private readonly textures = new Map<string, Texture>();
  private fallbackTexture: Texture;
  private config: DiscoConfig;
  private degraded = false;

  constructor(parent: Container, config: DiscoConfig) {
    this.config = config;
    this.dancers = new Container();
    this.dancers.sortableChildren = true;
    this.dancers.zIndex = 30;
    parent.addChild(this.dancers);
    this.fallbackTexture = makeFallbackCharacterTexture();
  }

  async loadSkins(onErrors?: (errors: ResourceError[]) => void): Promise<void> {
    this.textures.clear();
    const skins = Array.isArray(this.config.skins) ? this.config.skins : [];
    const resources = Object.fromEntries(
      skins.map((skin) => [
        skin.id,
        {
          path: skin.path,
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          lock_aspect: false,
          scale_x: 1,
          scale_y: 1,
          origin_x: 0.5,
          origin_y: 1,
          opacity: 1,
          tint: "#ffffff",
        },
      ]),
    );
    const result = await loadResourceManifest<HTMLImageElement>(resources, async (path) => {
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const image = new Image();
      const url = URL.createObjectURL(blob);
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("角色皮肤图片解码失败"));
        image.src = url;
      }).finally(() => URL.revokeObjectURL(url));
      return image;
    });
    for (const [id, image] of result.assets) {
      this.textures.set(id, Texture.from(image));
    }
    for (const view of this.views.values()) {
      view.setTexture(
        this.textures.get(view.model.skinId) ?? this.fallbackTexture,
        this.skinScale(view.model.skinId),
      );
    }
    onErrors?.(result.errors);
  }

  setConfig(config: DiscoConfig): void {
    this.config = config;
    for (const character of this.views.values()) {
      character.setTexture(
        this.textures.get(character.model.skinId) ?? this.fallbackTexture,
        this.skinScale(character.model.skinId),
      );
      character.applyVisualConfig(config);
    }
  }

  upsert(character: DiscoCharacter, animate = true): void {
    const existing = this.views.get(character.uid);
    if (existing) {
      existing.updateCharacter(character, animate);
      existing.setTexture(
        this.textures.get(character.skinId) ?? this.fallbackTexture,
        this.skinScale(character.skinId),
      );
      return;
    }
    const texture = this.textures.get(character.skinId) ?? this.fallbackTexture;
    const view = new CharacterView(character, texture, this.config, this.skinScale(character.skinId));
    this.views.set(character.uid, view);
    this.dancers.addChild(view.container);
    this.sort(view);
  }

  replaceAll(characters: DiscoCharacter[]): void {
    for (const view of this.views.values()) {
      view.container.destroy({ children: true, texture: false });
    }
    this.dancers.removeChildren();
    this.views.clear();
    for (const character of characters) {
      this.upsert(character, false);
    }
  }

  remove(uid: string): void {
    const view = this.views.get(uid);
    if (!view) {
      return;
    }
    view.container.destroy({ children: true, texture: false });
    this.views.delete(uid);
  }

  clear(): void {
    this.replaceAll([]);
  }

  get count(): number {
    return this.views.size;
  }

  setDegraded(degraded: boolean): void {
    this.degraded = degraded;
  }

  update(deltaMs: number, now: number, bounds: VisibleBounds): void {
    let index = 0;
    this.views.forEach((view) => {
      const viewIndex = index;
      index += 1;
      const character = view.model;
      const margin = 180;
      const visible =
        character.x >= bounds.x - margin &&
        character.x <= bounds.x + bounds.width + margin &&
        character.y >= bounds.y - margin &&
        character.y <= bounds.y + bounds.height + margin;
      if (!visible && (this.degraded || viewIndex % 4 !== 0)) {
        return;
      }
      view.update(deltaMs, now, this.degraded);
      this.sort(view);
    });
  }

  focusPoint(uid: string): { x: number; y: number } | undefined {
    const character = this.views.get(uid)?.model;
    return character ? { x: character.x, y: character.y } : undefined;
  }

  private sort(view: CharacterView): void {
    view.container.zIndex = layerZ(view.model.y);
  }

  private skinScale(skinId: string): number {
    const skin = this.config.skins.find((entry) => entry.id === skinId);
    const scale = Number(skin?.scale);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }
}

class CharacterView {
  readonly container = new Container();
  readonly model: DiscoCharacter;
  private readonly sprite: Sprite;
  private readonly fallback: Graphics | null;
  private readonly name: Text;
  private readonly bubble: Container;
  private readonly bubbleBackground = new Graphics();
  private readonly bubbleText: Text;
  private targetX: number;
  private targetY: number;
  private baseScale = 1;
  private textureScale = 1;
  private artHeight = 176;
  private phase = Math.random() * Math.PI * 2;
  private bubbleExpiresAt = 0;
  private bubbleSignature = "";
  private config: DiscoConfig;

  constructor(character: DiscoCharacter, texture: Texture, config: DiscoConfig, skinScale = 1) {
    this.model = { ...character };
    this.targetX = character.x;
    this.targetY = character.y;
    this.config = config;
    this.container.position.set(character.x, character.y);

    if (texture === FALLBACK_TEXTURE_HOLDER.current) {
      this.sprite = new Sprite();
      this.sprite.visible = false;
      this.fallback = makeFallbackGraphics();
    } else {
      this.sprite = new Sprite(texture);
      this.sprite.anchor.set(0.5, 1);
      this.textureScale = fitSkinScale(texture.width, texture.height) * skinScale;
      this.sprite.scale.set(this.textureScale);
      this.fallback = null;
    }
    this.container.addChild(this.fallback ?? this.sprite);
    if (this.fallback) {
      this.fallback.position.set(-54, -176);
    }
    this.artHeight = this.fallback ? 176 : texture.height * this.textureScale;

    this.name = new Text({
      text: character.name,
      style: {
        fontFamily: '"Microsoft YaHei UI", "PingFang SC", sans-serif',
        fontSize: 15,
        fontWeight: "600",
        fill: 0xffffff,
        stroke: { color: 0x09030f, width: 4 },
        align: "center",
      },
    });
    this.name.anchor.set(0.5, 0);
    this.name.y = 6;
    this.container.addChild(this.name);

    this.bubble = new Container();
    this.bubbleText = new Text({
      text: "",
      style: {
        fontFamily: '"Microsoft YaHei UI", "PingFang SC", sans-serif',
        fontSize: 14,
        fontWeight: "600",
        fill: 0x292032,
        wordWrap: true,
        wordWrapWidth: 220,
        breakWords: true,
        align: "center",
      },
    });
    this.bubble.addChild(this.bubbleBackground, this.bubbleText);
    this.updateBubblePosition();
    this.bubble.visible = false;
    this.container.addChild(this.bubble);

    this.applyVisualConfig(config);
    this.updateCharacter(character, false);
  }

  updateCharacter(character: DiscoCharacter, animate: boolean): void {
    Object.assign(this.model, character);
    this.targetX = character.x;
    this.targetY = character.y;
    this.name.text = character.name;
    this.container.alpha = danceFloorBrightness(this.config.dance_floor, character.y);
    if (!animate) {
      this.container.position.set(character.x, character.y);
    }
    this.sprite.scale.x = this.textureScale * (character.direction === "right" ? -1 : 1);
    const bubble = character.bubble;
    if (!bubble) {
      this.hideBubble();
    } else if (bubble.expiresAt <= Date.now()) {
      this.hideBubble();
    } else {
      const signature = `${bubble.expiresAt}\0${bubble.text}`;
      if (!this.bubble.visible || this.bubbleSignature !== signature) {
        this.showBubble(bubble.text, bubble.expiresAt);
      }
    }
  }

  setTexture(texture: Texture, skinScale = 1): void {
    if (!this.fallback) {
      this.sprite.texture = texture;
      this.textureScale = fitSkinScale(texture.width, texture.height) * skinScale;
      this.artHeight = texture.height * this.textureScale;
      this.sprite.scale.set(this.textureScale);
      this.sprite.scale.x = this.textureScale * (this.model.direction === "right" ? -1 : 1);
      this.updateBubblePosition();
    }
  }

  applyVisualConfig(config: DiscoConfig): void {
    this.config = config;
    this.baseScale = danceFloorScale(config.dance_floor, this.model.y);
    this.container.scale.set(this.baseScale);
    this.name.style.fill = 0xffffff;
    this.container.alpha = danceFloorBrightness(config.dance_floor, this.model.y);
  }

  update(deltaMs: number, now: number, degraded: boolean): void {
    const amount = Math.min(1, deltaMs / 110);
    this.container.x += (this.targetX - this.container.x) * amount;
    this.container.y += (this.targetY - this.container.y) * amount;
    this.model.x = this.container.x;
    this.model.y = this.container.y;
    this.baseScale = danceFloorScale(this.config.dance_floor, this.container.y);
    this.container.alpha = danceFloorBrightness(this.config.dance_floor, this.container.y);

    const t = now / 1000 + this.phase;
    const jump = degraded ? 0 : Math.abs(Math.sin(t * 3.2)) * 7;
    const sway = degraded ? 0 : Math.sin(t * 2.15) * 3;
    const squash = degraded ? 0 : Math.sin(t * 4.2) * 0.018;
    this.container.scale.set(this.baseScale * (1 + squash), this.baseScale * (1 - squash * 0.7));
    if (!this.fallback) {
      this.sprite.y = -jump;
      this.sprite.rotation = sway * 0.005;
    }
    if (this.bubble.visible && Date.now() >= this.bubbleExpiresAt) {
      this.hideBubble();
    }
  }

  private showBubble(text: string, expiresAt: number): void {
    const limit = Math.max(1, this.config.bubble_max_chars);
    const shown = text.slice(0, limit);
    this.bubbleText.text = shown;
    const width = Math.min(240, Math.max(90, this.bubbleText.width + 24));
    const height = this.bubbleText.height + 18;
    this.bubbleText.position.set(-width / 2 + 12, -height + 9);
    this.bubbleBackground
      .clear()
      .roundRect(-width / 2, -height, width, height, 10)
      .fill({ color: 0xffffff, alpha: 0.94 })
      .stroke({ width: 2, color: 0xff70d9, alpha: 0.95 });
    this.updateBubblePosition();
    this.bubble.visible = true;
    this.bubbleExpiresAt = expiresAt;
    this.bubbleSignature = `${expiresAt}\0${text}`;
  }

  private hideBubble(): void {
    this.bubble.visible = false;
    this.bubbleExpiresAt = 0;
    this.bubbleSignature = "";
    this.model.bubble = null;
  }

  private updateBubblePosition(): void {
    this.bubble.position.set(0, -this.artHeight - 8);
  }
}

const FALLBACK_TEXTURE_HOLDER: { current: Texture | null } = { current: null };

function makeFallbackCharacterTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 108;
  canvas.height = 176;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ff72d7";
  context.strokeStyle = "#8ff7ff";
  context.lineWidth = 5;
  context.beginPath();
  context.ellipse(54, 88, 42, 78, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "#fff";
  context.beginPath();
  context.arc(40, 75, 6, 0, Math.PI * 2);
  context.arc(68, 75, 6, 0, Math.PI * 2);
  context.fill();
  FALLBACK_TEXTURE_HOLDER.current = Texture.from(canvas);
  return FALLBACK_TEXTURE_HOLDER.current;
}

function makeFallbackGraphics(): Graphics {
  const graphics = new Graphics()
    .roundRect(0, 0, 108, 176, 48)
    .fill({ color: 0xff72d7, alpha: 0.8 })
    .stroke({ width: 4, color: 0x8ff7ff });
  return graphics;
}
