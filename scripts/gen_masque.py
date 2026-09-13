#!/usr/bin/env python3
"""
注册 Cloudflare WARP (MASQUE) 设备并生成 mihomo 配置。

需要先跑 usque register 拿到 config.json，本脚本负责把它转成
带全部可用 endpoint 的 mihomo yaml。

用法:
    python3 gen_masque.py <usque-config.json> <输出目录>
"""
import json
import os
import sys
import urllib.parse

# 全部经真机握手实测（2026-09-05，psg2）
# QUIC 回包不等于能建隧道：162.159.194/196/197/204 段与 v6 的 102/105 段
# 会回包但 login 失败，已剔除。
V4 = ["162.159.198.1", "162.159.198.2", "162.159.199.1", "162.159.199.2"]
V6 = ["2606:4700:103::1", "2606:4700:103::2",
      "2606:4700:104::1", "2606:4700:104::2"]
# 4443/8095 是后来补测出来的，实测 8/8 全通
PORTS = (443, 500, 1701, 4500, 4443, 8443, 8095)

# CF 没有 A 记录指向 MASQUE 段，官方域名只能用在 SNI 上
OFFICIAL_SNI = "zt-masque.cloudflareclient.com"
SNI_NODE = ("162.159.198.1", 443)

RS = "https://raw.githubusercontent.com"
RULESETS = [
    ("🎯 全球直连", f"{RS}/cmliu/ACL4SSR/refs/heads/main/Clash/CFnat.list"),
    ("🎯 全球直连", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list"),
    ("🎯 全球直连", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/UnBan.list"),
    ("🛑 全球拦截", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/BanAD.list"),
    ("🍃 应用净化", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/BanProgramAD.list"),
    ("🍃 应用净化", f"{RS}/cmliu/ACL4SSR/main/Clash/adobe.list"),
    ("🍃 应用净化", f"{RS}/cmliu/ACL4SSR/main/Clash/IDM.list"),
    ("📢 谷歌FCM", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/Ruleset/GoogleFCM.list"),
    ("🎯 全球直连", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/GoogleCN.list"),
    ("🎯 全球直连", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/Ruleset/SteamCN.list"),
    ("Ⓜ️ 微软服务", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/Microsoft.list"),
    ("🍎 苹果服务", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/Apple.list"),
    ("📲 电报信息", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/Telegram.list"),
    ("🤖 AI服务", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/Ruleset/OpenAi.list"),
    ("🤖 AI服务", f"{RS}/juewuy/ShellClash/master/rules/ai.list"),
    ("🤖 AI服务", f"{RS}/cmliu/ACL4SSR/main/Clash/Copilot.list"),
    ("🤖 AI服务", f"{RS}/cmliu/ACL4SSR/main/Clash/GithubCopilot.list"),
    ("🤖 AI服务", f"{RS}/cmliu/ACL4SSR/main/Clash/Claude.list"),
    ("🤖 AI服务", f"{RS}/cmliu/ACL4SSR/main/Clash/Gemini.list"),
    ("📹 油管视频", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/Ruleset/YouTube.list"),
    ("🎥 奈飞视频", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Netflix.list"),
    ("🌍 国外媒体", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/ProxyMedia.list"),
    ("🌍 国外媒体", f"{RS}/cmliu/ACL4SSR/main/Clash/Emby.list"),
    ("🚀 节点选择", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/ProxyLite.list"),
    ("🚀 节点选择", f"{RS}/cmliu/ACL4SSR/main/Clash/CMBlog.list"),
    ("🎯 全球直连", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list"),
    ("🎯 全球直连", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/ChinaCompanyIp.list"),
]

# 规则集只盖到 OpenAI / Claude / Gemini / Copilot，其他家没人维护。
# 这批是自己补的。别往里加 googleapis.com、cloudflare.com 这类共用域名，
# 会把大量无关流量拽进 AI 分组。和 worker/src/config.js 里那份保持一致。
AI_DOMAINS = [
    "openai.fm", "operator.chatgpt.com", "chat.com", "anthropic.com",
    "claude.ai", "claudeusercontent.com", "gemini.google.com", "aistudio.google.com",
    "generativelanguage.googleapis.com", "notebooklm.google.com", "notebooklm.google", "labs.google",
    "deepmind.com", "x.ai", "grok.com", "meta.ai",
    "perplexity.ai", "pplx.ai", "perplexity.com", "mistral.ai",
    "chat.mistral.ai", "cohere.com", "cohere.ai", "ai21.com",
    "together.ai", "together.xyz", "fireworks.ai", "groq.com",
    "huggingface.co", "hf.co", "huggingface.js.org", "replicate.com",
    "replicate.delivery", "runpod.io", "modal.com", "openrouter.ai",
    "poe.com", "quora.com", "cursor.com", "cursor.sh",
    "codeium.com", "windsurf.com", "tabnine.com", "sourcegraph.com",
    "phind.com", "v0.dev", "v0.app", "bolt.new",
    "lovable.dev", "devin.ai", "cognition.ai", "midjourney.com",
    "stability.ai", "stablediffusionweb.com", "leonardo.ai", "runwayml.com",
    "pika.art", "lumalabs.ai", "ideogram.ai", "recraft.ai",
    "krea.ai", "civitai.com", "elevenlabs.io", "eleven-labs.com",
    "play.ht", "suno.com", "suno.ai", "udio.com",
    "assemblyai.com", "deepgram.com", "you.com", "kagi.com",
    "exa.ai", "tavily.com", "jasper.ai", "copy.ai",
    "writesonic.com", "notion.so", "langchain.com", "langsmith.com",
    "wandb.ai", "weightsandbiases.com", "pinecone.io", "weaviate.io",
    "qdrant.tech", "chromadb.com", "deepseek.com", "moonshot.cn",
    "moonshotai.com", "kimi.com", "bigmodel.cn", "zhipuai.cn",
    "z.ai", "minimaxi.com", "minimax.io", "hailuoai.com",
    "siliconflow.cn", "dashscope.aliyuncs.com",
]

# 出口 IP 敏感的域名。目标站按「是不是机房/VPN IP」拦人，而 WARP 的出口是
# Cloudflare 共享段。这条流水线是纯 WARP，没有落地可换，只能保证它们
# **一定走代理**（不再被规则集误判成直连）——要换出口得用 Worker 版的
# Opera / Proton / Windscribe 落地。与 worker/src/config.js 那份保持一致。
PLAY_DOMAINS = [
    # Play 的下载 CDN 是最常漏的一环：商店页面能打开、装不上/更新失败，
    # 基本都是 *.gvt1.com / dl.google.com 落到国内直连去了。
    "play.google.com", "play.googleapis.com", "android.clients.google.com",
    "dl.google.com", "dl-ssl.google.com",
    "gvt1.com", "gvt2.com", "gvt3.com",
    "ggpht.com", "googleusercontent.com",
]

WIKI_DOMAINS = [
    "wikipedia.org", "wikimedia.org", "wikidata.org", "wikisource.org",
    "wiktionary.org", "wikibooks.org", "wikinews.org", "wikiversity.org",
    "wikiquote.org", "mediawiki.org",
]

# 成人站对 Cloudflare 段的封禁最彻底（直接 403）。纯 WARP 换不了出口，
# 这几条只是保证走代理。不想要就删掉这个常量。
ADULT_DOMAINS = [
    "pornhub.com", "pornhubpremium.com", "xvideos.com", "xnxx.com",
    "xhamster.com", "redtube.com", "youporn.com", "spankbang.com",
    "beeg.com", "eporner.com", "txxx.com", "hqporner.com",
]

# 流媒体 / 测速 / 大文件下载 —— 这些是「跑满带宽」的流量，也是唯一会把
# 单条 MASQUE 隧道（UDP）压到先被 QoS 打击的那条流。单独拆出来，是为了
# 能把它们和普通网页分开拨到不同的接入点上（见 🎬 流媒体 组）。
STREAM_DOMAINS = [
    # 油管 / 奈飞 / 迪士尼 / 亚马逊 / HBO
    "googlevideo.com", "youtube.com", "youtu.be", "ytimg.com", "ggpht.com",
    "netflix.com", "nflxvideo.net", "nflximg.net", "nflxso.net",
    "disneyplus.com", "dssott.com", "bamgrid.com",
    "primevideo.com", "aiv-cdn.net", "aiv-delivery.net",
    "hbomax.com", "max.com",
    # 音乐 / 直播 / 短视频
    "spotify.com", "scdn.co", "twitch.tv", "ttvnw.net", "vimeo.com",
    "vimeocdn.com", "tiktokcdn.com", "tiktokcdn-us.com", "ibytedtos.com",
    # 测速站点（Fast/Speedtest 是 OFDMA 之外最好用的「隧道真实吞吐」量尺）
    "fast.com", "speedtest.net",
]


def pem_to_b64der(pem):
    return "".join(
        ln.strip() for ln in pem.strip().splitlines()
        if ln.strip() and not ln.startswith("-----")
    )


def node(name, ip, port, priv, pub, v4, v6, sni=None):
    # 裸 IPv6 含冒号，YAML 里必须加引号否则被解析成映射
    srv = f'"{ip}"' if ":" in ip else ip
    extra = f"\n    sni: {sni}" if sni else ""
    return f"""  - name: {name}
    type: masque
    server: {srv}
    port: {port}{extra}
    private-key: {priv}
    public-key: {pub}
    ip: {v4}
    ipv6: {v6}
    mtu: 1280
    udp: true
    remote-dns-resolve: true
    dns: [1.1.1.1, 2606:4700:4700::1111]"""


def node_name(ip, port):
    if ":" in ip:
        seg = ip.split(":")[2]
        tail = ip.rsplit(":", 1)[-1]
        return f"WARP6-{seg}-{tail}-{port}"
    return f"WARP-{'.'.join(ip.split('.')[2:])}-{port}"


def masque_links(cfg, priv, pub):
    """生成 Shadowrocket 用的 masque:// 链接。

    格式参数与字段名对齐 Shadowrocket 的 masque 实现：
    masque://<endpoint_ip>:<port>?publicKey=&privateKey=&ip=&dns=&udp=&cc=&flag=#<名称>
    publicKey 用剥掉 PEM 头尾的 base64 DER，privateKey 直接用 usque 的原值。
    逗号不转义（Shadowrocket 的 dns 字段接受逗号分隔）。
    """
    def enc(v):
        return urllib.parse.quote(str(v), safe="").replace("%2C", ",")

    lines = []
    for ip in V4 + V6:
        for port in PORTS:
            params = "&".join([
                "publicKey=" + enc(pub),
                "privateKey=" + enc(priv),
                "ip=" + enc(cfg["ipv4"]),
                "dns=" + enc("1.1.1.1, 8.8.8.8"),
                "udp=1",
                "cc=" + enc(""),
                "flag=" + enc("CDN"),
            ])
            host = "[%s]" % ip if ":" in ip else ip
            name = node_name(ip, port)
            lines.append("masque://%s:%d?%s#%s" % (host, port, params, enc(name)))
    return lines


def build(cfg):
    priv = cfg["private_key"].strip()
    if priv.startswith("-----"):
        priv = pem_to_b64der(priv)
    pub = pem_to_b64der(cfg["endpoint_pub_key"])
    v4, v6 = cfg["ipv4"], cfg["ipv6"]

    names, proxies = [], []
    for ip in V4 + V6:
        for port in PORTS:
            name = node_name(ip, port)
            names.append(name)
            proxies.append(node(name, ip, port, priv, pub, v4, v6))

    names.append("WARP-官方域名")
    proxies.append(node("WARP-官方域名", SNI_NODE[0], SNI_NODE[1],
                        priv, pub, v4, v6, OFFICIAL_SNI))

    ind = lambda lst, n=6: "\n".join(" " * n + f"- {x}" for x in lst)

    prov, rules = [], []
    for i, (group, url) in enumerate(RULESETS):
        pn = f"rule{i:02d}"
        prov.append(f"""  {pn}:
    type: http
    behavior: classical
    format: text
    interval: 86400
    url: {url}
    path: ./ruleset/{pn}.list""")
        rules.append(f"  - RULE-SET,{pn},{group}")

    # 排最前面的三条，顺序不能动：
    # 1) 关 QUIC。浏览器默认用 QUIC(UDP 443)，在 MASQUE 隧道里等于套了两层
    #    QUIC，握手和丢包恢复都被放大，表现就是「Google 系一直转圈」。
    #    拦掉之后浏览器会自动回退 TCP。要给某个 App 放行就在客户端把
    #    🚫 QUIC 组切成 DIRECT。
    # 2) speed.cloudflare.com 钉走代理 —— 本地测速脚本靠它量真实吞吐，
    #    落到直连就量成自家宽带的速度了。
    # 3) Play / 维基 / 成人站保证走代理（纯 WARP 换不了出口，只能保证走代理）。
    head = [
        "  - AND,((NETWORK,UDP),(DST-PORT,443)),🚫 QUIC",
        "  - DOMAIN-SUFFIX,speed.cloudflare.com,🚀 节点选择",
    ]
    for d in PLAY_DOMAINS + WIKI_DOMAINS + ADULT_DOMAINS:
        head.append(f"  - DOMAIN-SUFFIX,{d},🚀 节点选择")

    # 流媒体 + 测速：ACL4SSR 的 YouTube/Netflix/ProxyMedia 规则集只盖到
    # googlevideo/nflx 这几个主域，Disney+ 的 dssott、Prime 的 aiv-cdn、
    # Twitch 的 ttvnw、TikTok 的 ibytedtos 都不在里面 —— 这些恰恰是
    # 4K 视频真正拉流的 CDN。漏掉就会回落到 🐟 漏网之鱼，跟着默认节点走。
    # 内联放在 RULE-SET 前面，保证精确命中优先。
    for d in STREAM_DOMAINS:
        head.append(f"  - DOMAIN-SUFFIX,{d},🎬 流媒体")

    # 内联的 AI 域名放在 RULE-SET 前面，别被上游更宽的条目抢先命中
    ai = [f"  - DOMAIN-SUFFIX,{d},🤖 AI服务" for d in AI_DOMAINS]
    rules = head + ai + rules

    # 聚合池：57 个接入点是同一个 WARP 账号、出口 IP 相同，把并发连接
    # 分散到不同隧道是安全的；单隧道跑不快时用它摊开。
    # 只收 IPv4 接入点：纯 IPv4 的机器上 IPv6 接入点会 network is unreachable。
    agg_pool = [n for n in names if not n.startswith("WARP6-")]
    # 流媒体组的成员池。只有 IPv6 接入点可用时（纯 v6 网络）才轮到 v6。
    stream_pool = agg_pool or list(names)

    links = masque_links(cfg, priv, pub)

    return links, f"""# Cloudflare WARP over MASQUE - mihomo 配置
# 由 GitHub Actions 自动生成，请勿手工编辑
# 需要 mihomo Alpha 分支：稳定版没有 masque outbound
#
# 节点 {len(names)} 个，endpoint 均经真机握手实测。
# private-key 等同账号凭据。

mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
ipv6: true
unified-delay: true
tcp-concurrent: true
find-process-mode: 'off'
external-controller: 127.0.0.1:9090

profile:
  store-selected: true
  store-fake-ip: true

sniffer:
  enable: true
  sniff:
    HTTP:
      ports: [80, 8080-8880]
      override-destination: true
    TLS:
      ports: [443, 8443]
    QUIC:
      ports: [443, 8443]
  skip-domain:
    - '+.push.apple.com'
    - '+.apple.com'

dns:
  enable: true
  listen: 0.0.0.0:1053
  # 这里故意写死 false，不跟顶层的 ipv6 走：fake-ip 模式下还回答 AAAA 的话，
  # 客户端会优先拿 IPv6 去连目标，本地 IPv6 出口烂的时候就是
  # 「延迟不高但打不开 / 特别慢」。顶层 ipv6 保持 true 是为了让 IPv6
  # 接入点本身还能用（那是直连字面地址，不走 DNS）。
  ipv6: false
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - '+.lan'
    - '+.local'
    - '*.msftconnecttest.com'
    - '*.msftncsi.com'
    - '+.stun.*.*'
    - '+.stun.*.*.*'
    - 'time.*.com'
    - 'ntp.*.com'
    - '+.srv.nintendo.net'
    - '+.stun.playstation.net'
    - 'xbox.*.microsoft.com'
    - '+.xboxlive.com'
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - https://223.5.5.5/dns-query
    - https://1.12.12.12/dns-query
  proxy-server-nameserver:
    - https://223.5.5.5/dns-query
  nameserver-policy:
    'geosite:cn,private':
      - https://223.5.5.5/dns-query
      - https://1.12.12.12/dns-query
    'geosite:geolocation-!cn':
      - https://1.1.1.1/dns-query
      - https://8.8.8.8/dns-query
    # 下面这些经常被地理库误判成「国内」，一判成直连就直接死了，
    # 显式钉到境外 DNS。这里只管解析，路由走哪条看 rules。
    '+.google.com':
      - https://1.1.1.1/dns-query
      - https://8.8.8.8/dns-query
    '+.googleapis.com':
      - https://1.1.1.1/dns-query
      - https://8.8.8.8/dns-query
    '+.gstatic.com':
      - https://1.1.1.1/dns-query
      - https://8.8.8.8/dns-query
    '+.gvt1.com':
      - https://1.1.1.1/dns-query
      - https://8.8.8.8/dns-query
    '+.wikipedia.org':
      - https://1.1.1.1/dns-query
      - https://8.8.8.8/dns-query
    '+.wikimedia.org':
      - https://1.1.1.1/dns-query
      - https://8.8.8.8/dns-query
    '+.openai.com':
      - https://1.1.1.1/dns-query
      - https://8.8.8.8/dns-query
    '+.chatgpt.com':
      - https://1.1.1.1/dns-query
      - https://8.8.8.8/dns-query
    '+.anthropic.com':
      - https://1.1.1.1/dns-query
      - https://8.8.8.8/dns-query
    '+.claude.ai':
      - https://1.1.1.1/dns-query
      - https://8.8.8.8/dns-query

proxies:
{chr(10).join(proxies)}

proxy-groups:
  # QUIC 总开关。默认 REJECT（浏览器会自动回退 TCP）；
  # 个别 App 非用 QUIC 不可的话，在客户端里把它切成 DIRECT。
  - name: 🚫 QUIC
    type: select
    proxies:
      - REJECT
      - DIRECT

  # 并发连接分散到多个接入点。出口是同一个 WARP 账号，不存在会话对不上的问题。
  - name: ⚡ 聚合
    type: load-balance
    strategy: consistent-hashing
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 40
    proxies:
{ind(agg_pool)}

  # 流媒体 / 测速专用出口。
  #
  # 为什么不跟网页共用 🚀 节点选择：4K 视频是持续几十 Mbps 的单条 UDP 流，
  # 也是运营商 QoS 最先盯上的目标；而网页是几百个短连接，被压一点感觉不到。
  # 拆开之后，看视频的流和刷网页的流落在不同接入点上，互不抢。
  #
  # 选定后写进 profile.store-selected，重启不丢。
  - name: 🎬 流媒体
    type: select
    proxies:
      - ⚡ 聚合
      - DIRECT
{ind(agg_pool)}

  - name: 🎬 流媒体自动
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 180
    tolerance: 40
    timeout: 3000
    max-failed-times: 2
    lazy: false
    proxies:
{ind(agg_pool)}

  - name: 🚀 节点选择
    type: select
    proxies:
      - ♻️ 自动选择
      - 🔄 故障转移
      - ☑️ 手动切换
      - ⚡ 聚合
      - DIRECT

  - name: ☑️ 手动切换
    type: select
    proxies:
{ind(names)}

  # 关闭 lazy、间隔压到 180s：用户抱怨「自动选择挑不到最快」基本都是
  # 三件事叠出来的 —— lazy 让首次使用才测、tolerance 太大不切、间隔太长
  # 结果过期。这里三个都收紧。
  - name: ♻️ 自动选择
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 180
    tolerance: 40
    timeout: 3000
    max-failed-times: 2
    lazy: false
    proxies:
{ind(names)}

  - name: 🔄 故障转移
    type: fallback
    url: http://www.gstatic.com/generate_204
    interval: 120
    timeout: 3000
    max-failed-times: 2
    lazy: false
    proxies:
{ind(names)}

  - name: 📹 油管视频
    type: select
    proxies:
      - 🚀 节点选择
      - ♻️ 自动选择
      - 🔄 故障转移
      - ☑️ 手动切换
      - DIRECT

  - name: 🎥 奈飞视频
    type: select
    proxies:
      - 🚀 节点选择
      - ♻️ 自动选择
      - 🔄 故障转移
      - ☑️ 手动切换
      - DIRECT

  - name: 🌍 国外媒体
    type: select
    proxies:
      - 🚀 节点选择
      - ♻️ 自动选择
      - 🔄 故障转移
      - 🎯 全球直连

  - name: 📲 电报信息
    type: select
    proxies:
      - 🚀 节点选择
      - ♻️ 自动选择
      - 🎯 全球直连

  - name: 🤖 AI服务
    type: select
    proxies:
      - 🚀 节点选择
      - ♻️ 自动选择
      - 🔄 故障转移
      - ☑️ 手动切换
      - DIRECT

  - name: Ⓜ️ 微软服务
    type: select
    proxies:
      - 🎯 全球直连
      - 🚀 节点选择
      - ♻️ 自动选择

  - name: 🍎 苹果服务
    type: select
    proxies:
      - 🎯 全球直连
      - 🚀 节点选择
      - ♻️ 自动选择

  - name: 📢 谷歌FCM
    type: select
    proxies:
      - 🚀 节点选择
      - 🎯 全球直连
      - ♻️ 自动选择

  - name: 🎯 全球直连
    type: select
    proxies:
      - DIRECT
      - 🚀 节点选择
      - ♻️ 自动选择

  - name: 🛑 全球拦截
    type: select
    proxies:
      - REJECT
      - DIRECT

  - name: 🍃 应用净化
    type: select
    proxies:
      - REJECT
      - DIRECT

  - name: 🐟 漏网之鱼
    type: select
    proxies:
      - 🚀 节点选择
      - 🎬 流媒体
      - 🎯 全球直连
      - ♻️ 自动选择

rule-providers:
{chr(10).join(prov)}

rules:
{chr(10).join(rules)}
  - GEOIP,LAN,🎯 全球直连,no-resolve
  - GEOIP,CN,🎯 全球直连
  # MATCH 必须是最后一条。放 GEOIP 前面会让所有国内 IP 根本走不到直连分支,
  # 全被拽进代理 —— 看视频的带宽先被自己的路由吃掉了。
  - MATCH,🐟 漏网之鱼
""", len(names)


def main():
    if len(sys.argv) < 3:
        print("用法: gen_masque.py <usque-config.json> <输出目录>", file=sys.stderr)
        sys.exit(1)
    src, outdir = sys.argv[1], sys.argv[2]
    with open(src) as f:
        cfg = json.load(f)

    os.makedirs(outdir, exist_ok=True)
    links, yaml, count = build(cfg)

    path = os.path.join(outdir, "warp-masque.yaml")
    with open(path, "w") as f:
        f.write(yaml)

    txt = os.path.join(outdir, "warp-masque-shadowrocket.txt")
    with open(txt, "w") as f:
        f.write("\n".join(links) + "\n")

    print(f"已生成 {path}")
    print(f"已生成 {txt}（{len(links)} 条 masque:// 链接）")
    print(f"节点数 {count}")
    print(f"内网地址 {cfg['ipv4']} / {cfg['ipv6']}")


if __name__ == "__main__":
    main()
