#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
按「当前这台设备 + 当前这条网络」实测，挑出最快的 WARP MASQUE 接入点，并直接切过去。

为什么需要它：
  mihomo 的 url-test 只测延迟（一个 204 请求的 RTT），不测带宽。
  延迟最低 ≠ 最快。同一批接入点，在家庭宽带上可能 162.159.198.x:443 最快，
  换到 4G 热点就变成 199.x:8443 最快 —— 运营商对不同 IP/端口段的 QoS 不一样。
  所以「依据设备不同网络环境走最快的线路」这件事，必须实测一次。

它做三件事：
  1) 延迟轮：并发调 mihomo API 给所有 masque 节点测 RTT，排序取前 N
  2) 带宽轮：逐个把 🚀 节点选择 切到候选，真实下载一份测速文件，算 MB/s
  3) 把最快的那个设成当前选择
另外它还会读一遍配置里的拥塞控制档位，没下发 BBR 就直接点出来 ——
因为档位不对的话，换哪条线路都跑不快。

用法:
    python pick_fastest.py --sub warp-masque.tuned.yaml
    python pick_fastest.py --sub warp-masque.tuned.yaml --top 5 --seconds 6
    python pick_fastest.py --sub warp-masque.tuned.yaml --dry-run      # 只看结果不切
    python pick_fastest.py --sub warp-masque.tuned.yaml --watch        # 换网络自动重测
    python pick_fastest.py --sub warp-masque.tuned.yaml --watch --every 30 --min-mbps 5

「一直用上最快的线路」就靠后一条：
  --watch      换 WiFi / 插网线 / 切热点 就重测（按出口 IP + 默认网关做指纹）
  --every 30   除此之外每 30 分钟无条件重测一次 —— 同一条网络上，
               晚高峰的可用带宽能掉到凌晨的三分之一，换网络是等不到这种变化的
  --min-mbps 5 最快的那条都跑不到 5 MB/s 就直接点出来：那基本不是节点选错了，
               而是免费版被压在共享出口上，该去绑 WARP+ 授权码了

前提：mihomo / Clash Verge 正在运行，TUN 或系统代理已开。
只有标准库，不需要 pip 装东西。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import yaml
except ImportError:
    yaml = None


# ---------------------------------------------------------------- mihomo API
class Controller:
    def __init__(self, host: str, port: int, secret: str = "", scheme: str = "http"):
        self.base = f"{scheme}://{host}:{port}"
        self.secret = secret or ""

    def _req(self, method: str, path: str, body=None, timeout=10):
        url = self.base + path
        data = None
        headers = {}
        if self.secret:
            headers["Authorization"] = f"Bearer {self.secret}"
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}

    def delay(self, name: str, url: str, timeout_ms: int):
        """返回该节点对 url 的握手+响应延迟（毫秒），失败抛异常。"""
        p = (f"/proxies/{urllib.parse.quote(name, safe='')}/delay"
             f"?timeout={timeout_ms}&url={urllib.parse.quote(url, safe='')}")
        return self._req("GET", p, timeout=timeout_ms / 1000 + 5).get("delay")

    def select(self, group: str, node: str):
        p = f"/proxies/{urllib.parse.quote(group, safe='')}"
        return self._req("PUT", p, {"name": node})

    def version(self):
        return self._req("GET", "/version").get("version", "?")


# ---------------------------------------------------------------- 读配置
def load_cfg(src: str):
    if src.startswith(("http://", "https://")):
        req = urllib.request.Request(src, headers={"User-Agent": "clash-verge/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode("utf-8", "replace")
    else:
        with open(src, "r", encoding="utf-8") as f:
            raw = f.read()
    if yaml is None:
        raise SystemExit("需要 PyYAML：pip install pyyaml")
    cfg = yaml.safe_load(raw)
    if not isinstance(cfg, dict):
        raise SystemExit("配置解析失败")
    return cfg


def cc_of(cfg: dict) -> str:
    """读出配置里实际下发的拥塞控制档位，没下发返回空串。

    格式和 Worker 那边生成的一致（见 worker/src/config.js 的 CC_PRESETS）；
    手写的配置只写其中一部分也算数。"""
    for p in cfg.get("proxies") or []:
        if isinstance(p, dict) and p.get("type") == "masque":
            cc = p.get("congestion-controller")
            if not cc:
                return ""
            bits = [str(cc)]
            if p.get("cwnd"):
                bits.append(f"cwnd {p['cwnd']}")
            if p.get("bbr-profile"):
                bits.append(str(p["bbr-profile"]))
            return " · ".join(bits)
    return ""


def pick_group(cfg: dict, want: str | None) -> str:
    names = [g.get("name") for g in cfg.get("proxy-groups") or [] if isinstance(g, dict)]
    if want:
        if want not in names:
            raise SystemExit(f"配置里没有分组 {want}")
        return want
    for candidate in ("🚀 节点选择", "☑️ 手动切换", "♻️ 自动选择"):
        if candidate in names:
            return candidate
    sel = [g.get("name") for g in cfg.get("proxy-groups") or []
           if isinstance(g, dict) and g.get("type") == "select"]
    if sel:
        return sel[0]
    raise SystemExit("找不到可用作切换目标的分组")


# ---------------------------------------------------------------- 带宽测速
def throughput(proxy_url: str, test_url: str, seconds: float) -> float:
    """经本地代理下载，返回 MB/s。"""
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url}))
    req = urllib.request.Request(test_url, headers={"User-Agent": "curl/8.0"})
    start = time.monotonic()
    total = 0
    try:
        with opener.open(req, timeout=20) as r:
            while time.monotonic() - start < seconds:
                chunk = r.read(65536)
                if not chunk:
                    break
                total += len(chunk)
    except Exception:
        pass
    elapsed = max(time.monotonic() - start, 0.001)
    return total / elapsed / 1024 / 1024


