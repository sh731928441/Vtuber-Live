import copy
import json
import math
import os
import re
import sys
import threading

if getattr(sys, "frozen", False):
    BASE_DIR = os.path.dirname(sys.executable)
    RES_DIR = getattr(sys, "_MEIPASS", BASE_DIR)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    RES_DIR = BASE_DIR

CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
LOG_DIR = os.path.join(BASE_DIR, "logs")
WEB_DIR = os.path.join(RES_DIR, "web")

DEFAULT_PERSONA = (
    "你是一位活泼可爱、说话自然的虚拟主播，正在直播。"
    "观众的进场、弹幕、礼物、粉丝团等消息会发给你，你要像真人主播一样用口语回应。"
)

DEFAULT_DISCO_SKIN_PATH = "/disco/assets/role/default.png"
DISCO_ROLE_ASSET_SUFFIXES = {".png", ".gif", ".jpg", ".jpeg", ".webp", ".svg", ".avif"}
DISCO_FIXED_RESOURCE_IDS = ("ceilingWall", "djBooth")
DISCO_SCENE_ASSET_SUFFIXES = DISCO_ROLE_ASSET_SUFFIXES
DISCO_ITEMS_LIMIT = 50


def _finite_number(value, default=0.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default

DEFAULTS = {
    "platform": "bilibili",
    "ui": {"native": True, "width": 1400, "height": 940},
    "session": {"auto_start": False},
    "room_id": 0,
    "bili_cookie": "",
    "bili_follow_back": {"enabled": False},
    "douyin": {
        "mode": "browser",
        "web_rid": "",
        "room_url": "",
        "browser_exe": "",
        "debug_port": 9333,
        "profile_dir": "",
        "keep_browser": True,
        "headless": False,
        "gift_prices": "小心心=1\n玫瑰=1\n大啤酒=2\n加油鸭=5\n抖音1号=10001",
    },
    "auto_connect": False,
    "web_port": 8787,
    "open_ui": True,
    "events": {
        "enter": {
            "enabled": True, "mode": "template", "cooldown_user": 600, "merge_window": 4, "max_names": 3,
            "templates": "欢迎{name}来到直播间！\n{name}来啦，欢迎欢迎！\n欢迎{name}，找个位置坐下吧！",
            "ai_prompt": "观众{name}进入了直播间，请热情地欢迎。",
        },
        "follow": {
            "enabled": True, "mode": "template", "cooldown_user": 3600, "merge_window": 4, "max_names": 3,
            "templates": "谢谢{name}的关注！\n感谢{name}关注，以后常来玩哦！",
            "ai_prompt": "观众{name}关注了主播，请表示感谢。",
        },
        "danmaku": {
            "enabled": True, "mode": "ai", "cooldown_user": 8, "probability": 100,
            "trigger_words": "", "ignore_emoticon": True, "read_original": False,
            "templates": "{name}说：{text}",
            "ai_prompt": "观众{name}发弹幕说：「{text}」。请直接回应这条弹幕。",
        },
        "gift": {
            "enabled": True, "mode": "ai", "merge_window": 3, "min_value": 0, "thank_free": True,
            "templates": "谢谢{name}送的{num}个{gift}！\n感谢{name}的{gift}，破费啦！",
            "ai_prompt": "观众{name}送出了{num}个{gift}（约{value}元）。请真诚地感谢。",
        },
        "guard": {
            "enabled": True, "mode": "ai",
            "templates": "感谢{name}开通{guard}！欢迎上船！",
            "ai_prompt": "观众{name}开通了{num}个月的{guard}。这是很大的支持，请隆重、激动地感谢并欢迎上船。",
        },
        "superchat": {
            "enabled": True, "mode": "ai",
            "templates": "谢谢{name}的{price}元醒目留言！{name}说：{text}",
            "ai_prompt": "观众{name}发送了{price}元的醒目留言：「{text}」。先感谢，再认真回应留言内容。",
        },
        "like": {
            "enabled": False, "mode": "template", "cooldown_user": 600, "merge_window": 5, "max_names": 3,
            "templates": "谢谢{name}的点赞！",
            "ai_prompt": "观众{name}给直播间点了赞，请简短感谢。",
        },
    },
    "filter": {
        "blocklist": "",
        "ignore_users": "",
        "ignore_owner": True,
        "max_queue": 6,
        "max_wait": 60,
        "name_max_len": 12,
        "rename_default": True,
    },
    "ai": {
        "backend": "qoder",
        "qoder_exe": "",
        "qoder_model": "Fast",
        "recycle_after": 60,
        "persona": DEFAULT_PERSONA,
        "max_chars": 40,
        "openai_base": "https://api.deepseek.com/v1",
        "openai_key": "",
        "openai_model": "deepseek-chat",
        "openai_mode": "responses",
        "thinking": "default",
        "timeout": 30,
    },
    "cli": {
        "preset": "",
        "exe": "",
        "args": [],
        "env": "",
        "cwd": "",
        "json_field": "",
        "timeout": 90,
    },
    "zcode": {
        "proxy_url": "http://127.0.0.1:17899",
        "plugin_dir": r"D:\tools\bonus-plan",
        "node_exe": r"D:\tools\node\node.exe",
        "autostart": True,
        "model": "GLM-5.3-Flash",
    },
    "tts": {
        "enabled": True,
        "gsv_dir": "",
        "api_url": "http://127.0.0.1:9880",
        "auto_start": True,
        "stop_on_exit": True,
        "gpt_weights": "GPT_SoVITS/pretrained_models/s1v3.ckpt",
        "sovits_weights": "GPT_SoVITS/pretrained_models/v2Pro/s2Gv2Pro.pth",
        "ref_audio": "",
        "ref_text": "",
        "ref_lang": "zh",
        "text_lang": "zh",
        "speed": 1.0,
        "temperature": 1.0,
        "top_k": 15,
        "top_p": 1.0,
        "sample_steps": 32,
        "bake_extra": "",
        "segment_bake": True,
        "custom_gpt": [],
        "custom_sovits": [],
    },
    "audio": {"device": "", "volume": 80},
    "overlay": {"seconds": 8},
    "stats": {
        "token_label": "本场已用 Token",
        "title": "",
        "show_tokens": True,
        "show_duration": True,
        "show_gifts": True,
        "gift_list": True,
        "gift_rows": 4,
        "font_size": 24,
        "position": "top-left",
    },
    "songs": {
        "enabled": True,
        "require_gift": True,
        "song_gifts": "小花花",
        "song_gift_count": 1,
        "pin_gifts": "人气票",
        "pin_gift_count": 1,
        "max_queue": 20,
        "max_per_user": 2,
        "max_minutes": 8,
        "volume": 45,
        "duck": 30,
        "netease_cookie": "",
        "autoplay": {"enabled": False, "playlist_id": "", "playlist_name": "", "mode": "shuffle",
                     "interrupt": True, "max_fail": 3},
        "announce_add": True,
        "announce_similar": True,
        "announce_pin": True,
        "announce_play": True,
        "announce_fail": True,
        "announce_need": True,
        "announce_full": True,
        "tpl_add": "收到{name}点的《{song}》，排在第{pos}首！",
        "tpl_similar": "原版暂时放不了，给{name}找了相似的《{song}》，排在第{pos}首。",
        "tpl_pin": "{name}的《{song}》插队成功，排到最前面啦！",
        "tpl_play": "下面播放{name}点的《{song}》。",
        "tpl_fail": "抱歉{name}，没找到能播放的《{query}》。",
        "tpl_need": "{name}，送{num}个{gift}就可以点歌哦！",
        "tpl_full": "{name}，歌单排满啦，等前面的播完再点吧！",
    },
    "games": {
        "enabled": True,
        "auto": False,
        "interval": 180,
        "guess_max": 8,
        "snake_speed_ms": 350,
        "mines": 10,
        "arcade_delay": 2.5,
        "lottery_winners": 1,
        "lottery_seconds": 45,
        "choices": {
            "guess_number": True,
            "number_bomb": True,
            "quiz": True,
            "word_chain": True,
            "poll": True,
            "snake": True,
            "minesweeper": True,
            "game2048": True,
            "rps": True,
            "lottery": True,
            "feihualing": True,
            "fact": True,
            "story": True,
            "riddle": True,
            "joke": True,
        },
    },
    "fixed_replies": [
        {"enabled": True, "keywords": "晚安", "match": "contains", "reply": "{name}晚安，做个好梦！", "emotion": "开心"},
        {"enabled": True, "keywords": "生日快乐", "match": "contains", "reply": "谢谢{name}！你也要天天开心哦！", "emotion": "感谢"},
    ],
    "disco": {
        "enabled": False,
        "debug": False,
        "command_prefix": "/disco",
        "max_characters": 100,
        "character_ttl_minutes": 10,
        "bubble_max_chars": 50,
        "move_step": 20,
        "world": {"width": 3840, "height": 1080, "viewport_width": 1920, "viewport_height": 1080},
        "bands": {
            "mid": {
                "z": 1,
                "x": [260, 3580],
                "y": [620, 800],
                "scale": [0.4, 0.5],
                "brightness": 0.88,
            },
            "near": {
                "z": 2,
                "x": [140, 3700],
                "y": [790, 1040],
                "scale": [0.52, 0.64],
                "brightness": 1.0,
            },
        },
        "skins": [
            {"id": "default", "path": DEFAULT_DISCO_SKIN_PATH},
            {"id": "dog1", "path": "/disco/assets/role/dog1.gif"},
            {"id": "dog2", "path": "/disco/assets/role/dog2.gif"},
            {"id": "dog3", "path": "/disco/assets/role/dog3.gif"},
            {"id": "dog4", "path": "/disco/assets/role/dog4.gif"},
            {"id": "dsh1", "path": "/disco/assets/role/dsh1.png"},
        ],
        "resources": {
            "ceilingWall": {
                "path": "/disco/assets/scene/ceiling-wall.svg",
                "x": 1920,
                "y": 540,
                "width": 3840,
                "height": 1080,
                "lock_aspect": True,
                "scale_x": 1,
                "scale_y": 1,
                "origin_x": 0.5,
                "origin_y": 0.5,
                "opacity": 1,
                "tint": "#ffffff",
            },
            "djBooth": {
                "path": "/disco/assets/scene/dj-booth.svg",
                "x": 1920,
                "y": 530,
                "width": 380,
                "height": 160,
                "lock_aspect": True,
                "scale_x": 1,
                "scale_y": 1,
                "origin_x": 0.5,
                "origin_y": 0.5,
                "opacity": 1,
                "tint": "#ffffff",
            },
        },
        "items": [],
        "lights": {
            "count": 5,
            "base_alpha": 0.38,
            "breath": 0.1,
            "drift_x": 46,
            "drift_y": 14,
            "colors": ["#31d7ff", "#ff4fca", "#7c62ff", "#ffb347", "#35f2c4"],
            "background_wash": {
                "color": "#6d4cff",
                "alpha": 0.15,
                "width": 2800,
                "height": 720,
                "x": 1920,
                "y": 300,
            },
            "front_alpha": 0.12,
        },
        "camera": {
            "start": {"x": 1920, "y": 540, "zoom": 1.0},
            "zoom": [1.0, 2.0],
            "free_pan_enabled": True,
            "free_pan_seconds": 30,
            "manual_resume_seconds": 8,
            "gift_coalesce_ms": 5000,
            "gift_min_value": 0,
            "character_shot": {
                "zoom": 1.6,
                "transition_ms": 1000,
                "hold_ms": 3500,
                "priority": 2,
            },
            "dj_shot": {
                "x": 1920,
                "y": 370,
                "zoom": 1.35,
                "transition_ms": 1000,
                "hold_ms": 4000,
                "priority": 3,
            },
        },
    },
    "live2d": {
        "enabled": False,
        "model_dir": "",
        "model_file": "",
        "scale": 1.0,
        "x": 0.5,
        "y": 0.0,
        "breath": True,
        "blink": True,
        "sway": False,
        "lipsync": True,
        "lip_gain": 1.2,
        "idle_motion": "",
        "motion_hold": 15,
        "base_expressions": [],
        "expr_hold": 3,
        "bubble": True,
        "bubble_x": 0.28,
        "bubble_y": 0.12,
        "bubble_font": 26,
        "bubble_width": 420,
        "bubble_bg": "#ffffff",
        "bubble_color": "#333333",
        "bubble_border": "#fb7299",
        "bubble_hold": 4,
        "emotions": [
            {"name": "开心", "expressions": ["开心兴奋"], "motion": "", "keywords": "哈哈,开心,太好了,好耶,欢迎"},
            {"name": "感谢", "expressions": ["爱心眼"], "motion": "", "keywords": "谢谢,感谢,爱你,比心,破费"},
            {"name": "害羞", "expressions": ["脸红"], "motion": "", "keywords": "害羞,不好意思,讨厌啦,夸我"},
            {"name": "惊讶", "expressions": ["感叹号"], "motion": "", "keywords": "哇,天哪,真的吗,居然,上舰,上船"},
            {"name": "期待", "expressions": ["星星眼"], "motion": "", "keywords": "期待,好想,超想,一起"},
            {"name": "疑惑", "expressions": ["问号"], "motion": "", "keywords": "为什么,咦,什么意思"},
            {"name": "调皮", "expressions": ["吐舌"], "motion": "chuipaopao", "keywords": "嘿嘿,略略略,才不"},
            {"name": "生气", "expressions": ["生气"], "motion": "", "keywords": "哼,生气,气死"},
            {"name": "难过", "expressions": ["悲伤"], "motion": "", "keywords": "难过,伤心,呜呜"},
            {"name": "尴尬", "expressions": ["流汗"], "motion": "", "keywords": "尴尬,呃,汗"},
            {"name": "晕", "expressions": ["晕晕"], "motion": "", "keywords": "晕,头晕,好累"},
            {"name": "无语", "expressions": ["呆呆眼"], "motion": "", "keywords": "无语,啊这"},
        ],
    },
}

_lock = threading.Lock()


def _skin_id(value, fallback):
    clean = re.sub(r"[^0-9A-Za-z_-]+", "-", str(value or "").strip()).strip("-_").lower()
    return clean or fallback


def _skin_items(raw):
    if isinstance(raw, dict):
        numeric = sorted(
            ((key, value) for key, value in raw.items() if str(key).isdigit()),
            key=lambda item: int(item[0]),
        )
        if numeric:
            return [value for _, value in numeric]
        return list(raw.values())
    return list(raw) if isinstance(raw, list) else []


def normalize_disco_skins(raw):
    """Migrate legacy indexed objects and enforce the protected default skin."""
    specs = []
    used_ids = {"default"}
    used_paths = {DEFAULT_DISCO_SKIN_PATH}
    for item in _skin_items(raw):
        if isinstance(item, str):
            item = {"path": item}
        if not isinstance(item, dict):
            continue
        path = str(item.get("path") or "").strip().replace("\\", "/")
        if not path.startswith("/disco/assets/role/") or "/../" in f"/{path}/":
            continue
        filename = path.rsplit("/", 1)[-1]
        stem = filename.rsplit(".", 1)[0]
        requested_id = str(item.get("id") or "").strip().lower()
        is_default = requested_id == "default" or stem.casefold() in {"default", "dsh0"}
        if is_default:
            continue
        if path in used_paths:
            continue
        skin_id = _skin_id(requested_id or stem, f"skin-{len(specs) + 2}")
        if skin_id == "default":
            skin_id = _skin_id(stem, f"skin-{len(specs) + 2}")
        base_id = skin_id
        suffix = 2
        while skin_id in used_ids:
            skin_id = f"{base_id}-{suffix}"
            suffix += 1
        used_ids.add(skin_id)
        used_paths.add(path)
        specs.append({"id": skin_id, "path": path})
    return [{"id": "default", "path": DEFAULT_DISCO_SKIN_PATH}, *specs]


def normalize_disco_asset_path(value):
    raw = str(value or "").strip().replace("\\", "/")
    if not raw or re.match(r"^[a-z][a-z0-9+.-]*:", raw, re.IGNORECASE) or raw.startswith("//"):
        return ""
    if raw.startswith("/disco/assets/"):
        path = raw
    elif raw.startswith("/assets/"):
        path = "/disco" + raw
    elif raw.startswith("assets/"):
        path = "/disco/" + raw
    elif raw.startswith("/"):
        return ""
    elif raw.startswith("scene/"):
        path = "/disco/assets/" + raw
    else:
        path = "/disco/assets/" + raw.lstrip("./")
    parts = path.split("/")
    if ".." in parts or "." in parts:
        return ""
    if os.path.splitext(path)[1].lower() not in DISCO_SCENE_ASSET_SUFFIXES:
        return ""
    return path


def _scene_number(value, default, minimum=None):
    number = _finite_number(value, default)
    if minimum is not None:
        number = max(minimum, number)
    return number


def _normalize_scene_item(raw, fallback_id=""):
    if not isinstance(raw, dict):
        return None
    item = dict(raw)
    item["path"] = normalize_disco_asset_path(item.get("path"))
    item["id"] = _skin_id(item.get("id") or fallback_id, fallback_id or "item")
    item["x"] = _scene_number(item.get("x"), 1920)
    item["y"] = _scene_number(item.get("y"), 540)
    item["width"] = _scene_number(item.get("width"), 300, 1)
    item["height"] = _scene_number(item.get("height"), 300, 1)
    item["lock_aspect"] = bool(item.get("lock_aspect", True))
    item["flip_x"] = bool(item.get("flip_x", False))
    item["scale_x"] = _scene_number(item.get("scale_x"), 1)
    item["scale_y"] = _scene_number(item.get("scale_y"), 1)
    item["origin_x"] = _scene_number(item.get("origin_x"), 0.5)
    item["origin_y"] = _scene_number(item.get("origin_y"), 0.5)
    item["opacity"] = min(1.0, max(0.0, _scene_number(item.get("opacity"), 1)))
    item["tint"] = str(item.get("tint") or "#ffffff")
    item["visible"] = bool(item.get("visible", True))
    return item


def normalize_disco(config_data):
    disco = config_data.get("disco")
    if isinstance(disco, dict):
        disco["skins"] = normalize_disco_skins(disco.get("skins"))
        resources = disco.get("resources") if isinstance(disco.get("resources"), dict) else {}
        normalized_resources = {}
        for resource_id in DISCO_FIXED_RESOURCE_IDS:
            raw = resources.get(resource_id)
            if isinstance(raw, dict):
                normalized = _normalize_scene_item(raw, resource_id)
                normalized.pop("id", None)
                normalized_resources[resource_id] = normalized
        disco["resources"] = normalized_resources

        items = []
        used_ids = set()
        raw_items = disco.get("items")
        for index, raw in enumerate(raw_items if isinstance(raw_items, list) else []):
            item = _normalize_scene_item(raw, f"item-{index + 1}")
            if not item:
                continue
            base_id = item["id"]
            suffix = 2
            while item["id"] in used_ids:
                item["id"] = f"{base_id}-{suffix}"
                suffix += 1
            used_ids.add(item["id"])
            items.append(item)
        disco["items"] = items
    return config_data


def validate_disco(disco):
    if not isinstance(disco, dict):
        return "Disco 配置必须是对象"
    world = disco.get("world") if isinstance(disco.get("world"), dict) else {}
    world_width = _finite_number(world.get("width"), 3840)
    world_height = _finite_number(world.get("height"), 1080)
    if world_width <= 0 or world_height <= 0:
        return "Disco 世界尺寸必须大于 0"

    resources = disco.get("resources") if isinstance(disco.get("resources"), dict) else {}
    for resource_id, label in (("ceilingWall", "远景墙"), ("djBooth", "DJ 台")):
        spec = resources.get(resource_id)
        if not isinstance(spec, dict) or not spec.get("path"):
            return f"{label}必须填写有效的本地图片路径"
        if _scene_number(spec.get("width"), 0) <= 0 or _scene_number(spec.get("height"), 0) <= 0:
            return f"{label}的宽度和高度必须大于 0"
        if not math.isfinite(_finite_number(spec.get("x"), float("nan"))) or not math.isfinite(
            _finite_number(spec.get("y"), float("nan"))
        ):
            return f"{label}的 X/Y 必须是有效数字"

    bands = disco.get("bands") if isinstance(disco.get("bands"), dict) else {}
    for band_id, label in (("mid", "中景"), ("near", "近景")):
        band = bands.get(band_id)
        if not isinstance(band, dict):
            return f"{label}活动带配置缺失"
        for axis, limit, axis_label in (("x", world_width, "X"), ("y", world_height, "Y")):
            values = band.get(axis)
            if not isinstance(values, list) or len(values) != 2:
                return f"{label}活动带的 {axis_label} 范围格式无效"
            low = _finite_number(values[0], float("nan"))
            high = _finite_number(values[1], float("nan"))
            if not math.isfinite(low) or not math.isfinite(high) or low < 0 or high > limit or low >= high:
                return f"{label}活动带的 {axis_label} 范围无效"

    items = disco.get("items") if isinstance(disco.get("items"), list) else []
    if len(items) > DISCO_ITEMS_LIMIT:
        return f"动态物品最多 {DISCO_ITEMS_LIMIT} 个"
    seen_ids = set()
    for index, item in enumerate(items):
        if not isinstance(item, dict) or not item.get("path"):
            return f"第 {index + 1} 个动态物品路径无效"
        item_id = str(item.get("id") or "").strip()
        if not item_id or item_id in seen_ids:
            return f"第 {index + 1} 个动态物品 ID 无效或重复"
        seen_ids.add(item_id)
        if _scene_number(item.get("width"), 0) <= 0 or _scene_number(item.get("height"), 0) <= 0:
            return f"第 {index + 1} 个动态物品宽高必须大于 0"
        if not math.isfinite(_finite_number(item.get("x"), float("nan"))) or not math.isfinite(
            _finite_number(item.get("y"), float("nan"))
        ):
            return f"第 {index + 1} 个动态物品 X/Y 必须是有效数字"
    return None


def reset_disco_on_startup(config_data):
    """Disable Disco for every process launch, regardless of the saved state."""
    disco = config_data.setdefault("disco", {})
    was_enabled = bool(disco.get("enabled"))
    disco["enabled"] = False
    return was_enabled


def disco_role_assets(web_dir=None):
    role_dir = os.path.join(web_dir or WEB_DIR, "disco", "assets", "role")
    try:
        names = os.listdir(role_dir)
    except OSError:
        return []
    files = []
    for name in names:
        full = os.path.join(role_dir, name)
        if not os.path.isfile(full):
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext not in DISCO_ROLE_ASSET_SUFFIXES:
            continue
        files.append({"name": name, "path": f"/disco/assets/role/{name}"})
    files.sort(key=lambda item: (item["name"].casefold() != "default.png", item["name"].casefold()))
    return files


def _merge(base, override):
    out = copy.deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def load():
    data = {}
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            os.replace(CONFIG_PATH, CONFIG_PATH + ".broken")
    cfg = normalize_disco(_merge(DEFAULTS, data))
    save(cfg)
    return cfg


def save(cfg):
    with _lock:
        tmp = CONFIG_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        os.replace(tmp, CONFIG_PATH)


def merge(cfg, patch):
    return normalize_disco(_merge(cfg, patch))
