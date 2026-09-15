// 生成 mihomo 配置：MASQUE 接入点 x Opera 落地 全组合。
// 接入点清单是真机握手实测筛过的，别往回加 162.159.194/196/197/204
// 和 v6 的 102/105 段 —— 它们回 QUIC 包但 login 失败。
//
// 端口 4443 和 8095 是后来补测出来的，4 个 v4 地址 x 这两个端口 8/8 全通。
const V4 = ["162.159.198.1", "162.159.198.2", "162.159.199.1", "162.159.199.2"];
const V6 = ["2606:4700:103::1", "2606:4700:103::2",
            "2606:4700:104::1", "2606:4700:104::2"];
const PORTS = [443, 500, 1701, 4500, 4443, 8443, 8095];
// 精选端口。给「♻️ 自动选择 / 🎬 流媒体自动」这类**要全员测速**的组用。
//
// 手机上并发做 30+ 次 MASQUE 握手会被系统/电量策略限制，测不完的直接
// 显示超时 —— 用户看到的就是「可用节点太少」，而且开机后一阵子整机发卡。
// 手机上这两组各测 17 个（4 端口 x 4 个 IPv4 + 官方域名）比原来各测 33 个
// 轻一半，覆盖度却几乎不降：443 是通用口，4443/8095 是实测最容易被 QoS
// 漏过的冷门口，8443 是通用备选。
// 全量 7 个端口仍在 WARP直连 / 🎬 流媒体 组里，切过去能手选。
const PICK_PORTS = [443, 4443, 8443, 8095];
// 备用免费设备（备胎）出哪些端口。两台设备存在的意义是「证明这把密钥
// 是活的、并且给出几条能走的隧道」，不需要全量回退面：443 是通用口，
// 8095 是实测最容易被运营商 QoS 漏过的冷门口。
// 为什么不给全量：这些节点会进「♻️ 自动选择 / 🎬 流媒体自动」的测速池，
// 手机上每多一个成员就多一次并发 QUIC 握手 —— 之前 127 次并发
// 直接把手机打崩，池子必须压住。
const EXTRA_PORTS = [443, 8095];
const TEAM_V4 = ["162.159.197.1", "162.159.197.2"];
// 团队边缘端口。官方防火墙文档写得很明确：MASQUE 的 ingress 是
// 162.159.197.0/24，默认端口 UDP 443，回退端口 500 / 1701 / 4500 /
// 4443 / 8443 / 8095。原来这里只放 443 和 8443 两个端口，一共 4 个节点，
// 只要其中一个端口被链路掐掉就塌掉一半 —— 用户反馈「Zero Trust 只有两个
// 能用」正是端口给少了。七个端口全放上，14 个节点，被掐一个还有别的。
const TEAM_PORTS = [443, 500, 1701, 4500, 4443, 8443, 8095];
const ZT_SNI = "zt-masque.cloudflareclient.com";


// 免费（消费版）边缘的 SNI。mihomo 在 masque 出站里不写 sni 时的默认值
// 就是它（transport/masque/masque.go 的 ConnectSNI 常量），这里显式写出来
// 只为了一件事：「官方域名」那个节点的 SNI 早期被误设成了团队版的
// zt-masque.cloudflareclient.com。消费版密钥配团队版 SNI，边缘会直接
// 拒绝 —— 那个节点是恒死的。
//
// 两族 SNI 分工：消费版密钥 -> consumer-masque，团队版密钥 -> zt-masque。
// 混用一定连不上，因为 CF 边缘按 SNI 把连接分给不同的 MASQUE 服务。
const CONSUMER_SNI = "consumer-masque.cloudflareclient.com";
// CF 没有 A 记录指向 MASQUE 段，官方域名只能用在 SNI 上
const SNI_NODE = ["162.159.198.1", 443];

const RS = "https://raw.githubusercontent.com";
const RULESETS = [
  ["🎯 全球直连", RS + "/cmliu/ACL4SSR/refs/heads/main/Clash/CFnat.list"],
  ["🎯 全球直连", RS + "/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list"],
  ["🎯 全球直连", RS + "/ACL4SSR/ACL4SSR/master/Clash/UnBan.list"],
  ["🛑 全球拦截", RS + "/ACL4SSR/ACL4SSR/master/Clash/BanAD.list"],
  ["🍃 应用净化", RS + "/ACL4SSR/ACL4SSR/master/Clash/BanProgramAD.list"],
  ["🍃 应用净化", RS + "/cmliu/ACL4SSR/main/Clash/adobe.list"],
  ["🍃 应用净化", RS + "/cmliu/ACL4SSR/main/Clash/IDM.list"],
  ["📢 谷歌FCM", RS + "/ACL4SSR/ACL4SSR/master/Clash/Ruleset/GoogleFCM.list"],
  ["🎯 全球直连", RS + "/ACL4SSR/ACL4SSR/master/Clash/GoogleCN.list"],
  ["🎯 全球直连", RS + "/ACL4SSR/ACL4SSR/master/Clash/Ruleset/SteamCN.list"],
  ["Ⓜ️ 微软服务", RS + "/ACL4SSR/ACL4SSR/master/Clash/Microsoft.list"],
  ["🍎 苹果服务", RS + "/ACL4SSR/ACL4SSR/master/Clash/Apple.list"],
  ["📲 电报信息", RS + "/ACL4SSR/ACL4SSR/master/Clash/Telegram.list"],
  ["🤖 AI服务", RS + "/ACL4SSR/ACL4SSR/master/Clash/Ruleset/OpenAi.list"],
  ["🤖 AI服务", RS + "/juewuy/ShellClash/master/rules/ai.list"],
  ["🤖 AI服务", RS + "/cmliu/ACL4SSR/main/Clash/Copilot.list"],
  ["🤖 AI服务", RS + "/cmliu/ACL4SSR/main/Clash/GithubCopilot.list"],
  ["🤖 AI服务", RS + "/cmliu/ACL4SSR/main/Clash/Claude.list"],
  ["🤖 AI服务", RS + "/cmliu/ACL4SSR/main/Clash/Gemini.list"],
  ["📹 油管视频", RS + "/ACL4SSR/ACL4SSR/master/Clash/Ruleset/YouTube.list"],
  ["🎥 奈飞视频", RS + "/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Netflix.list"],
  ["🌍 国外媒体", RS + "/ACL4SSR/ACL4SSR/master/Clash/ProxyMedia.list"],
  ["🌍 国外媒体", RS + "/cmliu/ACL4SSR/main/Clash/Emby.list"],
  ["🚀 节点选择", RS + "/ACL4SSR/ACL4SSR/master/Clash/ProxyLite.list"],
  ["🚀 节点选择", RS + "/cmliu/ACL4SSR/main/Clash/CMBlog.list"],
  ["🎯 全球直连", RS + "/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list"],
  ["🎯 全球直连", RS + "/ACL4SSR/ACL4SSR/master/Clash/ChinaCompanyIp.list"]
];