# ---------------------------------------------------------------- 网络指纹
def net_fingerprint() -> tuple:
    """本地出口 IP + 默认网关。换 WiFi / 插拔网线 / 切热点 都会变。"""
    ip, gw = "", ""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))       # 不会真的发包，只是让内核选路由
        ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass
    try:
        out = subprocess.run(["ipconfig"], capture_output=True, text=True,
                             timeout=8, errors="replace").stdout
    except Exception:
        out = ""
    # 兼容中英文输出：Default Gateway / 默认网关
    for line in out.splitlines():
        if re.search(r"(Default Gateway|默认网关)", line):
            m = re.search(r"(\d+\.\d+\.\d+\.\d+)", line)
            if m:
                gw = m.group(1)
                break
    return (ip, gw)


# ---------------------------------------------------------------- 主流程
def probe(ctrl: Controller, nodes, args):
    print(f"轮 1/2  延迟测试 {len(nodes)} 个节点 …")
    lat: dict[str, int] = {}
    with ThreadPoolExecutor(max_workers=args.jobs) as ex:
        futs = {ex.submit(ctrl.delay, n, args.ping_url, args.timeout_ms): n for n in nodes}
        for f in as_completed(futs):
            n = futs[f]
            try:
                d = f.result()
                if d:
                    lat[n] = d
            except Exception:
                pass
    alive = sorted(lat.items(), key=lambda kv: kv[1])
    print(f"       可用 {len(alive)}/{len(nodes)}")
    if not alive:
        raise SystemExit("所有节点都不通：先确认内核是 mihomo Alpha、TUN 已开、订阅没过期")

    cands = [n for n, _ in alive[:args.top]]
    print(f"轮 2/2  带宽测试最快 {len(cands)} 个（各下 {args.seconds}s）…")
    results = []
    for i, n in enumerate(cands, 1):
        ctrl.select(args.group, n)
        time.sleep(0.4)                  # 等内核把选择生效
        mbps = throughput(f"http://127.0.0.1:{args.port}", args.test_url, args.seconds)
        results.append((n, lat[n], mbps))
        print(f"       [{i}/{len(cands)}] {n:<22} {lat[n]:>5}ms  {mbps:6.2f} MB/s")

    # 排序：带宽优先，带宽接近时看延迟
    results.sort(key=lambda r: (-round(r[2], 1), r[1]))
    return results, alive


def hints(best, args):
    """跑不快的时候，分清是「选错节点」还是「这条链路本身被压住了」。"""
    if args.min_mbps and best[2] < args.min_mbps:
        print(f"\n  ⚠ 最快的一条也只有 {best[2]:.2f} MB/s（低于 --min-mbps {args.min_mbps:g}）。"
              "\n    这通常不是节点选错了 —— 免费版走的是 Cloudflare 共享的普通出口，"
              "\n    被出口拥塞或链路 QoS 压住很常见。去管理页绑一个 WARP+ 授权码"
              "\n    （流量改走 Argo 智能选路）通常明显更快更稳，绑完重新导入一次订阅。")


def report(results, alive, best):
    print("\n" + "=" * 58)
    print(f"  最快线路：{best[0]}   延迟 {best[1]}ms   吞吐 {best[2]:.2f} MB/s")
    print("=" * 58)
    print("  候选排名（带宽优先）")
    for i, (n, d, s) in enumerate(results, 1):
        mark = "  <== 已切换" if i == 1 else ""
        print(f"   {i}. {n:<22} {d:>5}ms  {s:6.2f} MB/s{mark}")
    print("\n  延迟榜前 10（仅供参考，延迟低不等于快）")
    for n, d in alive[:10]:
        print(f"     {n:<22} {d:>5}ms")


def run_once(ctrl: Controller, nodes, args):
    results, alive = probe(ctrl, nodes, args)
    best = results[0]
    if not args.dry_run:
        ctrl.select(args.group, best[0])
    report(results, alive, best)
    hints(best, args)
    return best


