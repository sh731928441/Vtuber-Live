import asyncio
import http.cookies
import logging
import random
import time

import aiohttp
import yarl

import blivedm
import blivedm.models.web as wm

log = logging.getLogger("bili")
logging.getLogger("blivedm").setLevel(logging.ERROR)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
GUARD_NAMES = {1: "总督", 2: "提督", 3: "舰长"}
QR_GEN = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate"
QR_POLL = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll"
NAV = "https://api.bilibili.com/x/web-interface/nav"
RELATION_MODIFY = "https://api.bilibili.com/x/relation/modify"
RELATION_ACTION_FOLLOW = "1"    # 关注
RELATION_ACTION_UNFOLLOW = "2"  # 取关
RELATION_ACTION_BLOCK = "5"     # 拉黑
FOLLOW_BACK_DELAY = (3.0, 8.0)
FOLLOW_BACK_RETRY_DELAY = 1.0


def parse_cookie(s):
    s = (s or "").strip()
    if s and "=" not in s:
        return {"SESSDATA": s}
    out = {}
    for part in s.split(";"):
        if "=" in part:
            k, v = part.strip().split("=", 1)
            if k:
                # 浏览器“显示已解码”复制出来的 SESSDATA 带逗号，原样发送会被加引号导致无效
                out[k.strip()] = v.strip().strip('"').replace(",", "%2C")
    return out


def make_session(cookie_str):
    # 必须带 domain，否则 aiohttp 当成 bilibili.com 的 host-only cookie，api.bilibili.com 等子域名收不到
    jar = aiohttp.CookieJar()
    sc = http.cookies.SimpleCookie()
    for k, v in parse_cookie(cookie_str).items():
        sc[k] = v
        sc[k]["domain"] = "bilibili.com"
        sc[k]["path"] = "/"
    if sc:
        jar.update_cookies(sc)
    return aiohttp.ClientSession(cookie_jar=jar, headers={"User-Agent": UA})


def cookie_write_state(session):
    """检查当前会话是否具备修改关注关系所需的 Cookie，不暴露 Cookie 值。"""
    if session is None or getattr(session, "closed", True):
        return False, "B站会话未连接"
    try:
        cookies = session.cookie_jar.filter_cookies(yarl.URL(RELATION_MODIFY))
    except Exception:
        return False, "无法读取B站登录 Cookie"
    if not cookies.get("SESSDATA"):
        return False, "B站 Cookie 缺少 SESSDATA"
    if not cookies.get("bili_jct"):
        return False, "B站 Cookie 缺少 bili_jct（CSRF），无法执行回关"
    return True, ""


class TemporaryRelationError(Exception):
    """可安全重试的关注关系请求错误。"""


def relation_modify_form(follower_uid, csrf, action=RELATION_ACTION_FOLLOW):
    """构造关注请求表单；只允许 act=1，防止将回关误写成取消关注或拉黑。"""
    if action != RELATION_ACTION_FOLLOW or action != "1":
        raise ValueError("自动回关只允许使用 act=1（关注）")
    return {"fid": str(follower_uid), "act": action, "re_src": "11", "csrf": csrf}


async def modify_relation(session, follower_uid, csrf, room_id=None):
    """调用 B 站网页关注接口，返回不含敏感请求内容的结果。"""
    if session is None or getattr(session, "closed", True):
        raise TemporaryRelationError("B站会话未连接")
    form = relation_modify_form(follower_uid, csrf)
    referer = f"https://live.bilibili.com/{room_id}" if room_id else "https://live.bilibili.com/"
    try:
        async with session.post(
            RELATION_MODIFY,
            data=form,
            headers={"Referer": referer, "User-Agent": UA},
            timeout=aiohttp.ClientTimeout(total=10),
        ) as response:
            status = response.status
            try:
                body = await response.json(content_type=None)
            except Exception:
                body = {}
    except (aiohttp.ClientError, asyncio.TimeoutError):
        raise
    code = body.get("code")
    message = str(body.get("message") or body.get("msg") or f"HTTP {status}")
    if status >= 500:
        raise TemporaryRelationError(f"HTTP {status}")
    return {"ok": status < 400 and code == 0, "code": code, "message": message,
            "http_status": status}