function entryName(ip, port) {
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `v6-${parts[2]}-${parts[parts.length - 1]}-${port}`;
  }
  return `${ip.split(".").slice(2).join(".")}-${port}`;
}

function masqueNode(name, ip, port, priv, pub, v4, v6, sni) {
  // 裸 IPv6 含冒号，YAML 里必须加引号否则被当成映射
  const srv = ip.includes(":") ? `"${ip}"` : ip;
  const extra = sni ? `\n    sni: ${sni}` : "";
  return `  - name: ${name}
    type: masque
    server: ${srv}
    port: ${port}${extra}
    private-key: ${priv}
    public-key: ${pub}
    ip: ${v4}
    ipv6: ${v6}
    mtu: 1280
    udp: true
    remote-dns-resolve: true
    dns: [1.1.1.1, 2606:4700:4700::1111]`;
}

/** 生成一台设备能用的全部 MASQUE 接入点。
 *
 * 两套密钥在 CF 那边是分开认证的，谁也不能顶替谁：
 *   consumer 设备     -> 免费边缘 162.159.198/199.x（外加官方域名 SNI 节点）
 *   Zero Trust 设备   -> 团队边缘 162.159.197.x（zt-masque SNI）
 *
 * 免费号喂 197.x 会 login 失败；反过来把 198/199 喂给团队号同样认不过。
 * 所以这里按 zeroTrust 标志「只出自己那一套」。
 *
 * 以前的写法是无条件先把 198/199 那 57 个生成出来，再在 ZT 设备上追加
 * 团队边缘 —— 结果 ZT 一上位，那 57 个节点全部变成永远超时的死节点，
 * 客户端里表现就是「只有 ZT 能用、别的全连不上」。
 *
 * slot 是**第几台免费设备**（1 起）：
 *   slot 1 出全集（4 个 IPv4 + 4 个 IPv6 x 7 端口 = 57 个），是主力；
 *   slot>=2 只出精选端口 x IPv4（16 个），节点名带 W2-/W3- 前缀。
 * 备胎不需要那么宽的回退面，但要能被「♻️ 自动选择」测到 —— 主力那台
 * 被 CF 清掉时，备胎是同一族里唯一还活着的节点。 */
function buildEntries(dev, { slot = 1 } = {}) {
  const { privateKey: priv, peerPublicKey: pub, ipv4: v4, ipv6: v6, zeroTrust } = dev;
  // v4Entries 单独留一份：做 dialer-proxy 目标时只能用 IPv4，
  // 否则纯 IPv4 的机器上会直接 "network is unreachable"。
  const entries = [], v4Entries = [], proxies = [];
  const tag = slot > 1 ? `W${slot}-` : "";

  // 团队边缘。节点名带 "ZT-" 前缀，客户端里一眼能分清是哪一族。
  if (zeroTrust) {
    for (const ip of TEAM_V4) {
      for (const port of TEAM_PORTS) {
        const n = `ZT-${entryName(ip, port)}`;
        entries.push(n);
        v4Entries.push(n);
        proxies.push(masqueNode(n, ip, port, priv, pub, v4, v6, ZT_SNI));
      }
    }
    return { entries, proxies, v4Entries,
             teamEntries: [...entries], teamProxies: [...proxies] };
  }

  // 免费边缘。57 个接入点是真机握手实测筛过的，别往回加
  // 162.159.194/196/197/204 和 v6 的 102/105 段 —— 它们回 QUIC 包但 login 失败。
  const ips = slot > 1 ? V4 : [...V4, ...V6];
  const ports = slot > 1 ? EXTRA_PORTS : PORTS;
  for (const ip of ips) {
    for (const port of ports) {
      const n = tag + entryName(ip, port);
      entries.push(n);
      if (!ip.includes(":")) v4Entries.push(n);
      proxies.push(masqueNode(n, ip, port, priv, pub, v4, v6));
    }
  }
  // 官方域名只给主力那份出。它是「用户能一眼看懂」的兜底节点，
  // 备胎不需要。SNI 必须是消费版的（以前误用了团队版的，恒死）。
  if (slot === 1) {
    entries.push("官方域名");
    v4Entries.push("官方域名");   // 官方域名节点本身连的是 IPv4
    proxies.push(masqueNode("官方域名", SNI_NODE[0], SNI_NODE[1],
                            priv, pub, v4, v6, CONSUMER_SNI));
  }
  return { entries, proxies, v4Entries, teamEntries: [], teamProxies: [] };
}