def main() -> int:
    ap = argparse.ArgumentParser(description="实测挑最快的 WARP MASQUE 接入点")
    ap.add_argument("--sub", required=True, help="本地 yaml 或订阅 URL（用来取节点名）")
    ap.add_argument("--controller", help="默认从配置的 external-controller 读")
    ap.add_argument("--secret", default="", help="external-controller 的 secret")
    ap.add_argument("--group", help="切到哪个分组，默认 🚀 节点选择")
    ap.add_argument("--port", type=int, help="mixed-port，默认从配置读")
    ap.add_argument("--top", type=int, default=5, help="进带宽轮的候选数，默认 5")
    ap.add_argument("--seconds", type=float, default=5.0, help="每个候选下载几秒，默认 5")
    ap.add_argument("--jobs", type=int, default=16, help="延迟并发数")
    ap.add_argument("--timeout-ms", type=int, default=3000)
    ap.add_argument("--ping-url", default="http://www.gstatic.com/generate_204")
    ap.add_argument("--test-url",
                    default="https://speed.cloudflare.com/__down?bytes=209715200",
                    help="带宽测试用的下载地址（记得在规则里保证它走代理）")
    ap.add_argument("--dry-run", action="store_true", help="只测不切")
    ap.add_argument("--watch", action="store_true", help="网络环境变了自动重测")
    ap.add_argument("--every", type=float, default=0,
                    help="watch 模式下每隔 N 分钟无条件重测一次（默认 0 = 只在换网络时测）。"
                         "同一条网络上高峰期带宽也会掉，建议配合 --watch 用 30")
    ap.add_argument("--min-mbps", type=float, default=0,
                    help="最快的一条低于这个 MB/s 就提示「多半是免费版被限速，该绑 WARP+ 了」"
                         "（默认 0 = 不提示）")
    args = ap.parse_args()

    cfg = load_cfg(args.sub)
    nodes = [p["name"] for p in cfg.get("proxies") or []
             if isinstance(p, dict) and p.get("type") == "masque"]
    if not nodes:
        raise SystemExit("配置里没有 type: masque 的节点")

    ctrl_raw = args.controller or cfg.get("external-controller") or "127.0.0.1:9090"
    host, _, port = ctrl_raw.rpartition(":")
    ctrl = Controller(host or "127.0.0.1", int(port), args.secret or cfg.get("secret", ""))
    args.group = pick_group(cfg, args.group)
    if args.port is None:
        args.port = int(cfg.get("mixed-port") or cfg.get("port") or 7890)

    try:
        print(f"内核 {ctrl.version()}   控制口 {ctrl_raw}   分组 {args.group}   本地代理 127.0.0.1:{args.port}")
    except Exception as e:
        raise SystemExit(f"连不上 mihomo 控制口 {ctrl_raw}：{e}\n"
                         f"确认客户端在跑，且 external-controller 没被防火墙挡住")

    # 线路再好，拥塞控制不对也跑不快：内核默认的 Cubic 一丢包就砍窗口，
    # 手机上（尤其跨境 + 晚高峰）单流速度会被压死。这儿直接点出来，
    # 免得用户对着「每条线路都只有 3 MB/s」挨个换节点。
    cc = cc_of(cfg)
    if cc:
        print(f"拥塞控制 {cc}")
    else:
        print("拥塞控制 未下发 —— 用的是内核默认 Cubic，丢包就砍窗口，"
              "换哪条线路都快不起来。\n"
              "          去管理页「拥塞控制」切到「极速」或「标准」，再重新导入一次订阅。")

    if not args.watch:
        run_once(ctrl, nodes, args)
        return 0

    fp = net_fingerprint()
    every = (args.every or 0) * 60
    print(f"\n监听中（当前 {fp[0]} / 网关 {fp[1]}"
          + (f"，另外每 {args.every:g} 分钟无条件重测一次" if every else "")
          + "），Ctrl-C 退出")
    peak = run_once(ctrl, nodes, args)[2]
    last = time.monotonic()
    while True:
        time.sleep(5)
        cur = net_fingerprint()
        if cur != fp:
            why = f"网络变了 -> {cur[0]} / 网关 {cur[1]}"
        elif every and time.monotonic() - last >= every:
            why = f"定期重测（每 {args.every:g} 分钟）"
        else:
            continue
        fp, last = cur, time.monotonic()
        print(f"\n{why}，重新实测 …\n")
        try:
            got = run_once(ctrl, nodes, args)[2]
        except Exception as e:
            print(f"重测失败：{e}")
            continue
        if got > peak:
            print(f"\n  ↑ 新纪录 {got:.2f} MB/s（旧的最好 {peak:.2f}）")
            peak = got
        elif peak and got < peak * 0.6:
            # 分清「换条线路就好」和「整条链路都被压住了」——后者折腾节点没用
            print(f"\n  ⚠ 这轮最好才 {got:.2f} MB/s，历史最好 {peak:.2f}。"
                  "\n    所有候选一起掉，多半是上游 / 高峰期在压，不是某个节点坏了 ——"
                  "\n    可以先别折腾节点，等一会儿或换个出口族（ZT 团队边缘）再看。")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n已退出")
