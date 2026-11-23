"""Compatibility-friendly controller for the standalone Disco scene."""

from __future__ import annotations

import hashlib
import logging
import math
import random
import re
import time
from dataclasses import dataclass
from typing import Any, Callable

log = logging.getLogger("disco")

DISCO_ACTIONS = {
    "snapshot",
    "create",
    "move",
    "say",
    "change",
    "focus",
    "shot",
    "despawn",
    "config",
}


def _finite_number(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _normal_name(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def _parse_move_command(command: str, default_step: Any) -> tuple[float, float] | None:
    text = str(command or "").strip()
    if not text:
        return None
    default_distance = _finite_number(default_step, 20)
    if default_distance < 0 or default_distance > 5000:
        return None
    pattern = re.compile(r"(左|右|上|下)\s*([0-9]+(?:\.[0-9]+)?)?")
    axes: set[str] = set()
    dx = 0.0
    dy = 0.0
    position = 0
    count = 0
    for match in pattern.finditer(text):
        if text[position:match.start()].strip():
            return None
        direction = match.group(1)
        axis = "x" if direction in {"左", "右"} else "y"
        if axis in axes:
            return None
        axes.add(axis)
        distance = _finite_number(match.group(2), default_distance) if match.group(2) else default_distance
        if distance < 0 or distance > 5000:
            return None
        if direction == "左":
            dx -= distance
        elif direction == "右":
            dx += distance
        elif direction == "上":
            dy -= distance
        else:
            dy += distance
        position = match.end()
        count += 1
    if count == 0 or text[position:].strip():
        return None
    return dx, dy


@dataclass
class DiscoCharacter:
    key: str
    platform: str
    uid: str
    name: str
    x: float
    y: float
    skin_id: str
    last_seen: float
    created_at: float
    bubble_text: str = ""
    bubble_expires_at: float = 0.0

    def snapshot(self, now: float) -> dict[str, Any]:
        bubble = None
        if self.bubble_text and self.bubble_expires_at > now:
            bubble = {
                "text": self.bubble_text,
                "ttlMs": max(0, int((self.bubble_expires_at - now) * 1000)),
            }
        return {
            "uid": self.key,
            "platform": self.platform,
            "sourceUid": self.uid,
            "name": self.name,
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "skinId": self.skin_id,
            "bubble": bubble,
        }


class DiscoManager:
    """Owns the live Disco state and emits JSON-ready WebSocket messages."""

    def __init__(
        self,
        get_config: Callable[[], dict[str, Any]],
        emit: Callable[[dict[str, Any]], None] | None = None,
        on_log: Callable[[str, str], None] | None = None,
        *,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], float] = time.time,
        rng: random.Random | None = None,
    ):
        self._get_config = get_config
        self._emit = emit
        self._on_log = on_log
        self._clock = clock
        self._wall_clock = wall_clock
        self._rng = rng or random.Random()
        self.characters: dict[str, DiscoCharacter] = {}
        self.seq = 0
        self.rejected = 0
        self._enabled = bool((self._get_config() or {}).get("enabled", False))

    @property
    def cfg(self) -> dict[str, Any]:
        return self._get_config() or {}

    @property
    def enabled(self) -> bool:
        return self._enabled

    def _log(self, level: str, message: str) -> None:
        getattr(log, level, log.info)(message)
        if self._on_log:
            self._on_log(level, message)

    def _message(self, action: str, **payload: Any) -> dict[str, Any]:
        if action not in DISCO_ACTIONS:
            raise ValueError(f"unknown disco action: {action}")
        self.seq += 1
        return {
            "kind": "disco",
            "action": action,
            "seq": self.seq,
            "t": time.strftime("%H:%M:%S"),
            **payload,
        }

    def _publish(self, action: str, **payload: Any) -> dict[str, Any]:
        message = self._message(action, **payload)
        if self._emit:
            self._emit(message)
        return message

    def set_config(self, config: dict[str, Any]) -> dict[str, Any]:
        was_enabled = self._enabled
        is_enabled = bool(config.get("enabled", False))
        self._enabled = is_enabled
        if was_enabled and not is_enabled:
            self.characters.clear()
        self._log("info", f"Disco 配置已更新：{'启用' if is_enabled else '关闭'}")
        message = self._publish("config", enabled=is_enabled, config=config)
        if is_enabled:
            self.clamp_all_characters()
        return message

    def snapshot(self, *, emit: bool = True) -> dict[str, Any]:
        now = self._clock()
        payload = dict(
            enabled=self.enabled,
            count=len(self.characters),
            config=self.cfg,
            characters=[character.snapshot(now) for character in self.characters.values()],
        )
        message = self._message("snapshot", **payload)
        if emit and self._emit:
            self._emit(message)
        return message

    def user_identity(self, event: dict[str, Any]) -> tuple[str, str, str] | None:
        platform = str(event.get("platform") or "bilibili").strip().lower() or "bilibili"
        raw_uid = event.get("uid")
        uid = str(raw_uid).strip() if raw_uid is not None else ""
        if uid in {"", "0", "None", "null"}:
            uid = ""
        name = _normal_name(event.get("name")) or "新朋友"
        if uid:
            return f"{platform}:{uid}", platform, uid
        raw_name = _normal_name(event.get("name"))
        if not raw_name:
            self.rejected += 1
            self._log("warning", "Disco 拒绝缺少 UID 和名称的直播事件")
            return None
        digest = hashlib.sha1(f"{platform}\0{raw_name.casefold()}".encode("utf-8")).hexdigest()[:16]
        self._log("info", f"Disco 用户缺少 UID，使用名称回退键：{platform}:name:{digest}")
        return f"{platform}:name:{digest}", platform, raw_name

    def _dance_floor(self) -> dict[str, list[float]] | None:
        floor = self.cfg.get("dance_floor")
        if not isinstance(floor, dict):
            return None
        x = floor.get("x") or []
        y = floor.get("y") or []
        if len(x) != 2 or len(y) != 2:
            return None
        x0, x1 = sorted((_finite_number(x[0]), _finite_number(x[1])))
        y0, y1 = sorted((_finite_number(y[0]), _finite_number(y[1])))
        if x1 <= x0 or y1 <= y0:
            return None
        return {"x": [x0, x1], "y": [y0, y1]}

    def clamp_to_dance_floor(self, x: Any, y: Any) -> tuple[float, float] | None:
        floor = self._dance_floor()
        if not floor:
            return None
        x0, x1 = floor["x"]
        y0, y1 = floor["y"]
        return (
            min(x1, max(x0, _finite_number(x))),
            min(y1, max(y0, _finite_number(y))),
        )

    def clamp_all_characters(self) -> list[dict[str, Any]]:
        messages = []
        for character in self.characters.values():
            clamped = self.clamp_to_dance_floor(character.x, character.y)
            if clamped is None:
                continue
            x, y = clamped
            if abs(x - character.x) < 0.005 and abs(y - character.y) < 0.005:
                continue
            character.x = x
            character.y = y
            messages.append(
                self._publish(
                    "move",
                    uid=character.key,
                    x=round(character.x, 2),
                    y=round(character.y, 2),
                    reason="dance_floor_config",
                )
            )
        return messages

    def _choose_skin(self, requested: str = "") -> str:
        skins = self.cfg.get("skins") or []
        ids = [str(item.get("id")) for item in skins if isinstance(item, dict) and item.get("id")]
        if not ids:
            return "default"
        requested = str(requested or "").strip()
        if requested in ids:
            return requested
        return str(self._rng.choice(ids))

    def _ensure_character(self, event: dict[str, Any], now: float) -> tuple[DiscoCharacter | None, bool, str]:
        identity = self.user_identity(event)
        if not identity:
            return None, False, ""
        key, platform, source_uid = identity
        existing = self.characters.get(key)
        if existing:
            existing.last_seen = now
            return existing, False, key

        max_characters = max(0, int(_finite_number(self.cfg.get("max_characters"), 100)))
        if len(self.characters) >= max_characters:
            self.rejected += 1
            self._log("warning", f"Disco 已达到角色上限 {max_characters}，拒绝创建 {key}")
            return None, False, key

        floor = self._dance_floor()
        if not floor:
            self.rejected += 1
            self._log("error", "Disco 舞区配置无效，无法创建角色")
            return None, False, key
        x = self._rng.uniform(*floor["x"])
        y = self._rng.uniform(*floor["y"])
        character = DiscoCharacter(
            key=key,
            platform=platform,
            uid=source_uid,
            name=_normal_name(event.get("name"))[:24] or "新朋友",
            x=x,
            y=y,
            skin_id=self._choose_skin(),
            last_seen=now,
            created_at=now,
        )
        self.characters[key] = character
        return character, True, key

    def _emit_create(self, character: DiscoCharacter) -> dict[str, Any]:
        return self._publish(
            "create",
            uid=character.key,
            platform=character.platform,
            sourceUid=character.uid,
            name=character.name,
            skinId=character.skin_id,
            x=round(character.x, 2),
            y=round(character.y, 2),
        )

    def _say(self, character: DiscoCharacter, text: Any, now: float) -> dict[str, Any] | None:
        clean = _normal_name(text)
        if not clean:
            return None
        limit = max(1, int(_finite_number(self.cfg.get("bubble_max_chars"), 50)))
        if len(clean) > limit:
            clean = clean[:limit]
        ttl_ms = 4200
        character.bubble_text = clean
        character.bubble_expires_at = now + ttl_ms / 1000
        return self._publish(
            "say",
            uid=character.key,
            text=clean,
            ttlMs=ttl_ms,
            expiresAt=int((self._wall_clock() + ttl_ms / 1000) * 1000),
        )

    def _move_character(
        self,
        event: dict[str, Any],
        now: float,
        dx: float,
        dy: float,
    ) -> list[dict[str, Any]]:
        identity = self.user_identity(event)
        if not identity:
            return []
        key = identity[0]
        character = self.characters.get(key)
        if not character:
            return []
        character.x += dx
        character.y += dy
        character.x, character.y = self.clamp_to_dance_floor(character.x, character.y) or (
            character.x,
            character.y,
        )
        character.last_seen = now
        payload: dict[str, Any] = {
            "uid": character.key,
            "x": round(character.x, 2),
            "y": round(character.y, 2),
        }
        if dx:
            payload["direction"] = "left" if dx < 0 else "right"
        return [self._publish("move", **payload)]

    def _change_skin(self, event: dict[str, Any], now: float) -> list[dict[str, Any]]:
        identity = self.user_identity(event)
        if not identity:
            return []
        key = identity[0]
        character = self.characters.get(key)
        if not character:
            return []
        skins = self.cfg.get("skins") or []
        ids = [str(item.get("id")) for item in skins if isinstance(item, dict) and item.get("id")]
        requested = str(event.get("skinId") or event.get("value") or "").strip()
        if requested in ids:
            skin_id = requested
        else:
            options = [item for item in ids if item != character.skin_id]
            skin_id = str(self._rng.choice(options)) if options else self._choose_skin()
        character.skin_id = skin_id
        character.last_seen = now
        return [self._publish("change", uid=character.key, skinId=skin_id)]

    def _focus(self, event: dict[str, Any], now: float) -> list[dict[str, Any]]:
        identity = self.user_identity(event)
        if not identity:
            return []
        key = identity[0]
        character = self.characters.get(key)
        if not character:
            return []
        character.last_seen = now
        camera = self.cfg.get("camera") or {}
        shot = camera.get("character_shot") or {}
        return [
            self._publish(
                "focus",
                uid=character.key,
                reason=str(event.get("reason") or "gift"),
                priority=int(_finite_number(shot.get("priority"), 2)),
                ttlMs=int(_finite_number(shot.get("hold_ms"), 3500) + _finite_number(shot.get("transition_ms"), 1000)),
            )
        ]

    def shot_dj(self) -> dict[str, Any] | None:
        if not self.enabled:
            return None
        shot = (self.cfg.get("camera") or {}).get("dj_shot") or {}
        return self._publish(
            "shot",
            target="dj",
            priority=int(_finite_number(shot.get("priority"), 3)),
            ttlMs=int(_finite_number(shot.get("hold_ms"), 4000) + _finite_number(shot.get("transition_ms"), 1000)),
        )

    def _command(self, event: dict[str, Any], text: str, now: float) -> list[dict[str, Any]]:
        prefix = str(self.cfg.get("command_prefix") or "/disco")
        if not text.casefold().startswith(prefix.casefold()):
            return []
        command = text[len(prefix):].strip()
        if command == "创建角色":
            character, created, _ = self._ensure_character(event, now)
            return [self._emit_create(character)] if character and created else []
        if command == "切换角色":
            return self._change_skin(event, now)
        if command.startswith("切换角色 "):
            return self._change_skin({**event, "skinId": command[len("切换角色 "):].strip()}, now)
        if command in {"镜头 dj", "镜头 DJ", "镜头 DJ台", "镜头 舞台"}:
            message = self.shot_dj()
            return [message] if message else []
        if command == "销毁角色":
            identity = self.user_identity(event)
            if identity:
                existing = self.characters.pop(identity[0], None)
                if existing:
                    return [self._publish("despawn", uid=existing.key)]
            return []
        if command.startswith("移动到"):
            move_body = command[len("移动到"):]
        elif command.startswith("移动"):
            move_body = command[len("移动"):]
        else:
            move_body = None
        if move_body is not None:
            deltas = _parse_move_command(move_body, self.cfg.get("move_step", 20))
            if deltas is None:
                self.rejected += 1
                self._log("warning", f"Disco 拒绝无效移动指令：{text}")
                return []
            return self._move_character(event, now, *deltas)
        self.rejected += 1
        self._log("warning", f"Disco 未识别指令：{text}")
        return []

    def on_event(self, event: dict[str, Any], now: float | None = None) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        if not isinstance(event, dict):
            self.rejected += 1
            self._log("warning", "Disco 忽略非对象事件")
            return []
        now = self._clock() if now is None else now
        event_type = str(event.get("type") or "").strip().lower()
        if event_type == "danmaku":
            text = str(event.get("text") or "")
            command_messages = self._command(event, text, now)
            if command_messages or text.casefold().startswith(str(self.cfg.get("command_prefix") or "/disco").casefold()):
                return command_messages
            character, created, _ = self._ensure_character(event, now)
            if not character:
                return []
            messages = [self._emit_create(character)] if created else []
            if bubble := self._say(character, text, now):
                messages.append(bubble)
            return messages
        if event_type in {"gift", "guard", "superchat", "enter", "follow", "like"}:
            character, created, _ = self._ensure_character(event, now)
            if not character:
                return []
            messages = [self._emit_create(character)] if created else []
            if event_type == "superchat" and (bubble := self._say(character, event.get("text"), now)):
                messages.append(bubble)
            if event_type == "gift":
                min_value = _finite_number((self.cfg.get("camera") or {}).get("gift_min_value"), 0)
                if _finite_number(event.get("value"), 0) >= min_value:
                    messages.extend(self._focus({**event, "reason": "gift"}, now))
            return messages
        self._log("info", f"Disco 忽略不支持的事件类型：{event_type or '(empty)'}")
        return []

    def tick(self, now: float | None = None) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        now = self._clock() if now is None else now
        ttl_seconds = max(0.0, _finite_number(self.cfg.get("character_ttl_minutes"), 10) * 60)
        messages: list[dict[str, Any]] = []
        if ttl_seconds <= 0:
            return messages
        for key, character in list(self.characters.items()):
            if now - character.last_seen >= ttl_seconds:
                del self.characters[key]
                messages.append(self._publish("despawn", uid=key, reason="timeout"))
        return messages