// 规则集只盖到 OpenAI / Claude / Gemini / Copilot，其他家没人维护。
// 这批是自己补的，走 DOMAIN-SUFFIX 精确匹配。
//
// 注意别往里加 googleapis.com、cloudflare.com、stripe.com 这类共用域名 ——
// 上游的 ai.list 就干了这事（它把整个 googleapis.com 和 bing.com 都算 AI），
// 会把大量无关流量拽进 AI 分组。这里只放各家自己的域名。
const AI_DOMAINS = [
  // OpenAI（规则集已有 openai.com/chatgpt.com/sora.com，这几个是补的）
  "openai.fm", "operator.chatgpt.com", "chat.com",
  // Anthropic
  "anthropic.com", "claude.ai", "claudeusercontent.com",
  // Google
  "gemini.google.com", "aistudio.google.com", "generativelanguage.googleapis.com",
  "notebooklm.google.com", "notebooklm.google", "labs.google", "deepmind.com",
  // xAI
  "x.ai", "grok.com",
  // Meta
  "meta.ai",
  // Perplexity
  "perplexity.ai", "pplx.ai", "perplexity.com",
  // Mistral
  "mistral.ai", "chat.mistral.ai",
  // Cohere / AI21 / Together / Fireworks / Groq
  "cohere.com", "cohere.ai", "ai21.com", "together.ai", "together.xyz",
  "fireworks.ai", "groq.com",
  // 开源社区与推理平台
  "huggingface.co", "hf.co", "huggingface.js.org",
  "replicate.com", "replicate.delivery", "runpod.io", "modal.com",
  "openrouter.ai", "poe.com", "quora.com",
  // 编程助手
  "cursor.com", "cursor.sh", "codeium.com", "windsurf.com",
  "tabnine.com", "sourcegraph.com", "phind.com", "v0.dev", "v0.app",
  "bolt.new", "lovable.dev", "devin.ai", "cognition.ai",
  // 图像与视频
  "midjourney.com", "stability.ai", "stablediffusionweb.com",
  "leonardo.ai", "runwayml.com", "pika.art", "lumalabs.ai",
  "ideogram.ai", "recraft.ai", "krea.ai", "civitai.com",
  // 语音
  "elevenlabs.io", "eleven-labs.com", "play.ht", "suno.com", "suno.ai",
  "udio.com", "assemblyai.com", "deepgram.com",
  // 搜索与写作
  "you.com", "kagi.com", "exa.ai", "tavily.com",
  "jasper.ai", "copy.ai", "writesonic.com", "notion.so",
  // 观测与工具链
  "langchain.com", "langsmith.com", "wandb.ai", "weightsandbiases.com",
  "pinecone.io", "weaviate.io", "qdrant.tech", "chromadb.com",
  // 国产（默认也走代理，很多在国内反而连不上或要境外号）
  "deepseek.com", "moonshot.cn", "moonshotai.com", "kimi.com",
  "bigmodel.cn", "zhipuai.cn", "z.ai",
  "minimaxi.com", "minimax.io", "hailuoai.com",
  "siliconflow.cn", "dashscope.aliyuncs.com",
];

// 出口 IP 敏感的域名。共同点是：目标站会按「是不是机房/VPN IP」拦人，
// 而 WARP 的出口是 Cloudflare 共享段，被大量站点标成数据中心。
// 走到 🌐 落地出口 换一次出口（Opera/Proton/Windscribe 的机房），能救回一部分。
const PLAY_DOMAINS = [
  // Google Play 本体 + 下载 CDN。下载 CDN 是最常被漏掉的一环：
  // 商店页面能打开、但装不上 / 更新失败，基本都是 *.gvt1.com / dl.google.com
  // 没走代理，落到国内直连去了。
  "play.google.com", "play.googleapis.com", "android.clients.google.com",
  "dl.google.com", "dl-ssl.google.com",
  "gvt1.com", "gvt2.com", "gvt3.com",
  "ggpht.com", "googleusercontent.com",
];

// 维基媒体。国内直连解析会被污染，必须走代理 + 境外 DNS 一起上。
const WIKI_DOMAINS = [
  "wikipedia.org", "wikimedia.org", "wikidata.org", "wikisource.org",
  "wiktionary.org", "wikibooks.org", "wikinews.org", "wikiversity.org",
  "wikiquote.org", "mediawiki.org",
];

// 成人站对 Cloudflare 段的封禁最彻底（直接 403），没有别的办法，只能换出口。
// 不想要这段就直接删掉这个常量，下面的循环会跟着空转，不影响其他部分。
const ADULT_DOMAINS = [
  "pornhub.com", "pornhubpremium.com", "xvideos.com", "xnxx.com",
  "xhamster.com", "redtube.com", "youporn.com", "spankbang.com",
  "beeg.com", "eporner.com", "txxx.com", "hqporner.com",
];

// 流媒体 / 测速 / 大文件下载 —— 这些是「跑满带宽」的流量，也是唯一会把
// 单条 MASQUE 隧道（UDP）压到先被 QoS 打击的那条流。单独拆出来，是为了
// 能把它们和普通网页分开拨到不同的接入点上（见 🎬 流媒体 组）。
const STREAM_DOMAINS = [
  // 油管 / 奈飞 / 迪士尼 / 亚马逊 / HBO
  "googlevideo.com", "youtube.com", "youtu.be", "ytimg.com", "ggpht.com",
  "netflix.com", "nflxvideo.net", "nflximg.net", "nflxso.net",
  "disneyplus.com", "dssott.com", "bamgrid.com",
  "primevideo.com", "aiv-cdn.net", "aiv-delivery.net",
  "hbomax.com", "max.com",
  // 音乐 / 直播 / 短视频
  "spotify.com", "scdn.co", "twitch.tv", "ttvnw.net", "vimeo.com",
  "vimeocdn.com", "tiktokcdn.com", "tiktokcdn-us.com", "ibytedtos.com",
  // 测速站点（Fast/Speedtest 是最好用的「隧道真实吞吐」量尺）
  "fast.com", "speedtest.net",
];

