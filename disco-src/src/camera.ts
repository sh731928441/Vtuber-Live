import { cameraBounds, clamp, clampCamera, easeInOutCubic, lerp } from "./geometry";
import type {
  CameraConfig,
  CameraMode,
  CameraShot,
  CameraState,
  WorldConfig,
} from "./types";

interface ActiveShot {
  request: CameraShot;
  start: CameraState;
  target: CameraState;
  phase: "transition" | "hold";
  phaseStartedAt: number;
  holdEndsAt: number;
}

export class CameraDirector {
  private config: CameraConfig;
  private world: WorldConfig;
  private viewportWidth: number;
  private viewportHeight: number;
  private baseScale: number;
  private state: CameraState;
  private currentMode: CameraMode = "free";
  private freePhase = 0;
  private manualUntil = 0;
  private activeShot: ActiveShot | null = null;
  private lastGiftShotAt = -Infinity;
  private staticState: CameraState;

  constructor(
    config: CameraConfig,
    world: WorldConfig,
    viewportWidth: number,
    viewportHeight: number,
    baseScale: number,
  ) {
    this.config = config;
    this.world = world;
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
    this.baseScale = baseScale;
    this.state = { ...config.start };
    this.state = this.clampState(this.state);
    this.staticState = { ...this.state };
    if (!config.free_pan_enabled) {
      this.currentMode = "static";
    }
  }

  get value(): CameraState {
    return { ...this.state };
  }

  get mode(): CameraMode {
    return this.currentMode;
  }

  updateConfig(config: CameraConfig): void {
    const wasEnabled = this.config.free_pan_enabled;
    this.config = config;
    this.state = this.clampState(this.state);
    if (!config.free_pan_enabled) {
      if (wasEnabled) {
        this.staticState = { ...this.state };
      }
      if (this.currentMode === "free") {
        this.currentMode = "static";
      }
    } else if (!wasEnabled && this.currentMode === "static") {
      this.currentMode = "free";
      this.setFreePhaseFromX(this.state.x, 0, 1);
    }
  }

  resize(viewportWidth: number, viewportHeight: number, baseScale: number): void {
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
    this.baseScale = baseScale;
    this.state = this.clampState(this.state);
  }

  markManual(now: number, state?: CameraState): void {
    if (state) {
      this.state = this.clampState(state);
    }
    if (!this.config.free_pan_enabled) {
      this.staticState = { ...this.state };
    }
    this.currentMode = "manual";
    this.activeShot = null;
    this.manualUntil = now + this.config.manual_resume_seconds * 1000;
  }

  syncManual(state: CameraState): void {
    if (this.currentMode !== "manual") {
      return;
    }
    this.state = this.clampState(state);
    if (!this.config.free_pan_enabled) {
      this.staticState = { ...this.state };
    }
  }

  requestCharacterShot(
    uid: string,
    x: number,
    y: number,
    now: number,
    reason = "gift",
  ): boolean {
    const shot = this.config.character_shot;
    return this.requestShot(
      {
        target: "character",
        uid,
        x,
        y: y - 80,
        zoom: shot.zoom,
        transitionMs: shot.transition_ms,
        holdMs: shot.hold_ms,
        priority: shot.priority,
        reason,
        requestedAt: now,
      },
      now,
    );
  }

  requestDjShot(now: number, x?: number, y?: number): boolean {
    const shot = this.config.dj_shot;
    return this.requestShot(
      {
        target: "dj",
        x: x ?? shot.x ?? this.world.width / 2,
        y: y ?? shot.y ?? 370,
        zoom: shot.zoom,
        transitionMs: shot.transition_ms,
        holdMs: shot.hold_ms,
        priority: shot.priority,
        reason: "dj",
        requestedAt: now,
      },
      now,
    );
  }