class BiliFollowBack:
    """把直播间关注事件转成独立、限速、去重的回关任务。"""

    def __init__(self, get_session, is_enabled, get_login_uid, get_ignore_entries, emit_log,
                 get_room_id=lambda: None, delay_range=FOLLOW_BACK_DELAY,
                 retry_delay=FOLLOW_BACK_RETRY_DELAY, sleep=asyncio.sleep,
                 uniform=random.uniform, request_follow=modify_relation):
        self.get_session = get_session
        self.is_enabled = is_enabled
        self.get_login_uid = get_login_uid
        self.get_ignore_entries = get_ignore_entries
        self.emit_log = emit_log
        self.get_room_id = get_room_id
        self.delay_range = delay_range
        self.retry_delay = retry_delay
        self.sleep = sleep
        self.uniform = uniform
        self.request_follow = request_follow
        self.queue = asyncio.Queue()
        self.pending = set()
        self.attempted = set()
        self.seen_mutual = set()
        self.worker = None
        self._epoch = 0
        self._auth_failed = False
        self._auth_notice_sent = False

    def _log(self, level, message):
        try:
            self.emit_log(level, message)
        except Exception:
            log.exception("follow-back log failed")

    def start(self):
        if self.worker is None or self.worker.done():
            self.worker = asyncio.create_task(self._run(), name="bili-follow-back")

    @staticmethod
    def _uid(value):
        try:
            return int(value or 0)
        except (TypeError, ValueError):
            return 0

    def _ignored(self, uid, name):
        try:
            entries = {str(x).strip() for x in (self.get_ignore_entries() or []) if str(x).strip()}
        except Exception:
            entries = set()
        return str(uid) in entries or (name and name in entries)

    def enqueue(self, event):
        if not self.is_enabled() or self._auth_failed:
            return False
        try:
            msg_type = int(event.get("msg_type") or 0)
        except (TypeError, ValueError):
            return False
        if msg_type not in (2, 4, 5):
            return False
        uid = self._uid(event.get("uid"))
        name = str(event.get("name") or "").strip()
        if uid <= 0:
            self._log("warn", "自动回关已跳过：关注者 UID 无效")
            return False
        if uid in self.attempted or uid in self.pending or uid in self.seen_mutual:
            return False
        self.attempted.add(uid)
        if msg_type == 5:
            self.seen_mutual.add(uid)
            self._log("info", f"自动回关已跳过：{name or uid}（UID {uid}）已经互粉")
            return False
        self.pending.add(uid)
        self.queue.put_nowait({"uid": uid, "name": name, "msg_type": msg_type, "epoch": self._epoch})
        self._log("info", f"自动回关已排队：{name or uid}（UID {uid}）")
        self.start()
        return True

    def clear(self):
        self._epoch += 1
        self.pending.clear()
        while True:
            try:
                self.queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            else:
                self.queue.task_done()

    def reset_login(self):
        self._auth_failed = False
        self._auth_notice_sent = False
        self.clear()

    def invalidate_login(self, reason="B站登录失效，自动回关已暂停，请重新登录"):
        self._auth_failed = True
        self.clear()
        if not self._auth_notice_sent:
            self._auth_notice_sent = True
            self._log("warn", reason)

    async def stop(self):
        self.clear()
        worker = self.worker
        self.worker = None
        if worker is not None and not worker.done():
            worker.cancel()
            try:
                await worker
            except asyncio.CancelledError:
                pass

    async def wait_idle(self):
        await self.queue.join()

    async def _run(self):
        while True:
            item = await self.queue.get()
            try:
                await self._process(item)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._log("error", f"自动回关处理异常：{exc}")
            finally:
                self.pending.discard(item["uid"])
                self.queue.task_done()

    def _active(self, epoch):
        return epoch == self._epoch and self.is_enabled() and not self._auth_failed

    async def _process(self, item):
        uid = item["uid"]
        name = item["name"] or str(uid)
        if not self._active(item["epoch"]):
            return
        login_uid = self._uid(self.get_login_uid())
        if login_uid <= 0:
            self.invalidate_login()
            return
        if uid == login_uid:
            self._log("info", f"自动回关已跳过：{name}（UID {uid}）是当前登录账号")
            return
        if self._ignored(uid, name):
            self._log("info", f"自动回关已跳过：{name}（UID {uid}）在忽略名单中")
            return

        delay = self.uniform(*self.delay_range)
        await self.sleep(delay)
        if not self._active(item["epoch"]):
            return

        session = self.get_session()
        ready, reason = cookie_write_state(session)
        if not ready:
            self.invalidate_login(f"{reason}，自动回关已暂停，请重新扫码登录")
            return
        if not self._active(item["epoch"]):
            return
        try:
            cookies = session.cookie_jar.filter_cookies(yarl.URL(RELATION_MODIFY))
            csrf = cookies["bili_jct"].value
        except Exception:
            self.invalidate_login("无法读取B站 CSRF 登录信息，自动回关已暂停，请重新扫码登录")
            return

        for attempt in range(2):
            try:
                result = await self.request_follow(session, uid, csrf, self.get_room_id())
            except (aiohttp.ClientError, asyncio.TimeoutError, TemporaryRelationError):
                if attempt == 0 and self._active(item["epoch"]):
                    await self.sleep(self.retry_delay)
                    if self._active(item["epoch"]):
                        continue
                if not self._active(item["epoch"]):
                    return
                self._log("error", f"自动回关失败：{name}（UID {uid}），网络请求未完成")
                return

            code = result.get("code")
            if result.get("ok"):
                self._log("info", f"自动回关成功：{name}（UID {uid}）")
                return
            if code in (-101, -111):
                self.invalidate_login()
                return
            message = result.get("message") or "未知错误"
            self._log("warn", f"自动回关被平台拒绝：{name}（UID {uid}），"
                               f"返回码 {code if code is not None else result.get('http_status')}，{message}")
            return


