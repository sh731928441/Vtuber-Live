import "./styles.css";
import { FALLBACK_CONFIG } from "./fallback-config";
import { DiscoScene, type SceneCallbacks } from "./scene";
import { DiscoSocket } from "./socket";
import { DiscoStateStore } from "./state-store";
import type {
  DiscoConfig,
  DiscoMessage,
} from "./types";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
  throw new Error("缺少 Disco 页面根节点");
}

root.innerHTML = `
  <main class="disco-frame" id="disco-frame">
    <section class="stage-root" id="stage-root" aria-label="云蹦迪场景"></section>
    <div class="hud" id="hud">
      <div class="hud-brand"><span>VTUBER-LIVE</span><b>DISCO</b></div>
      <div class="audience-count"><i></i><span id="online-count">0</span> 人在舞池</div>
      <section class="debug-panel" id="debug-panel" aria-hidden="true">
        <div><span>镜头</span><b id="camera-mode">free</b></div>
        <div><span>中心</span><b id="camera-center">1920, 540</b></div>
        <div><span>缩放</span><b id="camera-zoom">1.00</b></div>
        <div><span>帧率</span><b id="fps">--</b></div>
        <div><span>连接</span><b id="socket-status">connecting</b></div>
        <p>拖拽移动镜头 · 滚轮缩放 · 停止操作 8 秒后自动巡游</p>
      </section>
      <div class="connection-banner" id="connection-banner" hidden></div>
      <div class="disabled-banner" id="disabled-banner" hidden>
        <strong>DISCO 已暂停</strong>
        <span>在 Vtuber-Live 控制台点击“启动”后恢复</span>
      </div>
      <div class="resource-errors" id="resource-errors" hidden></div>
    </div>
    <div class="fatal-overlay" id="fatal-overlay" hidden>
      <p>DISCO 初始化失败</p>
      <strong id="fatal-message"></strong>
    </div>
  </main>
`;

void boot();

