# WARP MASQUE 配置生成器

一键生成 Cloudflare WARP 的 mihomo 配置，57 个节点，跑在 GitHub Actions 上。
不用自己装环境，不用服务器。

仓库里有两条流水线：

- **生成 WARP MASQUE 配置** — 纯 WARP，57 个节点。下面讲的就是这条。
- **Opera over MASQUE（套娃）** — 在 WARP 外面再叠一层 Opera VPN 落地，
  换个出口国家。见文末[套娃那条](#套娃opera-vpn-叠在-warp-上)。

另外 `worker/` 目录是套娃那条的 Worker 版本，部署到 Cloudflare 上自己每 4 小时
更新，带个状态页。见[跑在 Worker 上](#跑在-worker-上)。

## 怎么用

**1. Fork 这个仓库**

点右上角 Fork。

**2. 打开 Actions 页面**

Fork 过来的仓库默认不开 Actions，会看到一个提示，点
`I understand my workflows, go ahead and enable them` 就行。

**3. 跑一次**

左边选 `生成 WARP MASQUE 配置`，右边点 `Run workflow`，绿色按钮再点一次。
等一分钟左右。

**4. 下载**

跑完点进这次运行的页面，最下面 `Artifacts` 里有个 `warp-masque-config`，
下载解压。

**5. 导入客户端**

解压出来三个文件：

- `warp-masque.yaml` —— mihomo 配置，57 个节点，直接导入 Clash Verge / ClashMi 这类客户端
- `warp-masque-shadowrocket.txt` —— Shadowrocket 用的 `masque://` 链接，一行一个，挑一条复制进去
- `usque-config.json` —— 原始密钥，想自己折腾别的客户端时用得上

## 必须用 mihomo Alpha 内核

masque 只有 mihomo 的 Alpha 分支才有，稳定版导进去会直接报错说不认识这个类型。
所以客户端不光要是 mihomo 内核，还得能切到 Alpha。

**Windows / macOS / Linux**

[Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev) —— 装完打开
`设置 → Clash 内核`，把内核换成 Alpha，等它下载完自动重启。

> 切内核和升级 Verge 本身是两回事。把程序更新到最新版**不会**让内核变成 Alpha，
> 得手动在这个页面切。没切就导入会报 `unsupport proxy type: masque`。

**Android**

[ClashMetaForAndroid](https://github.com/MetaCubeX/ClashMetaForAndroid/releases/tag/Prerelease-alpha)
—— 认准 `Prerelease-alpha` 那个 tag，正式版不行。

**iOS**

[ClashMi](https://github.com/KaringX/clashmi) —— 内置 mihomo 内核，
把 `warp-masque.yaml` 直接导进去就行。同一个 App 也有 macOS / Android /
Windows / Linux 版本。

Shadowrocket 也能用。它不吃 yaml，但 artifact 里已经带了
`warp-masque-shadowrocket.txt`，一行一个 `masque://` 链接，
挑一条复制进 Shadowrocket 就行。

**跨平台，也可以看看**

[FlClash](https://github.com/chen08209/FlClash) —— 界面比较新，Windows / macOS /
Linux / Android 都有。内核版本在设置里换。

**不用图形界面**

直接下 [mihomo Alpha](https://github.com/MetaCubeX/mihomo/releases/tag/Prerelease-Alpha)
二进制，`mihomo -d 配置目录` 跑起来就行。

### 这些用不了

Surge、Quantumult X、Karing 不是 mihomo 内核，也不认 masque，导进去没用。

## 关于节点

57 个节点是同一个 WARP 账号的不同接入地址，**出口 IP 是一样的**。
多节点是为了某个地址被墙时能自动换一个，不是多国家落地。
想选国家要用 ZeroTrust 的出口策略或 WARP+，这个仓库不支持 —— 而且**免费** ZT
也不能选国家（出口仍由 CF 任播就近落），要选国家得走 Opera / Proton /
Windscribe 那几条落地。

配了 Zero Trust 之后会**多出**一族 **团队边缘**节点（`162.159.197.x`），
走独立的团队密钥，和上面这批免费边缘**并存**：免费边缘 57 个，
团队边缘 **14 个**（官方防火墙文档列出的 7 个回退端口各出一对地址）。
免费边缘那 57 个是**同一台设备的一把密钥**，那台被 CF 删掉就整族全死 ——
见 [WARP 节点全死了 / 只剩 Zero Trust 能用](#warp-节点全死了--只剩-zero-trust-能用)。

里面有 28 个 IPv6 节点，你没 IPv6 的话它们会连不上，但客户端会自动跳过，
不影响用。

## 默认调优

生成出来的配置不是裸的 57 个节点，默认带了几处调优。都遵循一个原则：
默认值合理，但需要时能关掉。

**拥塞控制（速度上限由它决定）**

mihomo 的 `masque` 出站认 `congestion-controller` / `cwnd` / `bbr-profile`
三个键（`adapter/outbound/masque.go` 的 `MasqueOption`）。**不写这三个键时用的是
内核默认的 Cubic** —— Cubic 把丢包直接当成拥塞信号，一丢包就把窗口砍半。

手机上网、尤其跨境线路，丢包是常态。所以同一批节点，用 Cubic 只能跑出
两三 MB/s、换成 BBR 就能跑满几十 MB/s，**这不是玄学，是算法差异**：
BBR 拿带宽和 RTT 建模，丢包不砍窗口。`cwnd` 是初始拥塞窗口（单位是**包**，
内核默认 32），加大 = 开局就把窗口铺满，不用慢慢爬。

默认下发「标准」档（`bbr` / `cwnd 64` / `standard`）。管理页有「拥塞控制」
区块，三档一键切：

| 档位 | 下发 | 适合 |
|---|---|---|
| 极速 | `bbr` · `cwnd 128` · `aggressive` | 单流吞吐最大，丢包也硬冲 |
| 标准 | `bbr` · `cwnd 64` · `standard` | 默认。抗丢包又不霸占链路 |
| 回退 | 一条都不下发 | 回到内核默认 Cubic，**完全恢复原状** |

⚠️ 这是**生成期**开关：切完必须**重新导入一次订阅**才生效。

**关 QUIC**

浏览器默认走 QUIC（UDP 443）。在 MASQUE 隧道里再跑一层 QUIC 等于套了两层，
握手和丢包恢复都被放大，表现就是 Google 系一直转圈。配置里第一条规则把
UDP 443 拦掉，浏览器探测到不通会自动回退 TCP，用户无感。

要给某个 App 放行，在客户端的 `🚫 QUIC` 组里切成 `DIRECT` 就行。

**🌐 落地出口**

Google Play、维基百科、成人站这类站点会按「是不是机房/VPN IP」拦人，
而 WARP 的出口是 Cloudflare 共享段，被标记得很厉害。这个组的成员按优先级排：

```
Proton线路 / Windscribe线路  →  亚洲 / 欧洲 / 美洲线路  →  ZT团队边缘  →  WARP直连
     能换出口国家                    能换出口国家              更稳           兜底
```

Play 的下载 CDN（`*.gvt1.com`、`dl.google.com`）也在里面 —— 商店页面打得开
但装不上、更新失败，基本都是这几条没走代理落到国内直连去了。

`🤖 AI服务` 组的首选成员也指向它。

> 纯 WARP 那条流水线没有落地可换，那边只保证这些域名一定走代理，不换出口。

**⚡ 聚合**

`load-balance` 组，把并发连接分散到多个接入点。单隧道跑不快（用户态 QUIC
栈的常见瓶颈）时切过去，下载类场景改善明显。只收 IPv4 接入点 —— 混进 IPv6
节点在纯 IPv4 的机器上会 `network is unreachable`。

这个组会**同时混免费边缘和 ZT 团队边缘两族**（两个不同的 WARP 账号，出口 IP
因此不止一个）。用的是 `consistent-hashing` 策略，按目标域名散，
**同一个站点始终落在同一条隧道上**，所以不会出现「一个会话中途换出口」。
如果某个场景要求出口 IP 绝对统一（少数风控严的站点），切
`⚡ 聚合WARP` 或 `⚡ 聚合ZT` —— 那两个是单族版本，出口各自唯一。
排查「哪一族慢」也用它们，切开一看组内延迟就清楚了。

**🎬 流媒体（单条隧道跑不动 4K 时看这里）**

看 4K 卡和刷网页慢是两码事，所以拆成了独立的出口。

网页是几百个短连接，少量丢包重传被 TCP 摊掉了，感觉不到。4K 视频反过来：
**一条持续几十 Mbps 的长连接**，中途少一点带宽立刻转圈。而 Zero Trust 无论
WireGuard 还是 MASQUE，底层都是 UDP —— 运营商和校园网对「未知 UDP 大流量」
做 QoS 限速非常普遍（怕 P2P、怕 VPN）。

所以 `🎬 流媒体` 组的意义是**分流**：视频的流和网页的流落到不同接入点上，
互不抢带宽。规则集里的 YouTube / Netflix / ProxyMedia 只盖到主域，
这些真正拉流的 CDN 是内联补的：

| 平台 | 容易漏的 CDN |
|---|---|
| YouTube | `googlevideo.com`、`ytimg.com` |
| Netflix | `nflxvideo.net`、`nflxso.net` |
| Disney+ | `dssott.com`、`bamgrid.com` |
| Prime Video | `aiv-cdn.net`、`aiv-delivery.net` |
| Twitch | `ttvnw.net` |
| TikTok | `ibytedtos.com`、`tiktokcdn.com` |

**看 4K 卡的时候，按这个顺序试**：

1. 进 `🎬 流媒体` 组，默认出口就是 `🎬 流媒体自动`（精选池里自动挑最快）
2. 还卡就手动换组里的接入点。重点试 **4443 / 8443 / 8095** 端口的节点 ——
   这几个端口是当初补测出来的，443/500/1701/4500 被 QoS 压制的情况更多
3. 用 `fast.com` 量一下，它被规则钉在 `🎬 流媒体` 组里，量到的就是这条隧道的真实吞吐。
   4K 需要**稳定 25-50 Mbps**（Netflix 15-25 / YouTube 20-45 / B站 20-30）
4. 如果 `fast.com` 上不去但**断开代理**测速很快，那就是 UDP 被限了 ——
   换端口能缓解，根治要靠能走 TCP 的隧道（见下）

**为什么默认不挂 `⚡ 聚合`**：`select` 组里嵌 `load-balance` 在部分手机端内核上
支持不全，那个成员一失效整组就哑了 —— 表现正是「**手机端 YouTube 一直转圈、
电脑上却正常**」。

现在流媒体的默认出口是 `🛟 流媒体兜底`（`fallback`），它的成员里也**刻意不放
`load-balance`**，所以整条默认链都不吃这个兼容性坑。想用聚合手选一下即可。

**自动选择不再套娃**

原来 `♻️ 自动选择` 是 `url-test` 套 `url-test`，成员全是组。嵌套组的延迟取的是
子组「当前选中节点」的旧值，不刷新就一直是旧值 —— 这是「自动选择挑不到最快」
的根因。现在摊平成真实接入点，关掉 `lazy`（开机就测）、`interval` 压到 60s、
`tolerance` 收到 10（ZT 团队边缘组是 90s / 15）。

**但成员是「精选池」，不是全量**

手机上并发做三十多次 MASQUE 握手会被系统/电量策略限制，**测不完的直接标红** ——
用户看到的就是「可用节点太少」，而且开机后一阵子整机发卡。所以两个要全员测速的组
（`♻️ 自动选择` / `🎬 流媒体自动`）只测 `PICK_PORTS = [443, 4443, 8443, 8095]`
四个代表性端口的接入点（免费 17 个 + ZT 4 个 ≈ 21 个），折半。

覆盖度几乎不降：443 是通用口，4443/8095 是实测最容易被 QoS 漏过的冷门口，
8443 是通用备选。**要全量 7 个端口就去 `WARP直连` 组手选** —— 那一组保留全部
57 个接入点（含 IPv6），`lazy: true`，切过去才开测，不占开机预算。

> `url-test` 只测延迟不测带宽。真要按吞吐选，用下面的 `pick_fastest.py`。

**DNS 不吃 AAAA**

`dns.ipv6` 固定 `false`，顶层 `ipv6` 还是 `true`。fake-ip 模式下一旦还回答
AAAA，客户端会优先拿 IPv6 去连目标；本地 IPv6 出口烂的时候，表现就是
「延迟不高但打不开」。顶层保持 true 是为了让 IPv6 接入点本身还能用
（那是直连字面地址，不走 DNS）。

**探测点分两档（「过几天就不能用了」的解法）**

内核判定节点活不活，只认探测点返回什么 —— 见 `adapter/adapter.go` 的 `URLTest`：

```go
satisfied = resp != nil && (expectedStatus == nil || expectedStatus.Check(code))
```

也就是说 **没写 `expected-status` 时，任何 HTTP 响应都算「活」**，403 / 429 / 302
都算，只有网络层错误才判死。而 `www.gstatic.com/generate_204` 是最宽松的探测点
（Google 的静态资源 CDN，实测在被墙的直连下都返回 204）—— 它能证明「隧道通」，
证明不了「出口被目标站接受」。

所以本份分了两档：

| 档 | 探测点 | 用在哪 |
|---|---|---|
| 宽松 | `https://www.gstatic.com/generate_204` | 速度优先的组（`♻️ 自动选择` / `WARP直连` / 聚合 / 地域线路） |
| 严格 | `https://www.google.com/generate_204` + `expected-status: "204"` | 出口本身就是卖点的组（`🎬 流媒体自动` / `🛟 流媒体兜底` / `Proton-自动` / `WS-自动`） |

宽松档故意不写 `expected-status`：误判会把好节点标死，而 url-test 在全员不合格时
会退回**成员列表的第一个**（`urltest.go` 的 `fast()`），那比「慢」严重得多。

`expected-status` 的值**带引号**是刻意的：`GroupCommonOption.ExpectedStatus` 的 Go
类型是 `string`，不去赌解码器的弱类型转换 —— 解析失败会让整份配置加载不了。

所有测试地址都从 `http://` 换成了 `https://`。上游在 `URLTest` 里自己 warn 过：
HTTP 测试地址可能被劫持，而且不兼容 `unified-delay` 的「重复 HEAD」计时。

**流媒体族是「粘」的，网页族是「快切」的**

同样的 `url-test`，两组要的参数是相反的：

- `🎬 流媒体自动`：`interval: 300` / `tolerance: 150`。视频是一条长连接，
  换出口会作废 `googlevideo` 里**按请求方 IP 签名**的分片地址 —— 换个 IP 去取
  就是 403。所以它**只在探测判定不合格时才换**，不抢最快。
- `♻️ 自动选择`：`interval: 60` / `tolerance: 10`。网页是几百个短连接，
  换手没有副作用，越快越好。

（`tolerance` 的语义是「当前节点比最快的慢超过这个值才换」，所以**值越大越粘**。）
这里踩过一次坑：早期把流媒体组也调成了 90s / 10ms，理由是「4K 一抖就要换」——
方向是反的，换来的是「时不时卡一下」，不是更流畅。

**`🛟 流媒体兜底`：探得准，也要逃得出去**

`🎬 流媒体自动` 的池子里只有 WARP 三族，出口 IP **全是 Cloudflare 的共享段** ——
恰好最容易被 Google 判成机房。整族一起被判死时，严格探测会把它们全标死，
而 url-test 全员不合格时退回 `proxies[0]` —— 那还是个 CF 出口，**原地不动**。

所以流媒体默认走 `🛟 流媒体兜底`（`fallback`，按顺序取第一个活的）：

```yaml
- name: 🛟 流媒体兜底
  type: fallback
  url: https://www.google.com/generate_204
  expected-status: "204"
  proxies:
    - 🎬 流媒体自动    # CF 三族，最快
    - 🌐 落地出口      # Opera / Proton / Windscribe 机房，整批换出口 IP
    - DIRECT
```

落到第二层通常就能把「按机房 IP 拦截」的站点救回来。

### 想按当前网络自动挑最快的

`url-test` 只测延迟（一个 204 请求的 RTT），不测带宽 —— 延迟最低 ≠ 最快。
同一批接入点，家庭宽带上可能 `198.x:443` 最快，换到 4G 热点就变成
`199.x:8443` 最快：运营商对不同 IP / 端口段的 QoS 不一样。

先分清两件事，它们不矛盾：

- **配置内部**的 `♻️ 自动选择` 用的是 `url-test`，量的是**隧道内 TTFB**
  （mihomo 发 `HEAD`，且开了 `unified-delay`，所以它只用已建好的隧道上的
  第二个请求计时）。一条 QUIC 隧道的吞吐大约正比于 `拥塞窗口 / RTT`，
  所以在这批节点里挑 RTT 最低的，**确实**是提高单流速度的正确做法。
  默认参数是每 **60 秒**重测一轮、新节点快出 **10ms** 以上就换手。
- 但 RTT 量不到**运营商 QoS**：某个 `IP:端口` 段被限到 3 Mbps，RTT 一样很低。
  这一段只有真下载才看得出来。

所以要按「当前这条网络」实测，用 `scripts/pick_fastest.py`。它会先报出配置里的
拥塞控制档位（**档位不对的话换哪条线路都跑不快**），再用 mihomo API 并发测延迟、
取最快的几个真实下载测吞吐，最后把最快的那条设上：

```bash
# 前提：mihomo API 可达（external-controller 默认 127.0.0.1:9090），TUN 或系统代理已开
python3 scripts/pick_fastest.py --sub warp-masque.yaml --dry-run    # 只看结果不切

# 「一直跑在最快那条线路上」就用这条：
python3 scripts/pick_fastest.py --sub warp-masque.yaml --watch --every 30 --min-mbps 5
```

| 参数 | 干什么 |
|---|---|
| `--watch` | 换 WiFi / 插网线 / 切热点就重测（指纹 = 本地出口 IP + 默认网关） |
| `--every 30` | 除此之外每 30 分钟无条件重测一次。**同一条网络上，晚高峰的可用带宽能掉到凌晨的三分之一** —— 只等换网络是等不到这种变化的 |
| `--min-mbps 5` | 最快那条都跑不到 5 MB/s 就直接点出来：那基本不是节点选错了，而是免费版被压在共享出口上 |

它还会记住历史最好值：所有候选一起掉到最好值的 60% 以下时，会告诉你
「这是上游 / 高峰期在压，不是某个节点坏了」—— 省得白折腾节点。只依赖标准库。

**最后一块拼图是 WARP+ 授权码**：上面所有手段都是在「免费出口」这条路上找最快的，
而免费出口本身是共享的。绑一个授权码，流量改走 Cloudflare 的 **Argo 智能选路**，
等于换了一条路 —— 单流速度通常是量级差别。见下面「想一直用上最快的线路」。

## 几个提醒

配置里的 `private-key` 相当于账号密码，别往外发。artifact 默认存 7 天，
公开仓库的 artifact 谁都能下载，介意就把 fork 出来的仓库设成私有。

想换一套密钥就重新跑一次 workflow，每次都是全新账号。

别写成定时任务高频跑，WARP 会风控封号。

## 常见问题

### 导入报「unsupport proxy type: masque」

完整报错长这样：

```
订阅配置校验失败，请检查订阅配置文件，变更已撤销
level=error msg="proxy 0: unsupport proxy type: masque"
```

**内核还是稳定版，没切到 Alpha。** 这是目前最多人踩的一个。

Clash Verge Rev 的切法：打开「设置 → Clash 内核」，选 Alpha，点切换，
等它下载完会自动重启内核。然后再导入配置。

注意切内核和更新程序本身是两回事，把 Verge 升到最新版并不会让内核变成 Alpha。

### Actions 页面有个黄色警告，要紧吗

如果你看到的是这个：

```
Node.js 20 is deprecated. The following actions target Node.js 20 ...
```

不影响结果，配置照样能生成。这个仓库已经升级到 node24 的 action 版本，
重新 Fork 或者同步一下上游就没有了。

Fork 早了的话，把 `.github/workflows/warp-masque.yml` 里这两行改一下：

```yaml
uses: actions/checkout@v6
uses: actions/upload-artifact@v6
```

### 为什么节点延迟不一样，但测速结果都差不多

57 个节点是同一个 WARP 账号的不同接入地址，**出口 IP 是同一个**。
延迟差异来自你到接入点的网络路径，真正落地的还是那台 Cloudflare 机器。

所以别一个个手试。但要注意：**延迟最低不等于最快** —— `url-test` 只测一个
204 请求的 RTT，不测带宽。要按吞吐挑，跑 `scripts/pick_fastest.py` 实测一轮。

### 桌面端很卡，但手机官方客户端的同一个 Zero Trust 很快

不是节点的问题，是客户端实现的问题：

- 手机官方客户端是系统级 NetworkExtension / VpnService + WireGuard，跑在近内核层
- mihomo 的 `masque` 是 Alpha 分支的用户态 QUIC 栈（quic-go），外面再套 TUN +
  用户态 TCP/IP 栈，**单核 CPU 打满就是速度天花板**

按这个顺序排：

1. 把内核升到**最新** Alpha（旧 Alpha 的 masque 性能差很多）
2. 跑 `scripts/pick_fastest.py`，按当前这条网络实测挑接入点
3. 还嫌慢就切 `⚡ 聚合`，把并发连接摊到多条隧道上

### 手机端 YouTube 打不开 / 一直转圈，电脑上正常

先确认一件事：**手机上用的配置和电脑上是同一份吗**。如果手机端是很久以前导入的
订阅，很可能还是「ZT 顶掉免费 WARP」那版坏配置 —— 里面 57 个免费边缘节点全是
死节点，只有 4 个 `ZT-` 能用。**重新导入一次最新订阅**就能好，别急着调参数。

如果已经是新配置，按这个顺序排：

1. **切 `🎬 流媒体` 组**。YouTube 的规则目标就是这个组。默认走 `🛟 流媒体兜底`
   （先挑能上 Google 的接入点，整族被判死时自动降到 `🌐 落地出口`），
   还不行就往下手选 **Proton线路 / Windscribe线路** —— CF 自己的出口 IP
   被 Google 判成机房限流时，只有换出口能救。
2. **别去改 `🚀 节点选择`**。YouTube 的流量被 `🎬 流媒体` 规则截走了，
   改节点选择对视频完全无效 —— 这是最容易白折腾的地方。
3. **看 `🚫 QUIC` 组**。境外 QUIC 默认 `REJECT`，App 收到拒绝后会回退 TCP；
   个别 App 死磕 QUIC 的话切成 `DIRECT` 再试一次。国内域名的 QUIC 已经自动
   放行直连了，不用管。
4. **确认节点真的活着**。手机上并发测速会被系统限制，别只看 `♻️ 自动选择`
   一片红就下结论 —— 切一次 `WARP直连` 组，它会按需测全量 57 个。

### 先能用、过几天就不能用了（YouTube 或别的国外 App）

这是最容易被误判成「节点坏了」的一类故障。机制其实很单一，说清了你就不用瞎试。

**根因：健康检查测的是「通不通」，不是「能不能用」。**

见上面「默认调优 → 探测点分两档」那段。一句话：不带 `expected-status` 的探测点
**连 403 都算「活」**，而 `gstatic` 这种最宽松的探测点在被墙的直连下都能返回 204。
所以出口 IP 被 Google / Netflix 判成机房拉黑之后，节点在客户端里**照样一片全绿**，
自动选择**永远不会换手** —— 这就是「过几天不能用，而且一直不恢复」。

**配置现在的三层处理，都不需要你操作：**

1. **探测点分档** —— 流媒体 / 落地族改用严格探测点（`google.com/generate_204`
   + `expected-status: "204"`），出口被拒会露馅，组自动换手。
2. **流媒体族「粘」** —— `interval: 300` / `tolerance: 150`，只在探测判定不合格时
   才换。换出口会作废 `googlevideo` 里按 IP 签名的分片地址，所以不能抢最快。
3. **自动换出口族** —— 整族 CF 出口都被判死时，`🛟 流媒体兜底` 会一路降到
   `🌐 落地出口`，把出口 IP 整批换成 Opera / Proton / Windscribe 的机房。

**还是不通，按这个顺序查：**

1. **先等 5 分钟。** 自动换手是有周期的（`interval: 300`），别急着动手。
2. **去 `🎬 流媒体` 手选一条落地线路**（`Proton线路` / `Windscribe线路`）。
   `🌐 落地出口` 是**粘**的，选定不换。
3. **管理页 →「设备体检」。** 看是不是设备被 CF 删了 —— 那是另一类故障，
   见上面「WARP 节点全死了」。
4. **换族交叉试**：`ZT团队边缘` / `WARP直连` / 备胎族，定位是哪一族的问题。
5. **只有某一个 App 不行** —— 大概率是它的某个主机没在域名表里，漂到
   `🐟 漏网之鱼` 去了。提个 issue 说清 App 名即可。

**一条容易忽略的不变量：一个服务的所有主机必须在同一个组里。**

YouTube 的播放清单来自 `youtubei.googleapis.com`，视频分片来自 `googlevideo.com`；
后者的播放地址是**按请求方 IP 签名**的。两个域名走了不同出口 IP，换个 IP 去取
分片就是 403 —— 表现是「**页面能打开、视频一直转圈**」，而且时好时坏
（取决于那两个组当时是不是恰好选中了同一个节点）。

这条不变量现在有测试守着（`YouTube 全套 9 个主机命中同一个组`）。历史上踩过一次：
`ggpht.com` 同时出现在 `PLAY_DOMAINS` 里，而那份规则发得更早，于是把
`yt3.ggpht.com` 从 YouTube 族里拆了出去。

**改不了的边界**：探测只能判断「出口能不能连上目标站」，判断不了
「你家的宽带够不够」，也改不了跨境路由质量。真实带宽用
`scripts/pick_fastest.py --watch` 量。

### 手机端可用节点很少 / 一片超时

三件事按顺序排：

1. **是不是旧配置**。重新导入最新订阅，然后数一下节点总数：
   免费 WARP 边缘 57 + ZT 团队边缘 **14** + 备胎（可选）+ Opera 组合 +
   Proton/Windscribe 落地。管理页「节点」区块会把**本份应有的数量**直接写出来，
   对不上就是旧配置。`ZT-` 只有 4 个说明导入的还是很早那版
   （那时团队边缘只出 443 / 8443 两个端口）。
2. **手机不给测**。`♻️ 自动选择` 和 `🎬 流媒体自动` 各要测 20 多个接入点，
   低电量模式 / 省电策略下系统会限掉并发，测不完的就显示超时。
   配置已经把这两组的成员砍到精选池（原来各 33 个），**开机那一分钟别急着
   下结论**，等一轮 `interval`（180s）跑完再看。
3. **内核不支持 masque**。如果节点列表整体是空的，或者日志里有
   `unsupport proxy type`，是内核不对 —— 见上面 [必须用 mihomo Alpha 内核](# 必须用-mihomo-alpha-内核)。
   `masque` outbound 和 `dialer-proxy` 都只有 Alpha 分支才有。

### WARP 节点全死了 / 只剩 Zero Trust 能用

免费边缘那几十个节点**共用同一台设备的一把密钥**。那台设备在 Cloudflare 那边
被删除或吊销时，整族瞬间全死 —— 客户端只会显示一片超时，看起来就是
「WARP 节点全死了」。这跟「节点不够」是两码事，换端口、换组都救不了。

管理页现在有一块**「设备存活体检」**，直接告诉你是哪一台出了问题：

| 按钮 | 干什么 |
|---|---|
| 设备体检 | 拿 device token 去 CF 问「这台设备还在吗」，逐台给出活着 / 已被 CF 删除 / 没法校验 |
| 一键修复免费族 | 把被 CF 删掉的免费设备（主力 + 备胎）静默重注册换新，活着的原样不动 |
| 重装免费密钥 | 设备还在、但本地密钥认证不过时用。不换 deviceId，比重新注册温和 |
| ＋ / − 备胎 | 加减免费备用设备，最多 3 台 |

几点要说清楚：

- **体检只能查「密钥还作不作数」，查不出「某个接入点通不通」。**
  Workers 没有 UDP 出站，跑不了 QUIC，替客户端做不了真实 MASQUE 握手。
  所以别把体检结果当测速结论 —— 体检说「都活着」但客户端还是连不上，
  那是链路 / 端口层面的问题，换个端口（4443 / 8443 / 8095）或切 ZT 族试。
- **Zero Trust 那份修不了。** 重注册团队设备要一个新的 60 秒 JWT，没法静默做，
  得回管理页粘一份新的。
- **客户端报 `CRYPTO_ERROR 0x131 (remote): tls: access denied`** 就是
  「设备还在、密钥不对」的典型症状（KV 里那把私钥被弄坏，或同一台设备在别处
  重新 enroll 过）。点「重装免费密钥」即可。

**备胎**是另一台免费设备（另一个账号、另一把密钥），专门给这一族做冗余：
主力被 CF 清掉时，「♻️ 自动选择」的测速池里还有备胎的节点，不至于整族全红。
备胎只出 443 / 8095 两个端口，而且只有**前 2 台**进自动测速池 ——
手机上每多一个成员就多一次并发 QUIC 握手，池子必须压住。

**顺带一提**：ZT 团队边缘的接入点从 2 个端口扩到了官方文档列的 7 个
（443 / 500 / 1701 / 4500 / 4443 / 8443 / 8095），一共 14 个节点。
原来只放 443 和 8443，被链路掐掉一个就塌一半 —— 这就是「ZT 只有两个能用」的原因。

### 想一直用上最快的线路

三件事按性价比排，从便宜的往贵的做：

**1. 用组，别手动钉死某个节点。**
钉死一个具体节点 = 关掉自动优选，那条链路一慢你就只能干等。
- `♻️ 自动选择` —— 每 60 秒重测一轮，新节点快出 10ms 以上就换手。**大多数时候用这个。**
- `🔄 故障转移` —— 按顺序取第一个能通的，绝不自动换。要「一直连得上」而不是「一直最快」时用。
- `WARP直连` —— 全量 57 个接入点 + IPv6，手动挑。排查时才用。

**2. 把拥塞控制切到「极速」。**
管理页 →「拥塞控制」→ 极速（`bbr` / `cwnd 128` / `aggressive`）→ 重新导入订阅。
同一条线路，这一下通常就是 2～5 倍的差别（原因见上面「默认调优」）。

**3. 绑 WARP+ 授权码（这是最大的一根杠杆）。**
管理页 →「WARP+ 极速通道」，粘上授权码。免费版走的是 Cloudflare 共享的普通出口，
容易被出口拥塞和链路 QoS 拖住；绑上之后账号变成 WARP+，流量改走
**Argo 智能选路**（CF 自己的优质骨干）。

两个必须知道的坑：

- 授权码在官方 **1.1.1.1 App** 里取：`Account > Key`。**只认官方买的**，
  靠推荐 / 活动拿到的码 CF 会直接拒。
- CF 侧有个老问题：**已经连过 WARP 的账号**，绑了授权码也可能不生效
  （返回里 `warp_plus` 仍是 `false`）。所以管理页给了两个按钮 ——
  「绑定到当前设备」不行的话，点**「换新设备再绑定」**：注册一台干净设备、
  在它连任何一次之前把码绑上，就生效了。

#### 客户端里怎么「选」WARP+ 的节点

**没得选，整族都是。** 授权码是绑在**账号**上、不是绑在**节点**上的，所以它不会
另外长出一份单独的节点 —— 客户端里没有「WARP+ 那一组」这个东西，不用去找。

绑成功后，免费边缘那一族（`162.159.198/199` 那 57 个接入点）**每一个都改走
Argo**，节点名前面会统一多出一个 `W+ ` 标记。重新导入一次订阅就能看到：

```
W+ 198.1-443       <- 主力族，走了 Argo（57 个都长这样）
W+ 官方域名         <- 同上
W2-198.1-443       <- 备胎：另一台账号，没走 Argo
ZT-197.1-443       <- 团队边缘：消费版授权码绑不上去
```

客户端里的用法完全不变：`🚀 节点选择 → ♻️ 自动选择`，或者手选任何一个
`W+ ` 开头的接入点。

为什么只有主力那族带 `W+`：

| 节点名 | 为什么 |
|---|---|
| `W2-` / `W3-`（备胎） | 它们是**另一台账号、另一把密钥**。一个授权码同一时间只能绑一个账号，所以码不覆盖备胎 —— 想让它也走 Argo，得再有一个码单独绑 |
| `ZT-`（团队边缘） | 走团队密钥和 `zt-masque` 团队边缘，消费版授权码**绑不上去**。它本来就走 CF 自己的骨干，不需要绑 |

前缀是**生成期**产物：绑上（或掉出）之后要**重新导入一次订阅**才会出现 / 消失。
管理页的「设备体检」如果查到账号的 WARP+ 状态变了（比如你刚在 1.1.1.1 App 里
把码绑上，本地还没记录），会**自动重建**一次配置，体检提示里也会直接写明
「节点名已加上 `W+ ` 前缀，重新导入即可」。

想验证有没有生效，三条路，从省事到彻底：

1. 客户端里看到 `W+ ` 前缀 —— 最快，一眼。
2. 管理页点「设备体检」，结果里带 `warp_plus` 和剩余额度。
3. 连上之后访问 `https://www.cloudflare.com/cdn-cgi/trace`，
   最后一行是 `warp=plus` 就说明生效了。

**别忘了量一下。** 上面都是「选路」，到底多快得实测。
`python3 scripts/pick_fastest.py --sub warp-masque.yaml --watch --every 30 --min-mbps 5`
会一直盯着，换网络或到点就重测，顺便告诉你快不起来是节点的问题还是上游的问题。

### 看 4K 视频卡，但刷网页正常

**这说明问题不在带宽，在那条视频流上。** 网页和视频对丢包的容忍度完全不同，
而且 Zero Trust（WireGuard / MASQUE）底层都是 UDP，运营商和校园网对
「未知 UDP 大流量」限速很常见。

排一遍：

1. 切到 `🎬 流媒体` 组（默认出口就是 `🎬 流媒体自动`），或手选里面的 `⚡ 聚合`
2. 手动换接入点，重点试 **4443 / 8443 / 8095** 三个端口的节点
3. 用 `fast.com` 量实际吞吐（B站/YouTube 的 4K 要稳定 20-45 Mbps）
4. **关键一步**：断开代理再测一次。两边一对比就知道是隧道慢还是本地出口慢：
   - 断开后很快、连着很慢 → UDP 被 QoS，换端口能缓解，根治要换能走 TCP 的隧道
   - 断开也很慢 → 本地出口本身不够，任何代理都救不了，只能换网络或用手机热点

**要根治 UDP 被限速，只能改成走 TCP 443 的隧道**（伪装成普通 HTTPS，
QoS 设备很难区别对待）。

这里有个容易走错的方向，先说清楚：**Zero Trust 控制台没有「HTTP/2」这个选项。**
`Device profiles → Edit → Device tunnel protocol` 只有两个值 ——
`WireGuard` 和 `MASQUE`，**两个都是 UDP 底层**，切过去解决不了 UDP 被限的问题；
反而官方文档明确警告，切 WireGuard 时如果当前网络封了 WG 的端口/IP，设备会**直接断网**。

真正能走 TCP 的路子只有一条：**自备一个 VLESS / Trojan over TCP+TLS 出口**
（接法同下面 AI 那段：加节点 + `dialer-proxy` 指向 MASQUE 接入点），
或者用机场的单条 TCP 落地。仓库本身只生成 MASQUE 配置，这一跳得自己接。

### 某些国外站打不开（Google Play / 维基 / AI）

三种原因，分开处理：

1. **出口 IP 信誉**。WARP 出口是 Cloudflare 共享段，Play、成人站、AI 站会直接拦。
   在 `🌐 落地出口` 组里换一个落地（Proton / Windscribe / Opera 地区线路）。
2. **双重 QUIC**。规则里已经拦掉了。如果手动在 `🚫 QUIC` 组切成 `DIRECT`
   之后又打不开，切回 `REJECT`。
3. **被判成直连**。Play / 维基 / AI 的域名已经加了内联规则，排在所有 RULE-SET
   前面。还不行就在客户端日志里看这条连接命中的规则名。

**关于 AI 要说清楚**：ChatGPT / Claude 这类对机房 IP 的封锁比 WARP 还狠，
仓库里这三条落地（Opera / Proton / Windscribe）**全是机房 IP**，换过去只能
提高成功率、做不到稳定。要稳就得自备住宅或 VPS 出口，接法跟套 Proton 一样：
加一个 `type: ss/vmess/...` 的节点，`dialer-proxy` 指向 MASQUE 接入点。

### artifact 过期了怎么办

重新跑一次 workflow，会生成一套全新的密钥和配置。artifact 默认存 7 天，
想留久一点在 Run workflow 的时候把保留天数改大。

### iOS 怎么用

用 [ClashMi](https://github.com/KaringX/clashmi)，它内置 mihomo 内核，
`warp-masque.yaml` 直接导入就行，和桌面端一样。

Shadowrocket 也支持 masque。它不认 yaml，但 artifact 里的
`warp-masque-shadowrocket.txt` 就是现成的 `masque://` 链接，
一行一个，复制一条导进去即可。

Surge、Quantumult X、Karing 不行。

### 能选国家吗

纯 WARP（包括 Zero Trust）不行，出口由 Cloudflare 任播决定，你在哪就近落哪。
要指定落地得套一层：Worker 版自带 Opera / Proton / Windscribe 落地，
按国家/地区分组能直接选。Zero Trust 多出一族更稳的骨干，但出口国家
还是得靠落地那一跳选。见[Zero Trust 团队边缘](#zero-trust-团队边缘可选和免费-warp-并存)那节。

### 跑 workflow 报 login failed

```
Failed to connect tunnel: login failed!
```

账号被 Cloudflare 风控了，通常是短时间内建连太频繁导致的。
重新跑一次 workflow 拿新账号就行，另外别把 workflow 改成定时高频跑。

## 想改配置

`scripts/gen_masque.py` 顶部几个常量：

```python
V4    = [...]   # IPv4 接入地址
V6    = [...]   # IPv6 接入地址
PORTS = (...)   # 端口
```

分流规则用的是 ACL4SSR，改 `RULESETS` 那个列表。

出口 IP 敏感的那批域名（Play / 维基 / 成人站）在 `PLAY_DOMAINS` /
`WIKI_DOMAINS` / `ADULT_DOMAINS` 里，想加自己的域名就往对应列表里塞。
**这三个列表在 `worker/src/config.js` 里有一份同样的**，两边要一起改 ——
`worker/test/config.test.mjs` 只测 Worker 那份，那边漏了 CI 不会报。

---

## 套娃：Opera VPN 叠在 WARP 上

纯 WARP 的出口是 Cloudflare 自己的 IP，任播决定落地，选不了国家。
想换出口就得在后面再接一跳。

Opera 浏览器自带的免费 VPN 正好能干这个：底层是 SurfEasy 的标准 HTTPS 代理，
匿名注册、不限流量、连账号都不用。

```
本机 -> MASQUE 接入点 -> Opera 落地 -> 目标
```

### 为什么要套，不直接用 Opera

单用 Opera，你的机器直接连 `77.111.x.x`，这个段一查就知道是什么。
套上 MASQUE 之后本机只跟 `162.159.198.x` 这类 Cloudflare 地址通信，
Opera 的地址整个封在 QUIC 隧道里。抓包对比过，直连能看到 Opera 服务器，
套娃之后完全看不到。

### 全组合

57 个 MASQUE 接入点和每个 Opera 落地都配一遍。落地通常 9 到 11 个，
最终 400 上下的节点。

这么做是为了任一环失效都还有路走：某个接入点被墙了换个端口或换个段，
某个落地挂了同地区还有别的。节点名直接写明链路，`欧洲1@198.1-443`
就是欧洲第 1 个落地经 `162.159.198.1:443` 接入。

组合太多没法平铺着选，按地区收成了 `亚洲线路`、`欧洲线路`、`美洲线路`
三个 url-test 组，各自在本地区所有组合里挑最快的。都开了 `lazy`，
不会一进去就把四百多条全测一遍。

### 怎么跑

Actions 里选 `Opera over MASQUE（套娃）`，点 Run workflow。

跑完配置有两个地方：仓库里的 `configs/opera-masque.yaml`（流水线自动提交回来），
或者运行页面下面的 Artifacts。只想下载不想提交的话，跑之前把 `commit` 勾去掉。

### Opera 凭据会过期

匿名注册的凭据会失效。opera-proxy 自己默认每 4 小时刷一次，
但 API 不返回真实过期时间，给不了准数。连不上就重跑一次换新的。

### 落地只有三个大区

Opera VPN 只提供亚洲、欧洲、美洲，没有国家级选项。实测落地分别是
新加坡、阿姆斯特丹、美东。

### 这条流水线也要 Alpha 内核

`dialer-proxy` 和 `masque` 一样只有 Alpha 分支支持。
Shadowrocket、Stash 不认 `dialer-proxy`，用不了套娃配置——
它们可以用上面纯 WARP 那份。

### 改配置

`scripts/gen_opera_masque.py`。接入点清单和纯 WARP 那份是同一批
（`V4` / `V6` / `PORTS`），`REGIONS` 控制取哪些 Opera 大区。

---

## 跑在 Worker 上

Actions 那条要手动点一下才跑。如果想要它自己更新、随时有个 URL 能拿到最新配置，
用 `worker/` 这份。

一份聚合订阅，导进去有**三族节点**可切，各用各的密钥、互不顶替：

- **WARP直连** — 走免费边缘（`162.159.198/199.x`），出口是 Cloudflare 自己的 IP，
  快但选不了国家。**57 个接入点**
- **ZT团队边缘** — 配了 Zero Trust 之后出现，走 `162.159.197.x` 团队边缘，更稳。
  **4 个接入点**，用的是团队密钥
- **亚洲 / 欧洲 / 美洲线路** — 走 MASQUE 再落 Opera，能换出口国家，多一跳会慢些
- **Proton线路** — 配了 Proton 之后出现，下面按国家分组，可以直接选日本、新加坡等
- **Windscribe线路** — 13 个地区，按地区分组。亚洲只有香港，但 Opera 那三个大区里没有
- **🌐 落地出口** — 出口 IP 敏感站点（Play / 维基 / 成人站 / AI）的专用出口，
  默认按「能换出口的落地 → 团队边缘 → 免费边缘」排优先级，见[默认调优](#默认调优)
- **⚡ 聚合** — 并发连接分散到多条隧道，单隧道跑不快时用。混了免费边缘 + 团队边缘两族
- **⚡ 聚合WARP / ⚡ 聚合ZT** — 上面那个的单族版本。出口要严格统一、或者想定位
  「到底哪一族慢」，切这两个
- **🎬 流媒体** — 视频/测速专用出口，和刷网页的流分开拨不同接入点。看 4K 卡先切这里
- **🚫 QUIC** — QUIC 总开关，默认 `REJECT`，个别 App 要用就切 `DIRECT`

**三族并存是这一份配置的核心。** 两套 WARP 密钥在 CF 那边分开认证 ——
团队密钥喂不进免费边缘，免费密钥也认证不过团队边缘，所以它们谁也不能顶替谁，
必须各生成各自的节点。套娃线路超时或某个落地挂了，切 WARP直连或 ZT团队边缘顶上。

Proton / Windscribe / Opera 那些选国家落地的**首跳（dialer-proxy）会横跨两族**
（依次 `ZT-197.1-443`、`198.1-443`、`ZT-197.2-443`…交错分下去）。这样任一族
整体挂掉时，另一半落地照样能用，不会一次全死。

不用定时任务。Opera 凭据 4 小时到期，Worker 在订阅被访问时才检查：
没过期直接给缓存，过期了才重新注册。没人用就不动，不浪费。

WARP 的注册信息存 KV 里复用，不会每次都注册新设备。

密码和订阅路径都在界面上设，所以部署只需要绑一个 KV，
不用配环境变量，也不用加 cron。

### 部署方式一：网页（不用装任何东西）

全程在 Cloudflare 后台点，四步。

**1. 建 KV**

Cloudflare 后台 → 左边 `存储和数据库` → `KV` → `创建实例`。
名字随便填，比如 `opera-masque`。

> 找不到入口的话，`Workers 和 Pages` 里也能进 KV。菜单名各语言版本略有差异，
> 认准 "KV" 这两个字母。

**2. 建 Worker 并贴代码**

左边 `Compute (Workers)` → `创建` → `从 Hello World! 开始` → 起个名 → `部署`。

先部署一个空壳，然后点右上角 `编辑代码`，把
[`worker/dist/worker.js`](worker/dist/worker.js) 整个文件的内容复制进去，
覆盖掉原来的 `Hello World`。这是打包好的单文件，全选粘贴就行。

粘完点 `部署`。

**3. 绑 KV**

回到 Worker 页面 → `设置` → `绑定` → `添加` → 选 `KV 命名空间`。

- 变量名填 **`KV`**（必须是这两个字母，大写）
- KV 命名空间选第 1 步建的那个

点 `部署`。

**4. 打开设密码**

访问 `https://你的worker名.你的子域.workers.dev`，
第一次打开会让你设管理密码，设完直接进管理页。

订阅地址、改路径、改密码都在这个页面上。

第一次点订阅可能要等十几秒，它在现注册 WARP 和 Opera。

> 没绑 KV 就打开的话，页面会告诉你怎么绑，不会报一堆栈。

### 部署方式二：命令行

```bash
cd worker
npm install
npx wrangler login

# 建 KV，把输出的 id 填进 wrangler.toml
npx wrangler kv namespace create KV

npx wrangler deploy
```

部署完访问 `https://你的worker.workers.dev/` 设密码。
订阅路径也在界面上改，不用动配置文件。

### 改了代码想重新打包

网页部署用的 `dist/worker.js` 是从 `src/` 打包出来的，改完源码跑一下：

```bash
npm run build
```

### 访问控制怎么做的

状态页和所有 API 都要密码。客户端拉订阅时带不了 cookie，所以订阅链接里
挂了个签名 token——状态页上显示的那条完整链接直接复制走就行。

- 密码只存 PBKDF2 哈希 + 随机盐，KV 里看不到明文
- 会话是 HMAC 签名的 token，cookie 里没有密码本身
- 密码比对走常数时间，不会从响应时间里泄露
- 同一 IP 连续失败 8 次锁 15 分钟
- 订阅路径不对或 token 无效，一律返回 404，不提示"密码错误"这类可枚举信息
- 想让所有旧链接失效，在界面上改一次密码就够了（token 是用密码哈希签的）

### 路由

| 路径 | 说明 |
|---|---|
| `/` | 首次是设密码页，之后是登录/管理页 |
| `/login` `/logout` | 登录、退出 |
| 你设的订阅路径 | 默认 `/sub`，要 `?token=` |
| `/api/setup` | POST，首次设密码 |
| `/api/password` | POST，改密码 |
| `/api/sub-path` | POST，改订阅路径 |
| `/api/refresh` | POST，重新拿 Opera 凭据 |
| `/api/reset-warp` | POST，重注册 consumer 免费 WARP 设备（`zt:device` 不动） |
| `/api/diag` | POST，设备体检：逐台问 CF「这台设备还在吗」 |
| `/api/warp/repair` | POST，一键修复：只换被 CF 删掉的免费设备（主力 + 备胎） |
| `/api/warp/rekey` | POST，给免费主力重装 MASQUE 密钥（不换 deviceId） |
| `/api/warp/add` | POST，加一台免费备胎（上限 3 台） |
| `/api/warp/remove` | POST，减一台免费备胎 |
| `/api/cc` | POST，切拥塞控制档位（`extreme` 极速 / `standard` 标准 / `cubic` 回退），会重建配置 |
| `/api/warp/license` | POST，绑 WARP+ 授权码。`{key, fresh}`；`fresh: true` 换新设备再绑。绑定成功后免费边缘整族节点名会带上 `W+ ` 前缀 |

订阅响应带了 `profile-update-interval: 4`，支持这个头的客户端会自己每 4 小时拉一次，
正好卡在凭据到期点上。

### 更新是怎么触发的

没有 cron。订阅每次被访问时，Worker 看一眼 `expiresAt`：

- 还没到期 → 直接给缓存，不碰任何 API
- 到期了 → 重新注册 Opera，重建配置

多个客户端同时拉订阅时会加锁，只有一个真去注册，其他的先用旧配置顶着，
免得并发注册一堆账号触发风控。

4 小时这个数来自 opera-proxy 自己的 `-refresh 4h` 默认值。
SurfEasy 的 API 不返回真实过期时间，所以按这个走，另外留了 10 分钟余量。

### Worker 常见问题

**打开显示 KV Not Bound** — 第 3 步没做，或者绑定的变量名不是 `KV`。
必须是这两个字母大写。

**忘了密码** — 没有找回。去 KV 里把 `auth:cred` 这条删掉，
刷新页面就回到设密码那步。别的数据不受影响。

**订阅链接打开是 404** — token 过期了（7 天），回状态页重新复制一条。
改过密码的话所有旧链接都会失效，这是故意的。

**节点全都连不上** — 先点`刷新 Opera 凭据`。还不行再点`重注册免费 WARP`。

**配了 Zero Trust 之后只剩 ZT- 开头的能用，别的全超时** — 这是旧版 bug
（ZT 一启用就把 consumer 免费设备丢掉，还拿 ZT 密钥去生成免费边缘节点）。
拉最新代码重新 `npm run build` 部署即可，**不用清掉 Zero Trust 重来** ——
KV 里那份 consumer 设备一直都在，新版会重新捡起来用。详见
[Zero Trust 团队边缘](#zero-trust-团队边缘可选和免费-warp-并存)那节。

**不确定是哪一族出问题** — 配置里有 `⚡ 聚合WARP` 和 `⚡ 聚合ZT` 两个单族分组。
分别切过去看组内延迟：只有一族有延迟，问题就在那一族的密钥或边缘上；
两族都不通，那是本地网络/UDP 被 QoS，跟节点无关。

**导入客户端报错说不认识 masque** — 内核不是 mihomo Alpha。见下面那节。

**客户端不认 dialer-proxy** — Shadowrocket、Stash 这类只支持 masque
不支持链式出站，导进去只有 WARP直连（和 ZT团队边缘）那两组能用，
套娃线路会报错。

### Proton 落地（可选）

Opera 只有三个大区，想要更多国家可以再挂一层 Proton。免费版 10 个国家：
加拿大、瑞士、日本、墨西哥、荷兰、挪威、波兰、罗马尼亚、新加坡、美国。

链路和 Opera 那条一样：`本机 → MASQUE → Proton WireGuard → 目标`。

**为什么要多绕一圈流水线**

Proton 必须账号登录，走的是 SRP 协议。这套在 Worker 里能算对（我验过 A 和 M1
跟官方库逐字节一致），但提交时会被 Proton 的风控拦掉，非官方客户端指纹过不去。

所以让 GitHub Actions 去登录、拿证书，再把结果推给 Worker。
Worker 完全不碰 Proton 账号。

**配置步骤**

1. 注册一个 Proton 账号（免费版就行）
2. 仓库 Settings → Secrets → 加 `PROTON_USER`（邮箱）和 `PROTON_PASS`（密码）
3. Worker 管理页的「Proton 落地」区块，点`生成`拿到推送地址
4. 把那个地址加成第三个 secret：`WORKER_PUSH_URL`
5. 跑一次 `取 Proton 凭据` 流水线

之后每 3 天自动续，不用再管。

**关于证书有效期**

Proton 的证书最长 7 天，`Duration` 写再长也封顶（实测 43200 min、525600 min
返回的都是 7 天）。所以流水线每 3 天跑一次，留足余量。

**推送地址的安全性**

令牌在地址里，只能写 Proton 凭据，动不了管理页也拿不到订阅。
泄露了在管理页点「换一个」，旧地址立刻失效。

不配这部分也不影响，其他线路照常工作。

### Windscribe 落地（可选）

Windscribe 的浏览器扩展用的是标准 HTTPS 代理，和 Opera 同一个形态，
所以能直接写成静态节点挂在 MASQUE 后面。

注册不需要邮箱，`POST /Users` 给个随机用户名密码就返回 session。
免费额度**每月 2GB**（官网说的 10GB 要验证邮箱，匿名号拿不到）。

**为什么开户要走流水线**

它的认证只有一行 `md5(固定secret + 时间戳)`，本来在 Worker 里就能跑完。
但**开户和出口 IP 强相关**：一个 IP 开过号之后再开，拿到的是
`status=2` 的降额账号（`traffic_max` 只有 1MB），而这种账号连
`/ServerCredentials` 都取不到：

```
400  errorCode 1700
     "User unable to generate credentials. status = 2"
```

也就是说降额号完全不可用，不是"额度小一点"的问题。

Cloudflare Worker 的出口 IP 是整个平台共享的，早被别人拿去开过号，
所以 Worker 里开不出能用的账号。开户放到 GitHub Actions 上做，
runner 的 IP 干净。

13 个地区，62 台落地：

```
美国东部/中部/西部  加拿大东部/西部  英国  法国  德国  荷兰
挪威  瑞士  罗马尼亚  香港
```

落地是机房 IP，M247 为主。

**配置步骤**

和 Proton 共用同一个推送地址，不用再加 secret：

1. 管理页「Proton 落地」那里生成推送地址，配进 `WORKER_PUSH_URL`
2. 跑一次 `取 Windscribe 账号` 流水线

流水线会自己在地址末尾加 `/wind`。它开完号会先验一次能不能取到代理凭据，
拿到降额号就直接失败退出，不会把不能用的号推给 Worker。

**流量用完了怎么办**

管理页「Windscribe 落地」区块能看到本月用了多少。用完重跑一次流水线换个号。

偶尔会碰上 runner 的 IP 被别人用过，这时流水线会报
`拿到的是降额账号 status=2`，重跑一次换台机器就行。

流水线也配了每月 1 号自动跑一次，对上 Windscribe 的月度重置。

### Zero Trust 团队边缘（可选，和免费 WARP **并存**）

> ⚠️ **先纠正一个常见误解**：Zero Trust 不是「把免费 WARP 换掉」，而是
> **多注册一台设备、多出一族节点**。

CF 那边两套密钥是**分开认证**的：

| | 密钥来源 | 能用的边缘 |
|---|---|---|
| consumer 免费 WARP | Worker 自己注册，或 Actions 流水线 | `162.159.198/199.x` |
| Zero Trust 团队设备 | Team Token (JWT) 注册 | `162.159.197.x` |

团队密钥喂进免费边缘会 login 失败，免费密钥认证团队边缘同样过不去。
所以**两族节点必须各生成各自的**，谁也不能顶替谁 —— 一份配置里同时放着，
客户端按组切换。

**它们共用什么、不共用什么：**

- **不共用**：接入点。免费边缘 57 个走免费密钥，团队边缘 14 个走团队密钥
- **共用**：落地族（Proton / Windscribe / Opera）。它们的首跳在两族之间
  轮流分（`ZT-197.1-443` → `198.1-443` → `ZT-197.2-443` → …），
  所以任一族整体挂掉时，另一半落地照样能用

Zero Trust 团队边缘实测比 `198/199` 那批免费边缘更稳，连断都少。
免费套餐 50 个席位、不限速。

订阅里会多出 **ZT团队边缘** 直连组和 **⚡ 聚合ZT** 分组，
**WARP直连**（免费边缘）和 **⚡ 聚合WARP** 依然在。

**关于选国家要说清楚**：Zero Trust 免费版**不能直接选出口国家**，出口仍由
Cloudflare 任播就近落（多半是旧金山）。要选国家走的是上面 Proton /
Windscribe / Opera 那几条落地。Zero Trust 的作用是多给一族更稳的骨干 ——
组合起来就是「快的骨干 + 能选国家」。

**为什么 JWT 只有 60 秒**：Zero Trust 注册要一个 Team Token（JWT），从
`https://<你的团队名>.cloudflareaccess.com/warp` 走完邮箱验证码登录后拿到。
这个 token 只有 60 秒寿命，必须拿到立刻用。注册成功后存的是长期有效的设备
凭据，不用反复粘。

#### 方式一：在 Worker 管理页粘 JWT（推荐）

管理页「Zero Trust 团队边缘」区块有个输入框，把 JWT 粘进去点「立即注册」。
Worker 当场调 Cloudflare API 注册，校验落在 team 账户上才存，否则报错。
全程不用 Actions、不用服务器。

拿 JWT：浏览器开上面的地址，登录后在成功页面找 `meta http-equiv="refresh"`，
`token=` 后面那串就是；或控制台跑
`document.querySelector("meta[http-equiv='refresh']").content.split("=")[2]`。

#### 方式二：Actions 流水线（留存档 / 自动推送）

Actions 里选 `取 Zero Trust 凭据`，把 JWT 粘进 `jwt` 输入框跑。用 usque 注册，
打成 blob，推到 Worker（和 Proton/Windscribe 共用 `WORKER_PUSH_URL`，末尾加
`/zt`）。没配推送地址就只在 artifact 里留一份。

两种方式产出的设备结构一样，选一种就行。设备长期有效，除非团队边缘整体连不上
再重跑换设备。

#### 常见坑：启用 Zero Trust 后「只剩 ZT 能用了」

这是**旧版的 bug**，已修。旧版 `rebuild()` 里写的是

```js
const warp = zt || await getWarp(env, forceWarp && !zt);
```

ZT 设备一上位就把 consumer 那份整个丢掉，而生成节点时又拿 **ZT 的密钥**
去生成 `198/199` 那 57 个免费边缘节点 —— 那些节点在 CF 那边认证不过，
客户端里全部超时。**现象就是「只有 ZT 那 4 个能用，而且感觉只有一条隧道所以慢」。**

现在两份设备各存各的 KV 键（`warp:device` / `zt:device`），各生成各的节点，
互不覆盖。如果你的部署还是旧版，拉最新代码重新 `npm run build` 再部署即可 ——
**不需要清掉 Zero Trust 重来**，KV 里那份 consumer 设备一直都在。

#### 现在「重注册 WARP」按钮做什么

只重注册**免费那份**（`warp:device`），`zt:device` 不动。
以前 ZT 一在就整个拒绝，是因为那时两份是二选一的关系；现在并存了，没有这个限制。

要换 Zero Trust 设备仍得走「清除 ZT → 粘一份新 JWT」—— ZT 注册要新的 60 秒
JWT，没法静默重做。

「重注册」是**换一台新设备**（deviceId 会变）。如果设备本身在 CF 那边还活着、
只是本地这把密钥认证不过，用管理页**「重装免费密钥」**更温和 —— 它不换 deviceId。
两者的区别、以及新加的整套体检按钮，见
[WARP 节点全死了 / 只剩 Zero Trust 能用](#warp-节点全死了--只剩-zero-trust-能用)。

### 跑测试

```bash
cd worker && npm test
```

567 项，覆盖常数时间比较、token 伪造/篡改/过期、登录限速、并发初始化，
Proton/Windscribe/Zero Trust 凭据推送（令牌校验、坏数据、降额/非 team 账户拒绝、
换令牌失效），配置结构（分组完整性、无悬空引用、直连组成员正确、**两族密钥不串族**、
**两族并存时三族节点都活**、**落地首跳横跨两族**、聚合组只收 IPv4 接入点、
自动选择不再嵌套引用分组、**国内 QUIC 放行排在境外 QUIC 拦截之前**、
**测速组用精选池且少于全量**、**WARP直连改按需测速**、
**流媒体默认出口是 url-test 而不是嵌套 load-balance**、敏感域名规则排在 RULE-SET 之前、
流媒体 CDN
走 🎬 流媒体、MATCH 排在 GEOIP,CN 之后、规则无重复、DNS 不吃 AAAA），
以及路由层的鉴权（未登录一律 404、订阅 token 校验、按需重建、cookie 安全属性），
还有设备存活体检 / 一键修复 / 重装密钥 / 备胎增删（体检能点名是哪台设备死了、
只读不重建、结果写回 state；修复只换死掉的那台、活的不动；重装不换 deviceId；
备胎到上限会拒绝），以及管理页渲染（三族设备都列出来、体检三态的显示各自正确、
降级路径不抛异常、页面里不出现私钥和设备 token），
还有拥塞控制档位与 WARP+（三档各自下发的键正确、**回退档一个键都不下发**、
非法档位静默退回默认而不抛错、档位对免费边缘/ZT/备胎三族都生效、
选点参数收紧但测速池不跟着变大、授权码格式校验（两段式/四段式/非法字符/尖括号自动剥离）、
**「绑了但 warp_plus 仍是 false」这种半成功状态不谎报成功**、
换新设备再绑定会真的重新注册一台、体检顺带读出 `warp_plus` 与额度并写回 KV，
体检保留了授权码前 4 位不被擦掉），
以及 WARP+ 的节点名前缀（默认一个都不加、绑上后免费边缘整族都加、备胎与 ZT
**不加**、组引用跟着改名不留悬空引用、前缀不改变测速池大小、
状态翻转时体检会自动重建并去掉前缀），
以及「让它一直能用」的整套不变量（测试地址全部 HTTPS、严格档组必须带
**带引号**的 `expected-status: "204"`、宽松档组不能带、流媒体族 300/150 而
网页族 60/10、兜底链是 fallback 且含 `🌐 落地出口`、**整条默认链不含
`load-balance`**、`🎬 流媒体` 首个成员是兜底链、手选通道仍在、
**PLAY 与 STREAM 两个域名表无交集**、YouTube 全套 9 个主机命中同一个组、
`yt3.ggpht.com` 不再漂到落地出口、Netflix / Disney+ / Prime / Spotify / TikTok
各自整族同出口、流媒体主机都显式钉了境外 DNS），
以及管理页新增的「一直能用 · 三层自动恢复」区块（三层各有关键说明、
五步排查顺序在、诚实边界在、旧的「默认走流媒体自动」说法已清除）。

### 两个坑

**WebCrypto 导不出 mihomo 要的私钥格式。** WebCrypto 只能导 PKCS8，
mihomo 要 SEC1，直接喂会报 `use ParsePKCS8PrivateKey instead`。
而且光把 PKCS8 里那段抠出来还不够——WebCrypto 省略了曲线参数，
会接着报 `unknown elliptic curve`。`warp.js` 里的 `pkcs8ToSec1`
重新编了一份带 P-256 OID 的完整 SEC1。

**Opera 的 API 用 Digest 认证，而 Digest 要 MD5。** WebCrypto 没有 MD5，
所以 `md5.js` 是手写的。另外 Workers 的 fetch 不自动管 cookie，
SurfEasy 的会话得手工存 `Set-Cookie`。

### 跟 Actions 版的区别

Worker 版少一道 `mihomo -t` 校验——Actions 里会真的下载 mihomo 加载一遍，
确保推出去的配置能用，Worker 里做不到。

换来的是自动更新和一个随时可用的 URL。