  requestShot(shot: CameraShot, now: number): boolean {
    if (this.currentMode === "manual") {
      return false;
    }
    if (this.activeShot) {
      const active = this.activeShot.request;
      if (shot.priority < active.priority) {
        return false;
      }
      if (
        shot.priority === active.priority &&
        shot.reason === "gift" &&
        now - this.lastGiftShotAt < this.config.gift_coalesce_ms &&
        shot.uid !== active.uid
      ) {
        return false;
      }
    } else if (
      shot.reason === "gift" &&
      now - this.lastGiftShotAt < this.config.gift_coalesce_ms
    ) {
      return false;
    }
    if (shot.reason === "gift") {
      this.lastGiftShotAt = now;
    }
    const target = this.clampState({ x: shot.x, y: shot.y, zoom: shot.zoom });
    this.activeShot = {
      request: shot,
      start: { ...this.state },
      target,
      phase: "transition",
      phaseStartedAt: now,
      holdEndsAt: now + shot.transitionMs + shot.holdMs,
    };
    this.currentMode = "scripted";
    return true;
  }

  cancelCharacter(uid: string, now: number): void {
    if (this.activeShot?.request.uid === uid) {
      this.resumeUnscripted(now);
    }
  }

  update(deltaMs: number, now: number): CameraState {
    if (this.currentMode === "manual") {
      if (now < this.manualUntil) {
        return this.value;
      }
      if (this.config.free_pan_enabled) {
        this.currentMode = "free";
        this.setFreePhaseFromX(this.state.x, now, 1);
      } else {
        this.currentMode = "static";
        this.state = this.clampState(this.staticState);
      }
    }
    if (this.currentMode === "scripted" && this.activeShot) {
      this.updateScripted(now);
    } else if (this.currentMode === "static") {
      this.state = this.clampState(this.staticState);
    } else {
      this.currentMode = "free";
      this.updateFree(deltaMs);
    }
    return this.value;
  }

  private updateScripted(now: number): void {
    const shot = this.activeShot;
    if (!shot) {
      return;
    }
    if (shot.phase === "transition") {
      const duration = Math.max(1, shot.request.transitionMs);
      const amount = easeInOutCubic((now - shot.phaseStartedAt) / duration);
      this.state = {
        x: lerp(shot.start.x, shot.target.x, amount),
        y: lerp(shot.start.y, shot.target.y, amount),
        zoom: lerp(shot.start.zoom, shot.target.zoom, amount),
      };
      if (amount >= 1) {
        shot.phase = "hold";
        shot.phaseStartedAt = now;
        shot.holdEndsAt = now + shot.request.holdMs;
      }
      this.state = this.clampState(this.state);
      return;
    }
    if (now >= shot.holdEndsAt) {
      this.resumeUnscripted(now);
    }
  }

  private resumeUnscripted(now: number): void {
    this.activeShot = null;
    if (this.config.free_pan_enabled) {
      this.currentMode = "free";
      this.setFreePhaseFromX(this.state.x, now, 1);
    } else {
      this.currentMode = "static";
      this.state = this.clampState(this.staticState);
    }
  }

  private updateFree(deltaMs: number): void {
    const targetZoom = this.config.start.zoom;
    const nextZoom = lerp(this.state.zoom, targetZoom, Math.min(1, deltaMs / 450));
    const bounds = cameraBounds(
      this.world,
      this.viewportWidth,
      this.viewportHeight,
      this.baseScale,
      nextZoom,
    );
    const center = (bounds.minX + bounds.maxX) / 2;
    const halfRange = Math.max(1, (bounds.maxX - bounds.minX) / 2);
    const periodMs = Math.max(1, this.config.free_pan_seconds * 2000);
    this.freePhase += (Math.PI * 2 * deltaMs) / periodMs;
    this.state = this.clampState({
      x: center + halfRange * Math.sin(this.freePhase),
      y: (bounds.minY + bounds.maxY) / 2,
      zoom: nextZoom,
    });
  }

  private setFreePhaseFromX(x: number, _now: number, direction: 1 | -1): void {
    const bounds = this.bounds();
    const center = (bounds.minX + bounds.maxX) / 2;
    const halfRange = Math.max(1, (bounds.maxX - bounds.minX) / 2);
    const normalized = clamp((x - center) / halfRange, -1, 1);
    const angle = Math.asin(normalized);
    this.freePhase = direction > 0 ? angle : Math.PI - angle;
  }

  private bounds() {
    return cameraBounds(
      this.world,
      this.viewportWidth,
      this.viewportHeight,
      this.baseScale,
      this.state.zoom,
    );
  }

  private clampState(value: CameraState): CameraState {
    return clampCamera(
      value,
      this.world,
      this.viewportWidth,
      this.viewportHeight,
      this.baseScale,
      this.config.zoom,
    );
  }
}
