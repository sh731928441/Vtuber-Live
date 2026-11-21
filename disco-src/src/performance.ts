export class PerformanceGovernor {
  private readonly lowThreshold: number;
  private readonly highThreshold: number;
  private lowForMs = 0;
  private highForMs = 0;
  private degraded = false;

  constructor(
    options: {
      lowThreshold?: number;
      highThreshold?: number;
      lowForMs?: number;
      highForMs?: number;
    } = {},
  ) {
    this.lowThreshold = options.lowThreshold ?? 48;
    this.highThreshold = options.highThreshold ?? 56;
    this.lowForMs = 0;
    this.highForMs = 0;
    this.degraded = false;
    this.lowWindowMs = options.lowForMs ?? 2000;
    this.highWindowMs = options.highForMs ?? 8000;
  }

  private readonly lowWindowMs: number;
  private readonly highWindowMs: number;

  get isDegraded(): boolean {
    return this.degraded;
  }

  sample(deltaMs: number, fps: number): boolean {
    if (fps < this.lowThreshold) {
      this.lowForMs += deltaMs;
      this.highForMs = 0;
      if (this.lowForMs >= this.lowWindowMs) {
        this.degraded = true;
      }
    } else if (fps > this.highThreshold) {
      this.highForMs += deltaMs;
      this.lowForMs = 0;
      if (this.highForMs >= this.highWindowMs) {
        this.degraded = false;
      }
    } else {
      this.lowForMs = Math.max(0, this.lowForMs - deltaMs * 0.25);
      this.highForMs = 0;
    }
    return this.degraded;
  }
}