async function boot(): Promise<void> {
  const stageRoot = required<HTMLElement>("stage-root");
  const fatal = required<HTMLElement>("fatal-overlay");
  const fatalMessage = required<HTMLElement>("fatal-message");
  const debugPanel = required<HTMLElement>("debug-panel");
  const connectionBanner = required<HTMLElement>("connection-banner");
  const disabledBanner = required<HTMLElement>("disabled-banner");
  const resourceErrors = required<HTMLElement>("resource-errors");
  const onlineCount = required<HTMLElement>("online-count");
  const cameraMode = required<HTMLElement>("camera-mode");
  const cameraCenter = required<HTMLElement>("camera-center");
  const cameraZoom = required<HTMLElement>("camera-zoom");
  const fpsLabel = required<HTMLElement>("fps");
  const socketStatus = required<HTMLElement>("socket-status");

  let config = FALLBACK_CONFIG;
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`配置接口返回 HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { disco?: DiscoConfig };
    if (payload.disco) {
      config = {
        ...FALLBACK_CONFIG,
        ...payload.disco,
        world: { ...FALLBACK_CONFIG.world, ...payload.disco.world },
        camera: { ...FALLBACK_CONFIG.camera, ...payload.disco.camera },
        lights: { ...FALLBACK_CONFIG.lights, ...payload.disco.lights },
      };
    }
  } catch (error) {
    showConnection(connectionBanner, `读取配置失败，使用内置场景：${errorText(error)}`, "warn");
  }

  let visibleErrors: string[] = [];
  let scene: DiscoScene | null = null;
  let sceneStarting: Promise<DiscoScene | null> | null = null;
  const store = new DiscoStateStore(config);

  const syncOnlineCount = () => {
    onlineCount.textContent = String(scene?.characterCount ?? store.characters.length);
  };

  const pauseScene = () => {
    scene?.clearCharacters();
    scene?.pause();
    document.documentElement.classList.add("disco-disabled");
    onlineCount.textContent = "0";
  };

  const callbacks: SceneCallbacks = {
    onResources(errors) {
      visibleErrors = errors.map((error) => `${error.slot}: ${error.message}`);
      if (!visibleErrors.length) {
        resourceErrors.hidden = true;
        resourceErrors.textContent = "";
      } else {
        resourceErrors.hidden = false;
        resourceErrors.textContent = `缺图 ${visibleErrors.length} 项 · ${visibleErrors.join(" · ")}`;
      }
    },
    onCamera(state, mode) {
      cameraMode.textContent = mode;
      cameraCenter.textContent = `${state.x.toFixed(0)}, ${state.y.toFixed(0)}`;
      cameraZoom.textContent = state.zoom.toFixed(2);
    },
    onMetrics(fps) {
      fpsLabel.textContent = fps > 0 ? fps.toFixed(0) : "--";
    },
  };

  const ensureScene = async (): Promise<DiscoScene | null> => {
    if (!config.enabled) {
      return null;
    }
    if (scene) {
      return scene;
    }
    if (sceneStarting) {
      return sceneStarting;
    }
    fatal.hidden = true;
    sceneStarting = (async () => {
      try {
        const created = new DiscoScene(stageRoot, config, callbacks);
        await created.initialize();
        scene = created;
        if (!config.enabled) {
          created.pause();
        }
        return created;
      } catch (error) {
        fatal.hidden = false;
        fatalMessage.textContent = `浏览器无法创建 Disco 图形上下文。${errorText(error)}`;
        return null;
      } finally {
        sceneStarting = null;
      }
    })();
    return sceneStarting;
  };

  const syncScene = async (): Promise<void> => {
    if (!config.enabled) {
      pauseScene();
      return;
    }
    const target = await ensureScene();
    if (!target || !config.enabled) {
      if (target && !config.enabled) {
        pauseScene();
      }
      return;
    }
    target.setConfig(config);
    target.replaceCharacters(store.characters);
    target.resume();
    document.documentElement.classList.remove("disco-disabled");
    syncOnlineCount();
  };

  const applyUiConfig = (nextConfig: DiscoConfig) => {
    document.documentElement.classList.toggle("debug-on", Boolean(nextConfig.debug));
    debugPanel.setAttribute("aria-hidden", String(!nextConfig.debug));
    disabledBanner.hidden = nextConfig.enabled;
    if (!nextConfig.enabled) {
      pauseScene();
    }
  };

  const applyMessage = (message: DiscoMessage): void => {
    const update = store.apply(message);
    if (update.type === "ignored") {
      if (update.reason === "unknown-action") {
        console.warn("忽略未知 Disco 消息", message);
      }
      return;
    }
    if (update.type === "snapshot") {
      config = update.config;
      applyUiConfig(config);
      void syncScene();
    } else if (update.type === "config") {
      config = update.config;
      if (update.clear) {
        scene?.clearCharacters();
      }
      applyUiConfig(config);
      if (config.enabled) {
        void syncScene();
      }
    } else if (update.type === "upsert" && scene && config.enabled) {
      scene.upsertCharacter(update.character);
    } else if (update.type === "remove" && scene) {
      scene.removeCharacter(update.uid);
    } else if (update.type === "focus" && scene && config.enabled) {
      scene.focusCharacter(update.uid);
    } else if (update.type === "shot" && scene && config.enabled) {
      scene.focusDj();
    }
    syncOnlineCount();
  };

  const socket = new DiscoSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
    {
      onMessage: applyMessage,
      onStatus(status, attempt) {
        socketStatus.textContent = status;
        if (status === "reconnecting") {
          showConnection(connectionBanner, `连接中断，正在重连（第 ${attempt} 次）`, "warn");
        } else if (status === "connected" || status === "connecting") {
          connectionBanner.hidden = true;
        } else if (status === "closed") {
          showConnection(connectionBanner, "连接已关闭", "error");
        }
      },
      onProtocolError(error) {
        console.warn("Disco 消息解析失败", error);
      },
    },
  );

  applyUiConfig(config);
  socket.start();
  window.addEventListener("beforeunload", () => {
    scene?.pause();
    socket.stop();
  }, { once: true });

  void syncScene();
}

function showConnection(
  element: HTMLElement,
  message: string,
  level: "warn" | "error",
): void {
  element.hidden = false;
  element.dataset.level = level;
  element.textContent = message;
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`缺少页面元素 #${id}`);
  }
  return element as T;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