class _Handler(blivedm.BaseHandler):
    _CMD_CALLBACK_DICT = blivedm.BaseHandler._CMD_CALLBACK_DICT.copy()

    def __init__(self, emit, on_follow=None):
        self.emit = emit
        self.on_follow = on_follow

    def _like(self, client, command):
        d = command.get("data") or {}
        self.emit({"type": "like", "uid": d.get("uid", 0), "name": d.get("uname", "")})

    _CMD_CALLBACK_DICT["LIKE_INFO_V3_CLICK"] = _like

    def _on_danmaku(self, client, m: wm.DanmakuMessage):
        self.emit({"type": "danmaku", "uid": m.uid, "name": m.uname, "text": m.msg,
                   "emoticon": m.dm_type == 1, "guard_level": m.privilege_type})

    def _on_gift(self, client, m: wm.GiftMessage):
        paid = m.coin_type == "gold"
        self.emit({"type": "gift", "uid": m.uid, "name": m.uname, "gift": m.gift_name, "num": m.num,
                   "value": round(m.total_coin / 1000, 2) if paid else 0.0, "paid": paid})

    def _on_user_toast_v2(self, client, m: wm.UserToastV2Message):
        if m.source == 2:
            return
        self.emit({"type": "guard", "uid": m.uid, "name": m.username, "level": m.guard_level,
                   "guard": GUARD_NAMES.get(m.guard_level, "舰长"), "num": m.num or 1,
                   "value": round(m.price / 1000, 2)})

    def _on_buy_guard(self, client, m: wm.GuardBuyMessage):
        self.emit({"type": "guard", "uid": m.uid, "name": m.username, "level": m.guard_level,
                   "guard": GUARD_NAMES.get(m.guard_level, "舰长"), "num": m.num or 1,
                   "value": round(m.price / 1000, 2)})

    def _on_super_chat(self, client, m: wm.SuperChatMessage):
        self.emit({"type": "superchat", "uid": m.uid, "name": m.uname, "text": m.message,
                   "price": m.price, "value": float(m.price)})

    def _on_interact_word_v2(self, client, m: wm.InteractWordV2Message):
        if self.on_follow and m.msg_type in (2, 4, 5):
            self.on_follow({"uid": m.uid, "name": m.username, "msg_type": m.msg_type})
        kind = {1: "enter", 2: "follow", 5: "follow"}.get(m.msg_type)
        if kind:
            self.emit({"type": kind, "uid": m.uid, "name": m.username})


