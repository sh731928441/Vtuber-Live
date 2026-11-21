import { Application, Assets, Container, Graphics, Sprite, Texture } from "pixi.js";
import { Viewport } from "pixi-viewport";
import { CameraDirector } from "./camera";
import { CharacterLayer } from "./characters";
import { LightRig } from "./lights";
import { PerformanceGovernor } from "./performance";
import { loadResourceManifest, type ResourceError } from "./resources";
import type { CameraState, DiscoCharacter, DiscoConfig } from "./types";

export interface SceneCallbacks {
  onResources: (errors: ResourceError[]) => void;
  onCamera: (state: CameraState, mode: "free" | "manual" | "scripted") => void;
  onMetrics: (fps: number) => void;
}

export class DiscoScene {
  readonly app = new Application();
  private viewport!: Viewport;
  private readonly world = new Container();
  private readonly backWall = new Container();
  private readonly stageSet = new Container();
  private characters!: CharacterLayer;
  private lights!: LightRig;
  private camera!: CameraDirector;
  private readonly governor = new PerformanceGovernor();
  private canvasElement!: HTMLCanvasElement;
  private config: DiscoConfig;
  private baseScale = 1;
  private resourceSignature = "";
  private degraded = false;
  private latestFps = 60;
  private metricElapsed = 0;
  private paused = false;

  constructor(
    private readonly root: HTMLElement,
    config: DiscoConfig,
    private readonly callbacks: SceneCallbacks,
  ) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    const rect = this.root.getBoundingClientRect();
    await this.app.init({
      resizeTo: this.root,
      background: "#05030b",
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    });
    this.canvasElement = this.app.canvas;
    this.canvasElement.className = "disco-canvas";
    this.root.prepend(this.canvasElement);

    this.baseScale = this.app.screen.width / this.config.world.viewport_width;
    this.viewport = new Viewport({
      screenWidth: this.app.screen.width,
      screenHeight: this.app.screen.height,
      worldWidth: this.config.world.width,
      worldHeight: this.config.world.height,
      events: this.app.renderer.events,
    });
    this.viewport.drag({ pressDrag: true }).pinch().wheel();
    this.applyClampPlugins();
    this.viewport.sortableChildren = true;
    this.viewport.addChild(this.world);
    this.world.sortableChildren = true;
    this.app.stage.addChild(this.viewport);

    const base = new Graphics()
      .rect(0, 0, this.config.world.width, this.config.world.height)
      .fill({ color: 0x10051d, alpha: 1 })
      .rect(0, 620, this.config.world.width, this.config.world.height - 620)
      .fill({ color: 0x08040d, alpha: 1 })
      .ellipse(1920, 430, 1260, 430)
      .fill({ color: 0x5a216f, alpha: 0.2 });
    base.zIndex = -10;
    this.backWall.zIndex = 0;
    this.stageSet.zIndex = 10;
    this.world.addChild(base, this.backWall, this.stageSet);
    this.characters = new CharacterLayer(this.world, this.config);
    this.lights = new LightRig(this.world, this.config);
    this.camera = new CameraDirector(
      this.config.camera,
      this.config.world,
      this.app.screen.width,
      this.app.screen.height,
      this.baseScale,
    );