// 域名 -> 分组，拼内联规则用
const SENSITIVE_ROUTES = [
  ...PLAY_DOMAINS.map((d) => ["DOMAIN-SUFFIX", d, "🌐 落地出口"]),
  ...WIKI_DOMAINS.map((d) => ["DOMAIN-SUFFIX", d, "🌐 落地出口"]),
  ...ADULT_DOMAINS.map((d) => ["DOMAIN-SUFFIX", d, "🌐 落地出口"]),
];

const q = (a, n = 6) => a.map((x) => " ".repeat(n) + `- "${x}"`).join("\n");
const p = (a, n = 6) => a.map((x) => " ".repeat(n) + `- ${x}`).join("\n");

/** 两个池子交错合并：[a0, b0, a1, b1, ...]。
 *
 * 落地族的首跳（dialer-proxy）按这个顺序轮着分。交错的目的是让
 * 「免费边缘」和「ZT 团队边缘」两族各承担一半落地 —— 任何一族整体
 * 挂掉（比如团队边缘被 Gateway 策略掐了、或者免费边缘被 QoS 打崩），
 * 另一半的落地照样能用，不会一次全死。 */
function interleave(a, b) {
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

/** rule-providers 和 rules，两种配置共用。 */
function buildRules() {
  const prov = [], rules = [];
  RULESETS.forEach(([group, url], i) => {
    const pn = `rule${String(i).padStart(2, "0")}`;
    prov.push(`  ${pn}:
    type: http
    behavior: classical
    format: text
    interval: 86400
    url: ${url}
    path: ./ruleset/${pn}.list`);
    rules.push(`  - RULE-SET,${pn},${group}`);
  });

  // 排在最前面的几条，顺序不能动：
  //
  // 1) QUIC 两连招，顺序不能颠倒。
  //    a. 国内流量的 QUIC 放行直连：B站 / 微信 / 抖音 / 淘宝 / 支付宝
  //       这些国内 App 全靠 QUIC 提速，一刀切 REJECT 等于让它们每次先
  //       失败一次再回退 TCP —— 手机上就是「一打开就转圈」。这条只匹配
  //       UDP 443，不碰 TCP，不会把本该代理的流量放走。geosite 数据没
  //       下载成功时这条永不匹配，安全降级到下一条。
  //    b. 境外 QUIC 交给 🚫 QUIC 组（默认 REJECT）：MASQUE 隧道里再跑
  //       QUIC 等于双层 QUIC，握手和丢包恢复都被放大；拦掉后 App 立刻
  //       拿到拒绝、迅速回退 TCP，比让它去连被墙的黑洞（超时好几秒）快。
  //       哪天某个 App 非要 QUIC，在客户端的 🚫 QUIC 组里切成 DIRECT 即可。
  // 2) speed.cloudflare.com 钉走代理 —— 本地测速脚本要用它量真实吞吐，
  //    不能让它落到直连（否则量到的是你自家宽带的速度）。
  // 3) 出口 IP 敏感的域名（Play / 维基 / 成人站）走 🌐 落地出口。
  // 4) 流媒体 / 测速域名走 🎬 流媒体，和刷网页的流量分开拨到不同接入点。
  //    规则集里的 YouTube/Netflix 只盖到主域，Disney+ 的 dssott、
  //    Prime 的 aiv-cdn、Twitch 的 ttvnw、TikTok 的 ibytedtos 都不在里面 ——
  //    这些才是 4K 真正拉流的 CDN，漏掉就回落到漏网之鱼了。
  const head = [
    `  - AND,((NETWORK,UDP),(DST-PORT,443),(GEOSITE,cn)),DIRECT`,
    `  - AND,((NETWORK,UDP),(DST-PORT,443)),🚫 QUIC`,
    `  - DOMAIN-SUFFIX,speed.cloudflare.com,🚀 节点选择`,
  ];
  for (const [type, domain, target] of SENSITIVE_ROUTES) {
    head.push(`  - ${type},${domain},${target}`);
  }
  for (const d of STREAM_DOMAINS) {
    head.push(`  - DOMAIN-SUFFIX,${d},🎬 流媒体`);
  }

  // 内联的 AI 域名放在 RULE-SET 前面，别被上游规则集里更宽的条目抢先命中
  const ai = AI_DOMAINS.map((d) => `  - DOMAIN-SUFFIX,${d},🤖 AI服务`);
  return { prov: prov.join("\n"), rules: [...head, ...ai, ...rules].join("\n") };
}

/** 公共头部：端口、DNS、sniffer 那一堆。 */
function head(ipv6) {
  return `mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
ipv6: ${ipv6}
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
  # 这里故意写死 false，不跟顶层的 ipv6 走：
  # fake-ip 模式下如果还回答 AAAA，客户端会优先拿 IPv6 去连目标，
  # 本地 IPv6 出口烂的时候就是「延迟不高但打不开 / 特别慢」。
  # 顶层 ipv6 保持 true，是为了让 IPv6 接入点本身还能用（那是直连字面地址，不走 DNS）。
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
    # 下面这些经常被地理库误判成「国内」，一旦判成直连就直接死了，
    # 显式钉到境外 DNS，绕开误判。和上面的 inline 规则是两码事：
    # 这里只管解析，路由走哪条看 rules。
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
      - https://8.8.8.8/dns-query`;
}

/** 下游分组（油管/奈飞/OpenAI 那些），两种配置共用。
 *  picks 是给「节点选择」之外的组用的候选列表。 */
function tailGroups(picks) {
  return `  - name: 📹 油管视频
    type: select
    proxies:
      - 🚀 节点选择
      - ♻️ 自动选择
      - 🔄 故障转移
${p(picks)}

  - name: 🎥 奈飞视频
    type: select
    proxies:
      - 🚀 节点选择
      - ♻️ 自动选择
      - 🔄 故障转移
${p(picks)}

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
      - 🌐 落地出口
      - 🚀 节点选择
      - ♻️ 自动选择
      - 🔄 故障转移
${p(picks)}

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
      - ♻️ 自动选择`;
}

/** 生成 mihomo 配置。
 *
 * warp —— consumer 免费 WARP 设备（免费边缘 198/199）
 * ztDevice —— Zero Trust 团队设备（团队边缘 197.x），可选
 *
 * 两份设备是**并存**的，不是二选一：各自的密钥只能认证自己那套边缘，
 * 所以三族节点（WARP免费边缘 / ZT团队边缘 / Proton-Windscribe-Opera 落地）
 * 都能在同一份订阅里活着、都能单独选。以前是 zt 一有就把 warp 丢掉，
 * 结果免费边缘那 57 个节点全废，只剩 ZT 那 4 个能用。
 *
 * 兼容老调用：只传一份 ZT 设备当 warp 时，自动归到 ZT 那一路。
 */
/** 备用免费设备的上限。每台只出精选端口池（16 个节点），
 * 3 台就是 48 个 —— 再多会把订阅撑得很难看，收益却很小。 */
export const MAX_EXTRA_DEVICES = 3;

export function buildConfig(warp, opera, proton, wind, ztDevice = null, extraWarps = []) {
  let freeDev = warp, ztDev = ztDevice;
  if (warp && warp.zeroTrust) { ztDev = warp; freeDev = null; }

  const free = freeDev ? buildEntries(freeDev, { slot: 1 }) : null;
  const zteam = ztDev ? buildEntries(ztDev) : null;

  // 备用免费设备（备胎）。每台是**另一个免费账号、另一把密钥** ——
  // 主力那台被 CF 清掉 / 密钥失效时，这一族还有活节点在，不至于
  // 「warp 的节点全死、只剩 ZT 能用」。只出精选端口池，免得把订阅撑爆。
  // 带 zeroTrust 标记的走错了数组，直接忽略（那是 ZT，不是备胎）。
  const extras = (extraWarps || [])
    .filter((d) => d && d.privateKey && d.ipv4 && !d.zeroTrust)
    .slice(0, MAX_EXTRA_DEVICES)
    .map((d, i) => buildEntries(d, { slot: i + 2 }));

  const freeEntries = free ? free.entries : [];
  const freeV4 = free ? free.v4Entries : [];
  const extraEntries = extras.flatMap((e) => e.entries);
  const extraV4 = extraEntries;     // 备胎只出 IPv4，天然就是 v4 池
  const teamEntries = zteam ? zteam.teamEntries : [];
  const zt = teamEntries.length > 0;

  // 三族接入点各用各的密钥，一起进 proxies 池，谁也别顶替谁
  const proxies = [];
  if (free) proxies.push(...free.proxies);
  for (const e of extras) proxies.push(...e.proxies);
  if (zteam) proxies.push(...zteam.proxies);

  // 全部接入点（含 IPv6）：Opera 的笛卡尔积要的是回退面最广
  const frontAll = [...freeEntries, ...extraEntries, ...teamEntries];
  // 只有 IPv4 的接入点：WireGuard 的 UDP 和 load-balance 都必须走这个
  const frontV4 = [...freeV4, ...extraEntries, ...teamEntries];
  // 免费那一族（主力 + 备胎）。它单独留一份，是因为「WARP直连 / 聚合WARP」
  // 要按**族**暴露给用户：切到这一组就能看出免费族整体活不活。
  const warpAll = [...freeEntries, ...extraEntries];
  const warpV4 = [...freeV4, ...extraV4];
  if (!frontAll.length) {
    throw new Error("没有可用的 MASQUE 接入点：consumer WARP 和 Zero Trust 设备都缺失");
  }

  // 落地族的首跳（dialer-proxy）池。ZT 那 14 个比免费边缘稳，但不该让全部
  // 落地都压在同一族 —— 交错开，任何一族整体挂掉时另一半落地照样能用。
  // 只收 IPv4：WireGuard/HTTPS 的 UDP 经 IPv6 接入点发出去，在纯 IPv4
  // 的机器上是 network is unreachable。
  const dialerPool = zt ? interleave(teamEntries, warpV4) : warpV4;

  // 笛卡尔积：任一接入点或任一落地失效，其他组合仍可用。
  // Opera 用 frontAll（免费 + 团队两族全集），要的就是回退组合尽量多。
  const byLoc = {};
  for (const land of opera.landings) {
    for (const ent of frontAll) {
      const name = `${land.tag}@${ent}`;
      (byLoc[land.loc] ||= []).push(name);
      proxies.push(
        `  - {name: "${name}", type: http, server: ${land.ip}, port: ${land.port}, ` +
        `username: ${opera.username}, password: ${opera.password}, tls: true, ` +
        `sni: ${land.host}, skip-cert-verify: false, dialer-proxy: ${ent}}`);
    }
  }
  const combos = Object.values(byLoc).reduce((a, b) => a + b.length, 0);

  // Proton 落地。28 台 x 61 接入点会爆到上千节点，没必要，
  // 每台轮着分一个接入点即可（dialerPool 是两族交错的），
  // 接入点挂了还有其他 Proton 节点顶。
  let protonNames = [];
  const protonByCC = {};   // 国家 -> 该国节点名，用来按国家分组
  if (proton && proton.servers && proton.servers.length) {
    proton.servers.forEach((srv, i) => {
      const ent = dialerPool[i % dialerPool.length] ||
                  frontV4[i % frontV4.length];
      protonNames.push(srv.name);
      // 节点名形如「日本1」，去掉尾号就是国家名
      const cc = srv.name.replace(/\d+$/, "");
      (protonByCC[cc] = protonByCC[cc] || []).push(srv.name);
      proxies.push(`  - name: "${srv.name}"
    type: wireguard
    server: ${srv.ip}
    port: ${srv.port}
    ip: 10.2.0.2
    private-key: ${proton.privateKey}
    public-key: ${srv.pub}
    udp: true
    mtu: 1280
    dialer-proxy: ${ent}`);
    });
  }

  // Windscribe 落地。和 Opera 同构（HTTPS 代理 + Basic），
  // 但免费额度只有 2GB/月，做笛卡尔积没意义 —— 每台轮一个接入点就够。
  const windNames = [];
  const windByLoc = {};
  if (wind && wind.servers && wind.servers.length) {
    wind.servers.forEach((srv, i) => {
      const ent = dialerPool[i % dialerPool.length] ||
                  frontV4[i % frontV4.length];
      const name = `WS-${srv.tag}`;
      windNames.push(name);
      (windByLoc[srv.loc] = windByLoc[srv.loc] || []).push(name);
      proxies.push(
        `  - {name: "${name}", type: http, server: ${srv.host}, port: ${srv.port}, ` +
        `username: ${wind.username}, password: ${wind.password}, tls: true, ` +
        `sni: ${srv.host}, skip-cert-verify: false, dialer-proxy: ${ent}}`);
    });
  }
  const windLocNames = Object.keys(windByLoc).map((l) => `WS-${l}`);
  const windLocDefs = Object.entries(windByLoc).map(([loc, names]) =>
    `  - name: WS-${loc}
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 100
    lazy: true
    proxies:
${q(names)}`).join("\n\n");

  // 组合太多没法平铺选，按地区收成 url-test
  const locNames = Object.keys(byLoc).map((l) => `${l}线路`);
  // 接入点本来就在 proxies 里（做 dialer-proxy 的目标），
  // 顺手暴露成一个直连组：套娃慢或落地挂了就切这个，一份订阅够用
  // Proton 按国家分组：外层能选国家，组内 url-test 自动挑最快的那台
  const protonCCNames = Object.keys(protonByCC).map((c) => `Proton-${c}`);
  const protonCCDefs = Object.entries(protonByCC).map(([cc, names]) =>
    `  - name: Proton-${cc}
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 100
    lazy: true
    proxies:
${q(names)}`).join("\n\n");

  // 出口 IP 敏感站点（Play / 维基 / 成人站 / AI）用的落地池。
  // 排序即优先级：能换出口的落地（Proton/Windscribe/Opera）排前面，
  // ZT 团队边缘次之（更稳，但出口还是 Cloudflare，救不了信誉），
  // 免费边缘直连兜底。只放真实存在的组，不留悬空引用 ——
  // 少一份设备就少一族，绝不能引用不存在的组（内核会直接加载失败）。
  const landingPool = [];
  if (protonNames.length) landingPool.push("Proton线路");
  if (windNames.length) landingPool.push("Windscribe线路");
  landingPool.push(...locNames);
  if (zt) landingPool.push("ZT团队边缘");
  if (warpAll.length) landingPool.push("WARP直连");

  // 一键开关。三族节点都在这一份订阅里，用户要能按族隔离排查：
  // 「是不是只有某一族能用」这个问题，切开一看组内延迟就清楚了。
  const picks = [...locNames];
  if (zt) picks.push("ZT团队边缘");
  if (warpAll.length) picks.push("WARP直连");
  picks.push("⚡ 聚合");
  if (zt) picks.push("⚡ 聚合ZT");
  if (warpV4.length) picks.push("⚡ 聚合WARP");
  if (protonNames.length) picks.push("Proton线路", ...protonCCNames);
  if (windNames.length) picks.push("Windscribe线路", ...windLocNames);

  // 聚合池：把并发连接分散到多条隧道，单隧道跑不快时用它摊开。
  // 只收 IPv4 接入点 —— 纯 IPv4 的机器上 IPv6 接入点会 network is unreachable。
  //
  // 注意这里混了两族（两个不同的 WARP 账号，出口 IP 不同）。load-balance
  // 用的是 consistent-hashing，按目标域名散，同一个站点始终落在同一条
  // 隧道上，所以不会出现「一个会话中途换出口」。要出口绝对统一就用
  // 下面那两个单族子池（⚡ 聚合WARP / ⚡ 聚合ZT）。
  const aggPool = frontV4;
  const ztAggPool = teamEntries;
  const freeAggPool = warpV4;

  // 精选测速池：只留 PICK_PORTS 里的代表性端口，给需要全员测速的
  // url-test 组用（♻️ 自动选择 / 🎬 流媒体自动）。手机上的测速量
  // 从 33 个降到 17 个，避免「测不完 -> 一片超时 -> 看着像没节点」。
  // 名字里没有端口段的（官方域名那个节点）无条件保留。
  const pickNode = (n) => {
    const m = /-(\d+)$/.exec(n);
    return !m || PICK_PORTS.includes(Number(m[1]));
  };
  // 精选池要**横跨所有免费设备（主力 + 备胎）和 ZT 族**。
  // 这是「自动优选」的核心：任何一台设备整体失效，池子里还有别的
  // 设备的节点能被测到 —— 只测主力的话，主力一死，自动选择里
  // 全是超时，看起来就是「节点全死了」。
  //
  // 备胎只取前 2 台进池。池子每多一个成员，多一次并发 QUIC 握手，
  // 而「♻️ 自动选择」和「🎬 流媒体自动」各自都要跑一遍 —— 手机上的
  // 测速预算是有限的。3 台备胎的节点仍然都在 WARP直连 / 聚合WARP 里，
  // 手选得到，只是不参与自动测速。
  const extraPick = extras.slice(0, 2).flatMap((e) => e.entries);
  const pickPool = [...freeV4.filter(pickNode), ...teamEntries.filter(pickNode),
                    ...extraPick];

  const locDefs = Object.entries(byLoc).map(([loc, tags]) => `  - name: ${loc}线路
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 80
    lazy: true
    proxies:
${q(tags)}`).join("\n\n");

  // ZT 团队边缘直连组。只有 Zero Trust 设备才出现：197.x 这批比 198/199
  // 更稳，是免费号连不上的。2 个 IP x 7 个端口 = 14 个节点，
  // 全量测代价可以忽略（一个端口被链路掐掉还有另外六个），
  // 所以关掉 lazy、间隔压到 120s —— 用户抱怨「ZT 慢」基本都出在选点不准。
  const ztGroupDef = zt ? `
  - name: ZT团队边缘
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 120
    tolerance: 30
    timeout: 3000
    max-failed-times: 2
    lazy: false
    proxies:
${q(teamEntries)}
` : "";

  // 单族聚合子池。两族混着放（⚡ 聚合）出口 IP 会不一样，虽然
  // consistent-hashing 按目标域名散、不会中途换出口，但要出口严格统一、
  // 或者想定位「到底哪一族慢」时，用这两个单族池。
  const ztAggDef = zt ? `
  - name: ⚡ 聚合ZT
    type: load-balance
    strategy: consistent-hashing
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 40
    proxies:
${q(ztAggPool)}
` : "";
  const freeAggDef = warpV4.length ? `
  - name: ⚡ 聚合WARP
    type: load-balance
    strategy: consistent-hashing
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 40
    proxies:
${q(freeAggPool)}
` : "";

  // 免费边缘直连组（主力 + 备胎）。没有 consumer 设备时整组不出现 ——
  // 组可以少，但绝不能引用不存在的组（内核加载会直接失败）。
  //
  // 这里是唯一保留「全量 57 个接入点（含 IPv6）」的组，所以 lazy 必须
  // 是 true：关掉 lazy 等于让手机一开机就并发做 57 次 MASQUE 握手，
  // 移动网络下大多数会撞上 3 秒超时，客户端里一片红。
  // 需要它时（切到这一组）内核才开测，测完即为准。
  //
  // 备胎（W2-/W3- 前缀）也放在这一组：主力那台被 CF 清掉时，用户切进来
  // 能看到「主力全红、备胎是绿的」，一眼就知道是哪台设备的问题。
  const warpGroupDef = warpAll.length ? `
  - name: WARP直连
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 40
    timeout: 3000
    max-failed-times: 2
    lazy: true
    proxies:
${q(warpAll)}
` : "";

  // 流媒体组的候选出口，紧跟默认出口之后列出。
  //
  // 第一个成员（= 默认出口）在下面的 YAML 里是 🎬 流媒体自动，不是
  // ⚡ 聚合：url-test 是内核里兼容性最广的组类型，而「select 组里嵌
  // load-balance」在部分手机端内核上支持不全 —— 那个成员一失效整组就
  // 哑了，表现正是「手机端 YouTube 一直转圈、电脑上却正常」。
  //
  // 后面接能换出口的落地组：Cloudflare 的出口 IP 被 YouTube 判成数据中心
  // 而限流时，切到 Proton / Windscribe 那几条就绕开了 —— 这是「YouTube
  // 打不开」最快的一个自救动作。所有组都按存在与否条件拼接，不留悬空引用。
  const streamExtra = [
    "      - ⚡ 聚合",
    zt ? "      - ⚡ 聚合ZT" : "",
    warpV4.length ? "      - ⚡ 聚合WARP" : "",
    protonNames.length ? "      - Proton线路" : "",
    windNames.length ? "      - Windscribe线路" : "",
    "      - 🌐 落地出口",
    "      - 📹 油管视频",
    "      - DIRECT",
  ].filter(Boolean).join("\n") + "\n";

  const { prov, rules } = buildRules();

  const yaml = `# Opera VPN over Cloudflare WARP (MASQUE)
# 由 Cloudflare Worker 生成于 ${new Date().toISOString()}
#
# 聚合版：三族节点都在这一份里，各用各的密钥，互不顶替。
#
#   亚洲/欧洲/美洲线路  本机 -> MASQUE -> Opera 落地 -> 目标（能换出口国家）
#   Proton/Windscribe   本机 -> MASQUE -> 对应落地 -> 目标（能换出口国家）
#   WARP直连            本机 -> MASQUE(免费边缘 198/199) -> 目标（出口是 CF 的 IP，快）
${zt ? `#   ZT团队边缘         本机 -> MASQUE(团队边缘 197.x) -> 目标（更稳，仅 Zero Trust 可用）` : ""}
#
# 节点名 "欧洲1@198.1-443" = 欧洲第 1 个落地，经 162.159.198.1:443 接入。
# ZT- 开头的是 Zero Trust 团队边缘节点（162.159.197.x）。
# W2- / W3- 开头的是**备用免费设备**的接入点（另一把密钥、另一个账号，
# 只出 443 / 8095 两个端口 —— 它们是主力设备的备胎，不是主力）。
#
# 接入点共 ${frontAll.length} 个（免费边缘 ${freeEntries.length}${extraEntries.length ? ` + 备用免费 ${extraEntries.length}` : ""} + ZT 团队边缘 ${teamEntries.length}）
# x 落地 ${opera.landings.length} 个 = 组合 ${combos} 个${protonNames.length ? `，外加 ${protonNames.length} 个 Proton 落地` : ""}${windNames.length ? ` 和 ${windNames.length} 个 Windscribe 落地` : ""}。
# 任一环失效都有替代路径；某个族整体不可用时，另外两族照常工作。
# 节点数字对不对是判断「有没有导入到旧配置」最快的办法：
#   本份应该有 免费边缘 ${freeEntries.length} 个 / ZT 团队边缘 ${teamEntries.length} 个。
#   客户端里要是只看到 4 个 ZT 节点，说明导入的是旧配置，重新导入一次即可。
#
# 需要 mihomo Alpha 分支：稳定版没有 masque outbound，也不认 dialer-proxy。
# private-key 等同 WARP 账号凭据，别外传。

${head(true)}

proxies:
${proxies.join("\n")}

proxy-groups:
  - name: 🌐 落地出口
    type: select
    proxies:
${p(landingPool)}
      - DIRECT

  # QUIC 总开关。默认 REJECT（浏览器会自动回退 TCP）；
  # 个别 App 非用 QUIC 不可的话，在客户端里把它切成 DIRECT。
  - name: 🚫 QUIC
    type: select
    proxies:
      - REJECT
      - DIRECT

  # 并发连接分散到多个接入点，单隧道跑不快时用它。
  # 混了两族（免费边缘 + ZT 团队边缘），出口 IP 因此会有两个；
  # consistent-hashing 按目标域名散，同一个站点始终落在同一条隧道上，
  # 不会出现「一个会话中途换出口」。要出口严格统一用下面两个单族池。
  - name: ⚡ 聚合
    type: load-balance
    strategy: consistent-hashing
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 40
    proxies:
${q(aggPool)}
${ztAggDef}${freeAggDef}
  # 流媒体 / 测速专用出口。
  #
  # 为什么不跟网页共用 🚀 节点选择：4K 视频是持续几十 Mbps 的单条 UDP 流，
  # 也是运营商 QoS 最先盯上的目标；网页是几百个短连接，被压一点感觉不到。
  # 拆开之后看视频的流和刷网页的流落在不同接入点上，互不抢。
  #
  # YouTube 打不开 / 一直转圈时，往下切成下面接的落地组：
  # CF 自己的出口 IP 被 Google 判成机房而限流时，换个出口就好。
  # 选定后写进 profile.store-selected，重启不丢。
  - name: 🎬 流媒体
    type: select
    proxies:
      - 🎬 流媒体自动
${streamExtra}${q(pickPool)}

  # 流媒体自动选优。只测精选池（手机上也测得完），开机就绪。
  - name: 🎬 流媒体自动
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 180
    tolerance: 40
    timeout: 3000
    max-failed-times: 2
    lazy: false
    proxies:
${q(pickPool)}

  - name: 🚀 节点选择
    type: select
    proxies:
      - ♻️ 自动选择
${p(picks)}
      - 🔄 故障转移

  # 原来这里是 url-test 套 url-test（成员全是组）。嵌套组的延迟取的是
  # 子组「当前选中节点」的旧值，不刷新就一直是旧值 —— 这就是
  # 「自动选择挑不到最快」的根因。摊平成真实接入点，并关掉 lazy 让开机就测。
  #
  # 成员用精选池而不是全量：手机上并发 33 次 MASQUE 握手会被系统限流，
  # 测不完的直接标红，看着就像「节点全死了」。精选池 17 个够覆盖
  # 443/4443/8443/8095 四个代表性端口，要全量就在直连组里手选。
  - name: ♻️ 自动选择
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 180
    tolerance: 40
    timeout: 3000
    max-failed-times: 2
    lazy: false
    proxies:
${q(pickPool)}

  - name: 🔄 故障转移
    type: fallback
    url: http://www.gstatic.com/generate_204
    interval: 120
    timeout: 3000
    max-failed-times: 2
    lazy: false
    proxies:
${p(picks)}

${locDefs}
${ztGroupDef}${warpGroupDef}
${protonNames.length ? `
  - name: Proton线路
    type: select
    proxies:
      - Proton-自动
${p(protonCCNames)}

  - name: Proton-自动
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 80
    lazy: true
    proxies:
${q(protonNames)}

${protonCCDefs}
` : ""}${windNames.length ? `
  - name: Windscribe线路
    type: select
    proxies:
      - WS-自动
${p(windLocNames)}

  - name: WS-自动
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 80
    lazy: true
    proxies:
${q(windNames)}

${windLocDefs}
` : ""}
${tailGroups(picks)}

rule-providers:
${prov}

rules:
${rules}
  - GEOIP,LAN,🎯 全球直连,no-resolve
  - GEOIP,CN,🎯 全球直连
  - MATCH,🐟 漏网之鱼
`;

  return { yaml, entries: frontAll.length, landings: opera.landings.length,
           combos, proton: protonNames.length, wind: windNames.length,
           zeroTrust: zt, teamEdges: teamEntries.length,
           freeEdges: freeEntries.length,
           // 备用免费设备：台数 + 它们的节点数。UI 要靠这两个数跟用户说清楚
           // 「免费族有几台设备在扛」，也是排查「一族全死」时的第一手信息。
           extraDevices: extras.length, extraEdges: extraEntries.length };
}