class BiliLive:
    def __init__(self, on_event, on_status, on_follow=None):
        self.on_event = on_event
        self.on_status = on_status
        self.on_follow = on_follow
        self.session = None
        self.client = None
        self.room_id = None
        self.owner_uid = None
        self.login_uid = None
        self.login_name = ""
        self.login_error = ""
        self.connected = False
        self._watch = None

    def _emit(self, ev):
        ev["ts"] = time.time()
        if ev.get("name"):
            ev["name"] = str(ev["name"]).strip()
        try:
            self.on_event(ev)
        except Exception:
            log.exception("event handler failed")

    def _follow(self, ev):
        if not self.on_follow:
            return
        ev["platform"] = "bilibili"
        ev["ts"] = time.time()
        if ev.get("name"):
            ev["name"] = str(ev["name"]).strip()
        try:
            self.on_follow(ev)
        except Exception:
            log.exception("follow handler failed")

    async def start(self, room_id, cookie):
        await self.stop()
        self.login_uid, self.login_name, self.login_error = None, "", ""
        self.session = make_session(cookie)
        if parse_cookie(cookie):
            await self.refresh_login()
            if self.login_name:
                self.on_status(f"B站登录成功：{self.login_name}（UID {self.login_uid}）")
            else:
                self.on_status(f"B站登录无效：{self.login_error or 'Cookie 已过期或不完整'}，请重新扫码登录")
        self.client = blivedm.BLiveClient(int(room_id), session=self.session)
        self.client.set_handler(_Handler(self._emit, self._follow))
        self.client.start()
        self._watch = asyncio.create_task(self._watch_init(room_id))

    async def _watch_init(self, room_id):
        for _ in range(100):
            await asyncio.sleep(0.2)
            if self.client and self.client.room_owner_uid:
                break
        if not self.client:
            return
        self.room_id = self.client.room_id
        self.owner_uid = self.client.room_owner_uid
        self.connected = bool(self.owner_uid)
        if self.connected:
            who = f"已登录：{self.login_name}" if self.login_name else "未登录B站（观众名字会被打码）"
            self.on_status(f"已连接直播间 {self.room_id}，{who}")
        else:
            self.on_status(f"连接直播间 {room_id} 失败，请检查房间号或网络")

    async def stop(self):
        if self._watch:
            self._watch.cancel()
            self._watch = None
        if self.client:
            try:
                await self.client.stop_and_close()
            except Exception:
                pass
            self.client = None
        if self.session:
            await self.session.close()
            self.session = None
        self.connected = False

    async def refresh_login(self):
        self.login_uid, self.login_name, self.login_error = None, "", ""
        try:
            async with self.session.get(NAV, timeout=aiohttp.ClientTimeout(total=10)) as r:
                j = await r.json(content_type=None)
            d = j.get("data") or {}
            if d.get("isLogin"):
                self.login_uid, self.login_name = d.get("mid"), d.get("uname", "")
            else:
                self.login_error = f"B站返回 {j.get('code')} {j.get('message', '')}".strip()
        except Exception as e:
            self.login_error = f"检查登录失败：{e}"
            log.warning("nav check failed: %s", e)


class QrLogin:
    """B站网页扫码登录：生成二维码 -> 轮询 -> 拿到 Cookie。"""

    async def generate(self):
        async with aiohttp.ClientSession(headers={"User-Agent": UA}) as s:
            async with s.get(QR_GEN, timeout=aiohttp.ClientTimeout(total=10)) as r:
                d = (await r.json(content_type=None))["data"]
        return d["url"], d["qrcode_key"]

    async def poll(self, key):
        async with aiohttp.ClientSession(headers={"User-Agent": UA}) as s:
            async with s.get(QR_POLL, params={"qrcode_key": key}, timeout=aiohttp.ClientTimeout(total=10)) as r:
                d = (await r.json(content_type=None))["data"]
                code = d.get("code")
                if code != 0:
                    msg = {86101: "等待扫码", 86090: "已扫码，请在手机上确认", 86038: "二维码已过期"}.get(code, d.get("message", ""))
                    return code, msg, ""
                cookies = {k: v.value for k, v in r.cookies.items()}
        if not cookies.get("SESSDATA"):
            raw = yarl.URL(d.get("url", "")).raw_query_string
            q = dict(p.split("=", 1) for p in raw.split("&") if "=" in p)
            cookies = {k: q[k] for k in ("DedeUserID", "DedeUserID__ckMd5", "SESSDATA", "bili_jct") if k in q}
        return 0, "登录成功", "; ".join(f"{k}={v}" for k, v in cookies.items())