    await this.reloadVisuals(true);
    this.installInput();
    window.addEventListener("resize", this.handleResize);
    this.applyCamera(this.camera.value);
    this.app.ticker.add(this.tick);
  }

  setConfig(config: DiscoConfig): void {
    this.config = config;
    this.characters.setConfig(config);
    this.lights.setConfig(config);
    this.camera.updateConfig(config.camera);
    this.applyClampPlugins();
    const signature = JSON.stringify({
      resources: config.resources,
      skins: config.skins,
    });
    if (signature !== this.resourceSignature) {
      void this.reloadVisuals(false);
    }
  }

  pause(): void {
    if (this.paused) {
      return;
    }
    this.paused = true;
    this.app.ticker.stop();
  }

  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.app.ticker.start();
  }

  replaceCharacters(characters: DiscoCharacter[]): void {
    this.characters.replaceAll(characters);
  }

  upsertCharacter(character: DiscoCharacter): void {
    this.characters.upsert(character);
  }

  removeCharacter(uid: string): void {
    this.characters.remove(uid);
    this.camera.cancelCharacter(uid, performance.now());
  }

  clearCharacters(): void {
    this.characters.clear();
  }

  focusCharacter(uid: string): boolean {
    const point = this.characters.focusPoint(uid);
    if (!point) {
      return false;
    }
    return this.camera.requestCharacterShot(uid, point.x, point.y, performance.now());
  }

  focusDj(): boolean {
    return this.camera.requestDjShot(performance.now());
  }

  get characterCount(): number {
    return this.characters.count;
  }

  private async reloadVisuals(initial: boolean): Promise<void> {
    this.resourceSignature = JSON.stringify({
      resources: this.config.resources,
      skins: this.config.skins,
    });
    const result = await loadResourceManifest(this.config.resources, (path) =>
      Assets.load<Texture>(path),
    );
    this.backWall.removeChildren();
    this.stageSet.removeChildren();
    for (const [slot, texture] of result.assets) {
      const spec = this.config.resources[slot];
      if (!spec) {
        continue;
      }
      const sprite = new Sprite(texture);
      sprite.anchor.set(spec.origin_x, spec.origin_y);
      sprite.position.set(spec.x, spec.y);
      sprite.scale.set(spec.scale_x, spec.scale_y);
      sprite.alpha = spec.opacity;
      sprite.tint = spec.tint;
      if (slot === "ceilingWall") {
        this.backWall.addChild(sprite);
      } else {
        this.stageSet.addChild(sprite);
      }
    }
    await this.characters.loadSkins((errors) =>
      this.callbacks.onResources([...result.errors, ...errors]),
    );
  }

  private readonly handleResize = (): void => {
    requestAnimationFrame(() => {
      const width = this.app.screen.width;
      const height = this.app.screen.height;
      this.viewport.resize(width, height, this.config.world.width, this.config.world.height);
      this.baseScale = width / this.config.world.viewport_width;
      this.applyClampPlugins();
      this.camera.resize(width, height, this.baseScale);
      const current = this.camera.value;
      this.camera.markManual(performance.now(), current);
      this.applyCamera(current);
    });
  };

  private applyClampPlugins(): void {
    this.viewport.plugins.remove("clamp-zoom");
    this.viewport.clampZoom({
      minScale: this.baseScale * this.config.camera.zoom[0],
      maxScale: this.baseScale * this.config.camera.zoom[1],
    });
  }

  private installInput(): void {
    const mark = () => {
      const actual = this.viewport.scale.x;
      this.camera.markManual(performance.now(), {
        x: this.viewport.center.x,
        y: this.viewport.center.y,
        zoom: actual / this.baseScale,
      });
    };
    this.canvasElement.addEventListener("pointerdown", mark);
    this.canvasElement.addEventListener(
      "pointermove",
      (event) => {
        if (event.buttons) {
          mark();
        }
      },
      { passive: true },
    );
    this.canvasElement.addEventListener(
      "wheel",
      () => {
        mark();
      },
      { passive: true },
    );
    this.canvasElement.addEventListener("touchmove", mark, { passive: true });
  }

  private readonly tick = (): void => {
    const deltaMs = Math.min(100, this.app.ticker.deltaMS);
    this.latestFps = this.app.ticker.FPS || 60;
    this.metricElapsed += deltaMs;
    if (this.metricElapsed >= 500) {
      this.metricElapsed = 0;
      this.callbacks.onMetrics(this.latestFps);
    }
    const low = this.governor.sample(deltaMs, this.latestFps);
    if (low !== this.degraded) {
      this.degraded = low;
      this.lights.setQuality(low ? 0.4 : 1);
      this.characters.setDegraded(low);
    }
    this.lights.update(deltaMs);
    this.characters.update(deltaMs, performance.now(), this.viewport.getVisibleBounds());
    if (this.camera.mode === "manual") {
      this.camera.syncManual({
        x: this.viewport.center.x,
        y: this.viewport.center.y,
        zoom: this.viewport.scale.x / this.baseScale,
      });
      this.applyCamera(this.camera.value);
    }
    const state = this.camera.update(deltaMs, performance.now());
    if (this.camera.mode !== "manual") {
      this.applyCamera(state);
    }
    this.callbacks.onCamera(state, this.camera.mode);
  };

  private applyCamera(state: CameraState): void {
    this.viewport.setZoom(this.baseScale * state.zoom, false);
    this.viewport.moveCenter(state.x, state.y);
  }
}
