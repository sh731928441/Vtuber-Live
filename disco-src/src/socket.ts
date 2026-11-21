import type { ConnectionStatus, DiscoMessage } from "./types";

export interface SocketLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export interface SocketHandlers {
  onMessage: (message: DiscoMessage) => void;
  onStatus: (status: ConnectionStatus, attempt: number) => void;
  onProtocolError?: (error: unknown) => void;
}

export class DiscoSocket {
  private ws: SocketLike | null = null;
  private stopped = true;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;

  constructor(
    private readonly url: string,
    private readonly handlers: SocketHandlers,
    private readonly factory: (url: string) => SocketLike = (socketUrl) => new WebSocket(socketUrl),
  ) {}

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.handlers.onStatus("closed", this.attempt);
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }
    this.handlers.onStatus(this.attempt > 0 ? "reconnecting" : "connecting", this.attempt);
    const ws = this.factory(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.handlers.onStatus("connected", 0);
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as DiscoMessage;
        if (message.kind === "disco") {
          this.handlers.onMessage(message);
        }
      } catch (error) {
        this.handlers.onProtocolError?.(error);
      }
    };
    ws.onerror = () => {
      // The close handler owns retry scheduling so one failure schedules one retry.
    };
    ws.onclose = () => {
      if (this.ws !== ws) {
        return;
      }
      this.ws = null;
      if (this.stopped) {
        return;
      }
      this.attempt += 1;
      const delay = Math.min(30, 2 ** Math.min(this.attempt - 1, 5)) * 1000;
      this.handlers.onStatus("reconnecting", this.attempt);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.connect();
      }, delay);
    };
  }
}
