// 配置结构测试。跑: node test/config.test.mjs
import { buildConfig } from "../src/config.js";

const warp = {
  privateKey: "MGsCAQEEIFAKE", peerPublicKey: "MFkwEwFAKE",
  ipv4: "172.16.0.2", ipv6: "2606:4700:110::1",
  deviceId: "x", registeredAt: new Date().toISOString(),
};
const opera = {
  username: "USER", password: "PASS",
  landings: [
    { tag: "亚洲1", loc: "亚洲", ip: "77.111.245.1", port: 443, host: "as0.sec-tunnel.com" },
    { tag: "欧洲1", loc: "欧洲", ip: "77.111.247.1", port: 443, host: "eu0.sec-tunnel.com" },
  ],
};

let pass = 0, fail = 0;
const t = (n, c) => { c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n)); };

const { yaml, entries, combos } = buildConfig(warp, opera);
const groups = [...yaml.matchAll(/^  - name: (.+)$/gm)].map((m) => m[1]);
const proxyNames = [...yaml.matchAll(/^  - \{name: "([^"]+)"/gm)].map((m) => m[1]);
const entryNames = [...yaml.matchAll(/^  - name: (\S+)\n    type: masque$/gm)].map((m) => m[1]);

t(`接入点 ${entries} 个`, entries === 57);
t(`组合 ${combos} 个 (57 x 2)`, combos === 114);
t("有 WARP直连 组", groups.includes("WARP直连"));
t("有三个地区组",
  ["亚洲线路", "欧洲线路"].every((g) => groups.includes(g)));

// WARP直连 组的成员必须都是接入点，不能混进组合节点
const warpGroup = yaml.split("  - name: WARP直连")[1].split("\n  - name:")[0];
const members = [...warpGroup.matchAll(/^      - "([^"]+)"$/gm)].map((m) => m[1]);
t(`WARP直连 有 ${members.length} 个成员`, members.length === 57);
t("成员都是接入点(不含 @)", members.every((m) => !m.includes("@")));
t("成员都在 proxies 里定义", members.every((m) => entryNames.includes(m)));

// 节点选择里要同时有地区组和直连
const sel = yaml.split("  - name: 🚀 节点选择")[1].split("\n  - name:")[0];
t("节点选择含 WARP直连", sel.includes("WARP直连"));
t("节点选择含地区线路", sel.includes("亚洲线路"));

// 组合节点必须带 dialer-proxy，直连节点必须不带
t("组合节点都带 dialer-proxy",
  (yaml.match(/dialer-proxy:/g) || []).length === combos);
t("组合节点名格式正确", proxyNames.every((n) => /^[\u4e00-\u9fa5]+\d+@/.test(n)));

// 不能有悬空引用
const groupSection = yaml.slice(yaml.indexOf("proxy-groups:"), yaml.indexOf("rule-providers:"));
const allRefs = [...groupSection.matchAll(/^      - "?([^"\n]+)"?$/gm)].map((m) => m[1].trim());
const defined = new Set([...groups, ...proxyNames, ...entryNames, "DIRECT", "REJECT"]);
const dangling = [...new Set(allRefs.filter((r) => !defined.has(r)))];
t(`无悬空引用${dangling.length ? " (" + dangling.slice(0, 3) + ")" : ""}`, dangling.length === 0);

// Proton 相关（回归用，这两条都是线上实测踩出来的）
{
  const proton = {
    privateKey: "PK", expiresAt: Math.floor(Date.now()/1000)+604800,
    servers: [
      { name: "日本1", cc: "JP", ip: "1.1.1.1", port: 51820, pub: "A" },
      { name: "日本2", cc: "JP", ip: "1.1.1.2", port: 51820, pub: "B" },
      { name: "美国1", cc: "US", ip: "2.2.2.1", port: 51820, pub: "C" },
    ],
  };
  const r2 = buildConfig(warp, opera, proton);
  const y = r2.yaml;

  // WireGuard 的 UDP 从接入点发出，分到 IPv6 接入点的话
  // 纯 IPv4 机器上会全部 network is unreachable
  const dps = [...y.matchAll(/type: wireguard[\s\S]*?dialer-proxy: (\S+)/g)].map(m => m[1]);
  t(`Proton 接入点全是 IPv4 (${dps.length} 个)`,
    dps.length === 3 && dps.every(d => !d.startsWith("v6-")));

  // 10.2.0.1 是隧道内网 DNS，配上会让解析请求自己路由回 Proton 节点，死循环
  t("Proton 节点不带隧道内 DNS", !/10\.2\.0\.1/.test(y));

  const gs2 = [...y.matchAll(/^  - name: (.+)$/gm)].map(m => m[1]);
  t("Proton线路 是 select 组", /- name: Proton线路\n    type: select/.test(y));
  t("按国家分组", gs2.includes("Proton-日本") && gs2.includes("Proton-美国"));
  t("有自动选择组", gs2.includes("Proton-自动"));

  const jp = y.split("  - name: Proton-日本")[1].split("\n  - name:")[0];
  t("国家组只含该国节点",
    jp.includes("日本1") && jp.includes("日本2") && !jp.includes("美国1"));
}

// Windscribe（和 Opera 同构，但只轮接入点不做笛卡尔积）
{
  const wind = {
    username: "WU", password: "WP",
    servers: [
      { tag: "香港1", loc: "香港", host: "hk-016.totallyacdn.com", port: 443 },
      { tag: "香港2", loc: "香港", host: "hk-014.totallyacdn.com", port: 443 },
      { tag: "英国1", loc: "英国", host: "uk-048.totallyacdn.com", port: 443 },
    ],
  };
  const r3 = buildConfig(warp, opera, null, wind);
  const y = r3.yaml;
  const gs3 = [...y.matchAll(/^  - name: (.+)$/gm)].map((m) => m[1]);

  t(`Windscribe 节点 ${r3.wind} 个`, r3.wind === 3);
  t("Windscribe线路 是 select 组", /- name: Windscribe线路\n    type: select/.test(y));
  t("按地区分组", gs3.includes("WS-香港") && gs3.includes("WS-英国"));
  t("有自动选择组", gs3.includes("WS-自动"));

  const hk = y.split("  - name: WS-香港")[1].split("\n  - name:")[0];
  t("地区组只含该地区节点",
    hk.includes("WS-香港1") && hk.includes("WS-香港2") && !hk.includes("WS-英国1"));

  // 同 Proton：dialer-proxy 只能是 IPv4 接入点
  const wdp = [...y.matchAll(/name: "WS-[^"]+"[^\n]*dialer-proxy: (\S+)\}/g)].map((m) => m[1]);
  t(`Windscribe 接入点全是 IPv4 (${wdp.length} 个)`,
    wdp.length === 3 && wdp.every((d) => !d.startsWith("v6-")));

  const sel3 = y.split("  - name: 🚀 节点选择")[1].split("\n  - name:")[0];
  t("节点选择含 Windscribe线路", sel3.includes("Windscribe线路"));

  // 没传 wind 时不该冒出任何 WS 相关的东西
  t("不传 wind 就没有 WS 分组", !buildConfig(warp, opera).yaml.includes("Windscribe线路"));

  // 悬空引用（含 Windscribe 分组）
  const gsec = y.slice(y.indexOf("proxy-groups:"), y.indexOf("rule-providers:"));
  const refs3 = [...gsec.matchAll(/^      - "?([^"\n]+)"?$/gm)].map((m) => m[1].trim());
  const names3 = [...y.matchAll(/^  - \{name: "([^"]+)"/gm)].map((m) => m[1]);
  const ents3 = [...y.matchAll(/^  - name: (\S+)\n    type: masque$/gm)].map((m) => m[1]);
  const def3 = new Set([...gs3, ...names3, ...ents3, "DIRECT", "REJECT"]);
  const dang3 = [...new Set(refs3.filter((r) => !def3.has(r)))];
  t(`无悬空引用${dang3.length ? " (" + dang3.slice(0, 3) + ")" : ""}`, dang3.length === 0);
}

// AI 分组
{
  const y = buildConfig(warp, opera).yaml;
  const gs = [...y.matchAll(/^  - name: (.+)$/gm)].map((m) => m[1]);

  t("有 AI服务 分组", gs.includes("🤖 AI服务"));
  t("旧的 OpenAi 分组已改名", !gs.includes("🤖 OpenAi"));
  t("没有指向 OpenAi 的残留规则", !y.includes(",🤖 OpenAi"));

  // 各家都要能命中
  const must = [
    "anthropic.com", "grok.com", "perplexity.ai", "deepseek.com",
    "midjourney.com", "huggingface.co", "cursor.com", "elevenlabs.io",
    "mistral.ai", "meta.ai", "openrouter.ai", "kimi.com",
  ];
  const miss = must.filter((d) => !y.includes(`DOMAIN-SUFFIX,${d},🤖 AI服务`));
  t(`覆盖各家 AI${miss.length ? " 缺:" + miss.slice(0, 3) : ""}`, miss.length === 0);

  // 共用域名不能进来，否则会把无关流量拽进 AI 分组
  const tooWide = ["googleapis.com", "cloudflare.com", "stripe.com", "sentry.io", "bing.com"];
  const bad = tooWide.filter((d) => y.includes(`DOMAIN-SUFFIX,${d},🤖 AI服务`));
  t(`没有过宽的共用域名${bad.length ? " (" + bad + ")" : ""}`, bad.length === 0);

  // 内联规则必须排在 RULE-SET 之前，否则会被上游更宽的条目抢先命中
  const rs = y.indexOf("  - RULE-SET,");
  const inl = y.indexOf("  - DOMAIN-SUFFIX,");
  t("内联 AI 规则排在 RULE-SET 前", inl > 0 && inl < rs);

  // 域名不能重复
  const ds = [...y.matchAll(/^  - DOMAIN-SUFFIX,([^,]+),🤖 AI服务$/gm)].map((m) => m[1]);
  t(`AI 域名 ${ds.length} 条无重复`, new Set(ds).size === ds.length);

  // AI 分组要能选到所有落地
  const ai = y.split("  - name: 🤖 AI服务")[1].split("\n  - name:")[0];
  t("AI服务 能选地区线路", ai.includes("亚洲线路"));
  t("AI服务 能选 WARP直连", ai.includes("WARP直连"));
}

// Zero Trust 骨干：团队边缘 + 落地走团队边缘
{
  const ztWarp = { ...warp, zeroTrust: true, accountType: "team" };
  const r = buildConfig(ztWarp, opera);
  const y = r.yaml;
  const gs = [...y.matchAll(/^  - name: (.+)$/gm)].map((m) => m[1]);
  const entryNames = [...y.matchAll(/^  - name: (\S+)\n    type: masque$/gm)].map((m) => m[1]);

  t("ZT 标记为启用", r.zeroTrust === true);
  t(`团队边缘 ${r.teamEdges} 个 (2 IP x 2 端口)`, r.teamEdges === 4);
  t("有 ZT团队边缘 组", gs.includes("ZT团队边缘"));

  // 团队边缘节点必须是 197.x + 带 ZT SNI
  const ztEntries = entryNames.filter((n) => n.startsWith("ZT-"));
  t(`ZT- 前缀节点 ${ztEntries.length} 个`, ztEntries.length === 4);
  const ztNodeBlock = y.split("  - name: ZT-197.1-443")[1].split("\n  - name:")[0];
  t("团队边缘走 197.x", ztNodeBlock.includes("162.159.197"));
  t("团队边缘用 zt-masque SNI", ztNodeBlock.includes("zt-masque.cloudflareclient.com"));

  // 节点选择里要有 ZT团队边缘，WARP直连 也还在（作回退）
  const sel = y.split("  - name: 🚀 节点选择")[1].split("\n  - name:")[0];
  t("节点选择含 ZT团队边缘", sel.includes("ZT团队边缘"));
  t("节点选择仍含 WARP直连", sel.includes("WARP直连"));

  // ZT团队边缘 组成员都是 ZT- 节点，不能混进免费边缘
  const ztGroup = y.split("  - name: ZT团队边缘")[1].split("\n  - name:")[0];
  const ztMembers = [...ztGroup.matchAll(/^      - "([^"]+)"$/gm)].map((m) => m[1]);
  t(`ZT组 ${ztMembers.length} 个成员`, ztMembers.length === 4);
  t("ZT组成员都是 ZT- 前缀", ztMembers.every((m) => m.startsWith("ZT-")));
  t("ZT组成员都在 proxies 里", ztMembers.every((m) => entryNames.includes(m)));

  // Proton/Windscribe 落地应该走团队边缘（ZT- 前缀接入点）
  const proton = {
    privateKey: "PK", expiresAt: Math.floor(Date.now()/1000)+604800,
    servers: [
      { name: "日本1", cc: "JP", ip: "1.1.1.1", port: 51820, pub: "A" },
      { name: "美国1", cc: "US", ip: "2.2.2.1", port: 51820, pub: "C" },
    ],
  };
  const rz = buildConfig(ztWarp, opera, proton);
  const dps = [...rz.yaml.matchAll(/type: wireguard[\s\S]*?dialer-proxy: (\S+)/g)].map((m) => m[1]);
  t(`Proton 落地 ${dps.length} 个全走团队边缘`,
    dps.length === 2 && dps.every((d) => d.startsWith("ZT-")));

  // 悬空引用（含 ZT + Proton 分组）。groups 要从同一份配置取，不能拿
  // 没 Proton 那份的 gs 来对，否则 Proton线路/Proton-日本 这些会被误判悬空。
  // 所有 `  - name:` 行都要算进 defined：组定义 + 块式代理定义（Proton 的
  // `name: "日本1"` 带引号，refs 里成员行去掉引号，两边要统一才能对上）。
  const gs2 = [...rz.yaml.matchAll(/^  - name: (.+)$/gm)]
    .map((m) => m[1].replace(/^"(.+)"$/, "$1"));
  const gsec = rz.yaml.slice(rz.yaml.indexOf("proxy-groups:"), rz.yaml.indexOf("rule-providers:"));
  const refs = [...gsec.matchAll(/^      - "?([^"\n]+)"?$/gm)].map((m) => m[1].trim());
  const names = [...rz.yaml.matchAll(/^  - \{name: "([^"]+)"/gm)].map((m) => m[1]);
  const ents = [...rz.yaml.matchAll(/^  - name: (\S+)\n    type: masque$/gm)].map((m) => m[1]);
  const def = new Set([...gs2, ...names, ...ents, "DIRECT", "REJECT"]);
  const dang = [...new Set(refs.filter((r) => !def.has(r)))];
  t(`ZT 配置无悬空引用${dang.length ? " (" + dang.slice(0, 3) + ")" : ""}`, dang.length === 0);

  // consumer WARP（不传 zeroTrust）绝不能冒出团队边缘。
  // 只看真正的节点定义（server: 162.159.197），不看注释里的说明文字。
  const consumer = buildConfig(warp, opera);
  t("免费 WARP 不该有 ZT团队边缘 组", !consumer.yaml.includes("ZT团队边缘"));
  t("免费 WARP 不该有 197.x 节点定义",
    !/server: 162\.159\.197/.test(consumer.yaml));
  t("免费 WARP 标记 ZT 关", consumer.zeroTrust === false && consumer.teamEdges === 0);
}

// 调优项：关 QUIC / 出口 IP 敏感域名 / 自动选择不再套娃 / DNS 不吃 AAAA
{
  const y = buildConfig(warp, opera).yaml;
  const gs = [...y.matchAll(/^  - name: (.+)$/gm)].map((m) => m[1]);
  const entryNames = [...y.matchAll(/^  - name: (\S+)\n    type: masque$/gm)].map((m) => m[1]);

  // 关 QUIC。必须排在全部规则最前面：浏览器用的 QUIC 在 MASQUE 隧道里
  // 等于套两层 QUIC，Google 系会一直转圈；拦掉之后自动回退 TCP。
  const rulesBlock = y.slice(y.indexOf("\nrules:\n") + "\nrules:\n".length);
  const firstRule = rulesBlock.split("\n")[0];
  t("第一条规则是关 QUIC",
    firstRule.includes("AND,((NETWORK,UDP),(DST-PORT,443)),🚫 QUIC"));
  t("有 🚫 QUIC 组", gs.includes("🚫 QUIC"));

  // 测速脚本靠这条量真实吞吐，落到直连就量成自家宽带了
  t("测速域名钉走代理",
    y.includes("DOMAIN-SUFFIX,speed.cloudflare.com,🚀 节点选择"));

  // Play 的下载 CDN 是最常漏的一环：商店能打开但装不上，就是这几条没走代理
  const playMust = ["play.google.com", "play.googleapis.com", "android.clients.google.com",
                    "dl.google.com", "gvt1.com"];
  const playMiss = playMust.filter((d) => !y.includes(`DOMAIN-SUFFIX,${d},🌐 落地出口`));
  t(`Play 商店+下载CDN 走落地出口${playMiss.length ? " 缺:" + playMiss : ""}`,
    playMiss.length === 0);
  const wikiMiss = ["wikipedia.org", "wikimedia.org"].filter(
    (d) => !y.includes(`DOMAIN-SUFFIX,${d},🌐 落地出口`));
  t(`维基媒体走落地出口${wikiMiss.length ? " 缺:" + wikiMiss : ""}`, wikiMiss.length === 0);

  // 内联规则必须排在 RULE-SET 之前，否则会被上游更宽的条目抢先命中
  const rs = y.indexOf("  - RULE-SET,");
  const sens = y.indexOf("  - DOMAIN-SUFFIX,play.google.com,🌐 落地出口");
  t("敏感域名规则排在 RULE-SET 前", sens > 0 && sens < rs);

  // 🌐 落地出口 只允许引用真实存在的组，否则内核直接加载失败
  t("有 🌐 落地出口 组", gs.includes("🌐 落地出口"));
  const land = y.split("  - name: 🌐 落地出口")[1].split("\n  - name:")[0];
  const landMembers = [...land.matchAll(/^      - (.+)$/gm)].map((m) => m[1].trim());
  t("落地出口含地区线路", land.includes("亚洲线路") && land.includes("欧洲线路"));
  t("落地出口成员都是已定义的组",
    landMembers.filter((m) => m !== "DIRECT").every((m) => gs.includes(m)));

  // ⚡ 聚合：同一个 WARP 账号出口 IP 相同，分散连接是安全的；
  // 但只收 IPv4 接入点，混进 v6 在纯 IPv4 机器上会 network is unreachable
  t("有 ⚡ 聚合 组", gs.includes("⚡ 聚合"));
  const agg = y.split("  - name: ⚡ 聚合")[1].split("\n  - name:")[0];
  t("聚合是 load-balance", /type: load-balance/.test(agg));
  const aggMembers = [...agg.matchAll(/^      - "([^"]+)"$/gm)].map((m) => m[1]);
  t(`聚合 ${aggMembers.length} 个成员全是 IPv4 接入点`,
    aggMembers.length > 0 &&
    aggMembers.every((m) => !m.startsWith("v6-") && entryNames.includes(m)));

  // ♻️ 自动选择：不能再是 url-test 套 url-test。嵌套组的延迟取的是子组
  // 当前选中节点的旧值，不刷新就一直是旧值 —— 「挑不到最快」的根因。
  const auto = y.split("  - name: ♻️ 自动选择")[1].split("\n  - name:")[0];
  const autoMembers = [...auto.matchAll(/^      - "([^"]+)"$/gm)].map((m) => m[1]);
  t(`自动选择 ${autoMembers.length} 个成员都是真实接入点`,
    autoMembers.length > 0 && autoMembers.every((m) => entryNames.includes(m)));
  t("自动选择不再含组名",
    !auto.includes("      - 亚洲线路") && !autoMembers.includes("亚洲线路"));
  t("自动选择关掉 lazy", /lazy: false/.test(auto));

  // DNS 不能回答 AAAA：本地 IPv6 出口烂的时候，返回 AAAA 会让客户端
  // 优先往 v6 上撞，表现就是「延迟不高但打不开」
  const dnsBlock = y.slice(y.indexOf("\ndns:\n"), y.indexOf("\nproxies:\n"));
  t("DNS 关掉 IPv6", /^  ipv6: false$/m.test(dnsBlock));
  t("顶层 IPv6 保留（v6 接入点还要能用）", /^ipv6: true$/m.test(y));
  t("AI 域名钉境外 DNS", dnsBlock.includes("'+.openai.com':"));

  // 🎬 流媒体：4K 视频是持续几十 Mbps 的单条 UDP 流，也是 QoS 最先打击的
  // 目标；网页是几百个短连接，被压一点感觉不到。拆成独立出口，两条流
  // 落在不同接入点上互不抢。
  t("有 🎬 流媒体 组", gs.includes("🎬 流媒体"));
  t("有 🎬 流媒体自动 组", gs.includes("🎬 流媒体自动"));
  const stream = y.split("  - name: 🎬 流媒体\n")[1].split("\n  - name:")[0];
  t("流媒体是 select 组", /type: select/.test(stream));
  const streamMembers = [...stream.matchAll(/^      - "([^"]+)"$/gm)].map((m) => m[1]);
  t(`流媒体 ${streamMembers.length} 个成员都是真实接入点`,
    streamMembers.length > 0 && streamMembers.every((m) => entryNames.includes(m)));
  t("流媒体第一个成员是 ⚡ 聚合", stream.indexOf("- ⚡ 聚合") > 0 &&
    stream.indexOf("- ⚡ 聚合") < (stream.indexOf('"') > 0 ? stream.indexOf('"') : Infinity));
  const streamAuto = y.split("  - name: 🎬 流媒体自动")[1].split("\n  - name:")[0];
  const streamAutoMembers = [...streamAuto.matchAll(/^      - "([^"]+)"$/gm)].map((m) => m[1]);
  t("流媒体自动成员都是真实接入点",
    streamAutoMembers.length > 0 && streamAutoMembers.every((m) => entryNames.includes(m)));
  t("流媒体自动关掉 lazy", /type: url-test/.test(streamAuto) && /lazy: false/.test(streamAuto));

  // 规则集只盖到 googlevideo/nflx 主域，这些拉流 CDN 全在外面 ——
  // 漏掉就回落漏网之鱼，跟着默认节点走了
  const streamMust = ["googlevideo.com", "netflix.com", "nflxvideo.net",
                      "dssott.com", "aiv-cdn.net", "ttvnw.net", "ibytedtos.com",
                      "fast.com", "speedtest.net"];
  const streamMiss = streamMust.filter((d) => !y.includes(`DOMAIN-SUFFIX,${d},🎬 流媒体`));
  t(`流媒体域名走 🎬 流媒体${streamMiss.length ? " 缺:" + streamMiss : ""}`,
    streamMiss.length === 0);
  const streamRule = y.indexOf("  - DOMAIN-SUFFIX,googlevideo.com,🎬 流媒体");
  t("流媒体规则排在 RULE-SET 前", streamRule > 0 && streamRule < rs);

  // MATCH 必须在 GEOIP,CN 之后。放前面会让所有国内 IP 走不到直连分支，
  // 全被拽进代理 —— 看视频的带宽先被自己的路由吃掉。
  const ruleLines = rulesBlock.split("\n").map((l) => l.trim().replace(/^- /, "")).filter(Boolean);
  t("最后一条是 MATCH", ruleLines[ruleLines.length - 1].startsWith("MATCH,"));
  const matchIdx = ruleLines.findIndex((l) => l.startsWith("MATCH,"));
  const cnIdx = ruleLines.findIndex((l) => l.startsWith("GEOIP,CN"));
  t("MATCH 排在 GEOIP,CN 之后", cnIdx >= 0 && matchIdx > cnIdx);

  const dupRules = ruleLines.filter((l, i) => ruleLines.indexOf(l) !== i);
  t(`规则无重复${dupRules.length ? " 重复:" + dupRules.slice(0, 3) : ""}`,
    dupRules.length === 0);
}

console.log(`\n通过 ${pass} 失败 ${fail}`);
if (fail) process.exit(1);

