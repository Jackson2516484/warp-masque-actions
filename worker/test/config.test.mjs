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

// Zero Trust 与 consumer WARP 并存：三族节点（免费边缘 / 团队边缘 / 落地）
// 都要在同一份订阅里活着。
//
// 这一块是回归重点。以前的 bug 是 rebuild 里写了
// `const warp = zt || await getWarp()` —— ZT 设备一上位就把 consumer 那份
// 整个丢掉，而 config.js 又拿 ZT 的密钥去生成 198/199 那 57 个免费边缘
// 节点，那些节点在 CF 那边认证不过，客户端里表现就是「只能用 ZT 的」。
{
  // 故意用和 consumer 不同的密钥，才能验出「密钥有没有串族」
  const ztDev = {
    privateKey: "MGsCAQEEIZTKEY", peerPublicKey: "MFkwEwDZTPUB",
    ipv4: "172.16.0.9", ipv6: "2606:4700:110::9",
    deviceId: "z", registeredAt: new Date().toISOString(),
    zeroTrust: true, accountType: "team",
  };

  // ---- 只有 ZT（consumer 注册失败时的降级形态）----
  const solo = buildConfig(null, opera, null, null, ztDev);
  const gsSolo = [...solo.yaml.matchAll(/^  - name: (.+)$/gm)].map((m) => m[1]);
  t("ZT 标记为启用", solo.zeroTrust === true);
  t(`团队边缘 ${solo.teamEdges} 个 (2 IP x 2 端口)`, solo.teamEdges === 4);
  t("有 ZT团队边缘 组", gsSolo.includes("ZT团队边缘"));
  t("只有 ZT 时不出 WARP直连 组", !gsSolo.includes("WARP直连"));
  t("只有 ZT 时不出 ⚡ 聚合WARP 组", !gsSolo.includes("⚡ 聚合WARP"));
  t(`只有 ZT 时接入点就 ${solo.entries} 个`, solo.entries === 4);
  // 关键：ZT 密钥绝不能拿去生成免费边缘节点，那 57 个全是死节点
  t("只有 ZT 时不生成 198/199 节点", !/server: 162\.159\.19[89]/.test(solo.yaml));
  const selSolo = solo.yaml.split("  - name: 🚀 节点选择")[1].split("\n  - name:")[0];
  t("只有 ZT 时节点选择不引用 WARP直连", !selSolo.includes("WARP直连"));

  // ---- 兼容老调用：把 ZT 设备当 warp 传 ----
  const legacy = buildConfig(ztDev, opera);
  t("ZT 设备当 warp 传也能识别",
    legacy.zeroTrust === true && legacy.teamEdges === 4 && legacy.entries === 4);

  // ---- 两份并存 ----
  const proton = {
    privateKey: "PK", expiresAt: Math.floor(Date.now() / 1000) + 604800,
    servers: [
      { name: "日本1", cc: "JP", ip: "1.1.1.1", port: 51820, pub: "A" },
      { name: "日本2", cc: "JP", ip: "1.1.1.2", port: 51820, pub: "B" },
      { name: "美国1", cc: "US", ip: "2.2.2.1", port: 51820, pub: "C" },
    ],
  };
  const both = buildConfig(warp, opera, proton, null, ztDev);
  const y = both.yaml;
  const gs = [...y.matchAll(/^  - name: (.+)$/gm)].map((m) => m[1]);
  const entryNames = [...y.matchAll(/^  - name: (\S+)\n    type: masque$/gm)].map((m) => m[1]);
  const nodeBlock = (n) => y.split(`  - name: ${n}\n`)[1].split("\n  - name:")[0];

  t(`并存时接入点 ${both.entries} 个 (免费 57 + ZT 4)`, both.entries === 61);
  t(`免费边缘 ${both.freeEdges} 个`, both.freeEdges === 57);
  t(`团队边缘 ${both.teamEdges} 个`, both.teamEdges === 4);
  t(`组合 ${both.combos} 个 (61 x 2)`, both.combos === 122);
  t("三族的直连组都在",
    gs.includes("ZT团队边缘") && gs.includes("WARP直连"));
  t("三个聚合组都在",
    gs.includes("⚡ 聚合") && gs.includes("⚡ 聚合ZT") && gs.includes("⚡ 聚合WARP"));

  // 密钥不能串族。这是本轮修的核心 bug：
  // 免费边缘节点必须用 consumer 密钥，团队边缘必须用 ZT 密钥。
  t("免费边缘节点用 consumer 密钥",
    nodeBlock("198.1-443").includes(`private-key: ${warp.privateKey}`));
  t("团队边缘节点用 ZT 密钥",
    nodeBlock("ZT-197.1-443").includes(`private-key: ${ztDev.privateKey}`));
  const ztKeyLeak = entryNames.filter((n) => !n.startsWith("ZT-") &&
    nodeBlock(n).includes(ztDev.privateKey)).length;
  t(`ZT 密钥只出现在 ZT- 节点上${ztKeyLeak ? " 泄漏 " + ztKeyLeak + " 处" : ""}`,
    ztKeyLeak === 0);

  // 团队边缘节点必须是 197.x + 带 ZT SNI
  const ztEntries = entryNames.filter((n) => n.startsWith("ZT-"));
  t(`ZT- 前缀节点 ${ztEntries.length} 个`, ztEntries.length === 4);
  t("团队边缘走 197.x", nodeBlock("ZT-197.1-443").includes("162.159.197"));
  t("团队边缘用 zt-masque SNI",
    nodeBlock("ZT-197.1-443").includes("zt-masque.cloudflareclient.com"));

  // 节点选择里三族都能选到
  const sel = y.split("  - name: 🚀 节点选择")[1].split("\n  - name:")[0];
  t("节点选择含 ZT团队边缘", sel.includes("ZT团队边缘"));
  t("节点选择含 WARP直连", sel.includes("WARP直连"));
  t("节点选择含地区线路", sel.includes("亚洲线路"));

  // ZT团队边缘 组成员都是 ZT- 节点，不能混进免费边缘
  const ztGroup = y.split("  - name: ZT团队边缘")[1].split("\n  - name:")[0];
  const ztMembers = [...ztGroup.matchAll(/^      - "([^"]+)"$/gm)].map((m) => m[1]);
  t(`ZT组 ${ztMembers.length} 个成员`, ztMembers.length === 4);
  t("ZT组成员都是 ZT- 前缀", ztMembers.every((m) => m.startsWith("ZT-")));
  t("ZT组成员都在 proxies 里", ztMembers.every((m) => entryNames.includes(m)));

  // WARP直连 组只收免费边缘，不能混进 ZT 节点
  const wgGroup = y.split("  - name: WARP直连")[1].split("\n  - name:")[0];
  const wgMembers = [...wgGroup.matchAll(/^      - "([^"]+)"$/gm)].map((m) => m[1]);
  t(`WARP直连 ${wgMembers.length} 个成员全是免费边缘`,
    wgMembers.length === 57 && wgMembers.every((m) => !m.startsWith("ZT-")));

  // 落地首跳必须横跨两族：任何一族整体挂掉时，另一半落地照样能用。
  // 以前是 dialerPool = teamEntries，全部落地压在 ZT 那 4 个上。
  const pdp = [...y.matchAll(/type: wireguard[\s\S]*?dialer-proxy: (\S+)/g)].map((m) => m[1]);
  t(`Proton 首跳 ${pdp.length} 个`, pdp.length === 3);
  t("Proton 首跳全是 IPv4 接入点",
    pdp.every((d) => !d.startsWith("v6-") && entryNames.includes(d)));
  t("Proton 首跳跨两族（不是全压在 ZT 上）",
    pdp.some((d) => d.startsWith("ZT-")) && pdp.some((d) => !d.startsWith("ZT-")));
  t("首跳按 ZT/免费 交错",
    pdp[0].startsWith("ZT-") && !pdp[1].startsWith("ZT-") && pdp[2].startsWith("ZT-"));

  // 只有 ZT 时落地也必须有首跳，不能配出 dialer-proxy 悬空的节点
  const soloPdp = [...solo.yaml.matchAll(/type: wireguard[\s\S]*?dialer-proxy: (\S+)/g)];
  t("只有 ZT 时落地首跳不为空（没有 Proton 就没有）", soloPdp.length === 0);
  const soloWarp = buildConfig(null, opera, proton, null, ztDev);
  const soloPdp2 = [...soloWarp.yaml.matchAll(/type: wireguard[\s\S]*?dialer-proxy: (\S+)/g)].map((m) => m[1]);
  t(`只有 ZT 时 Proton 首跳 ${soloPdp2.length} 个全走团队边缘`,
    soloPdp2.length === 3 && soloPdp2.every((d) => d.startsWith("ZT-")));

  // 聚合组只收 IPv4 接入点，混进 v6 在纯 IPv4 机器上会 network is unreachable
  const agg = y.split("  - name: ⚡ 聚合\n")[1].split("\n  - name:")[0];
  const aggM = [...agg.matchAll(/^      - "([^"]+)"$/gm)].map((m) => m[1]);
  t(`聚合 ${aggM.length} 个成员 = 免费29 + ZT4`,
    aggM.length === 33 && aggM.every((m) => !m.startsWith("v6-") && entryNames.includes(m)));
  const aggZt = y.split("  - name: ⚡ 聚合ZT\n")[1].split("\n  - name:")[0];
  const aggZtM = [...aggZt.matchAll(/^      - "([^"]+)"$/gm)].map((m) => m[1]);
  t("⚡ 聚合ZT 只收 ZT 节点", aggZtM.length === 4 && aggZtM.every((m) => m.startsWith("ZT-")));
  const aggWarp = y.split("  - name: ⚡ 聚合WARP\n")[1].split("\n  - name:")[0];
  const aggWarpM = [...aggWarp.matchAll(/^      - "([^"]+)"$/gm)].map((m) => m[1]);
  t(`⚡ 聚合WARP 只收免费边缘 ${aggWarpM.length} 个`,
    aggWarpM.length === 29 && aggWarpM.every((m) => !m.startsWith("ZT-")));

  // 流媒体组要能一键切到单族聚合（定位「到底哪一族慢」）
  const stream = y.split("  - name: 🎬 流媒体\n")[1].split("\n  - name:")[0];
  t("流媒体能选 ⚡ 聚合ZT", stream.includes("- ⚡ 聚合ZT"));
  t("流媒体能选 ⚡ 聚合WARP", stream.includes("- ⚡ 聚合WARP"));

  // 悬空引用（含 ZT + Proton 分组）。groups 要从同一份配置取，不能拿
  // 没 Proton 那份的 gs 来对，否则 Proton线路/Proton-日本 这些会被误判悬空。
  // 所有 `  - name:` 行都要算进 defined：组定义 + 块式代理定义（Proton 的
  // `name: "日本1"` 带引号，refs 里成员行去掉引号，两边要统一才能对上）。
  const gs2 = [...y.matchAll(/^  - name: (.+)$/gm)]
    .map((m) => m[1].replace(/^"(.+)"$/, "$1"));
  const gsec = y.slice(y.indexOf("proxy-groups:"), y.indexOf("rule-providers:"));
  const refs = [...gsec.matchAll(/^      - "?([^"\n]+)"?$/gm)].map((m) => m[1].trim());
  const names = [...y.matchAll(/^  - \{name: "([^"]+)"/gm)].map((m) => m[1]);
  const def = new Set([...gs2, ...names, ...entryNames, "DIRECT", "REJECT"]);
  const dang = [...new Set(refs.filter((r) => !def.has(r)))];
  t(`并存配置无悬空引用${dang.length ? " (" + dang.slice(0, 3) + ")" : ""}`, dang.length === 0);

  // consumer WARP（不传 zeroTrust）绝不能冒出团队边缘。
  // 只看真正的节点定义（server: 162.159.197），不看注释里的说明文字。
  const consumer = buildConfig(warp, opera);
  t("免费 WARP 不该有 ZT团队边缘 组", !consumer.yaml.includes("ZT团队边缘"));
  t("免费 WARP 不该有 197.x 节点定义",
    !/server: 162\.159\.197/.test(consumer.yaml));
  t("免费 WARP 标记 ZT 关", consumer.zeroTrust === false && consumer.teamEdges === 0);
  t(`免费 WARP 接入点 ${consumer.entries} 个`, consumer.entries === 57);
  t("免费 WARP 不该有 ⚡ 聚合ZT 组", !consumer.yaml.includes("⚡ 聚合ZT"));

  // 两份设备都缺时必须明确报错，不能返回一份没有代理的配置
  let threw = false;
  try { buildConfig(null, opera, null, null, null); } catch { threw = true; }
  t("两份设备都缺时报错", threw);
}

// 调优项：关 QUIC / 出口 IP 敏感域名 / 自动选择不再套娃 / DNS 不吃 AAAA
{
  const y = buildConfig(warp, opera).yaml;
  const gs = [...y.matchAll(/^  - name: (.+)$/gm)].map((m) => m[1]);
  const entryNames = [...y.matchAll(/^  - name: (\S+)\n    type: masque$/gm)].map((m) => m[1]);

  // QUIC 两连招，必须排在全部规则最前面，且顺序不能颠倒：
  //   1) 国内 UDP 443 放行直连 —— B站/微信/抖音/淘宝/支付宝 全靠 QUIC，
  //      一刀切 REJECT 等于让它们每次先失败一次再回退 TCP，手机上就是
  //      「一打开就转圈」。这条只匹配 UDP，不会把该代理的流量放走。
  //   2) 其余（境外）QUIC 交给 🚫 QUIC 组。MASQUE 隧道里再跑 QUIC 等于
  //      双层 QUIC，Google 系会一直转圈；拦掉后立刻拿到拒绝、迅速回退 TCP。
  const rulesBlock = y.slice(y.indexOf("\nrules:\n") + "\nrules:\n".length);
  const ruleL = rulesBlock.split("\n");
  t("第一条是国内 QUIC 放行直连",
    ruleL[0].includes("AND,((NETWORK,UDP),(DST-PORT,443),(GEOSITE,cn)),DIRECT"));
  t("第二条是关境外 QUIC",
    ruleL[1].includes("AND,((NETWORK,UDP),(DST-PORT,443)),🚫 QUIC"));
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
  // 但成员必须是**精选池**，不能是全量：手机上并发三十多次 MASQUE 握手
  // 会被系统/电量策略限制，测不完的直接标红 —— 用户看到的就是
  // 「可用节点太少」，开机后还卡一阵。精选池只留代表性端口。
  t(`自动选择用精选池 ${autoMembers.length} 个 < 全量 ${aggMembers.length} 个`,
    autoMembers.length > 0 && autoMembers.length < aggMembers.length);
  t("精选池只含 443/4443/8443/8095",
    autoMembers.every((m) => {
      const mm = /-(\d+)$/.exec(m);
      return !mm || [443, 4443, 8443, 8095].includes(Number(mm[1]));
    }));

  // 唯一保留全量接入点（含 IPv6）的组，必须关掉 eager 测速：
  // 57 个 MASQUE 节点全测在手机上是灾难，切到这组时再测即可。
  const warpG = y.split("  - name: WARP直连")[1].split("\n  - name:")[0];
  t("WARP直连（全量）改成按需测速",
    /type: url-test/.test(warpG) && /lazy: true/.test(warpG));
  const warpGMembers = [...warpG.matchAll(/^      - "([^"]+)"$/gm)].map((m) => m[1]);
  t(`WARP直连仍是全量 ${warpGMembers.length} 个`,
    warpGMembers.length > aggMembers.length);

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
  // 默认出口必须是 url-test 组，不能是 load-balance：部分手机端内核对
  // 「select 组里嵌 load-balance」支持不全，那个成员一失效整组就哑了，
  // 表现正是「手机端 YouTube 一直转圈、电脑上却正常」。
  t("流媒体默认出口是 url-test 组，不嵌 load-balance",
    stream.includes("      - 🎬 流媒体自动") &&
    stream.indexOf("- 🎬 流媒体自动") < stream.indexOf("- ⚡ 聚合"));
  // CF 的出口 IP 被 Google 判成机房限流时，得能在流媒体组里直接换出口
  t("流媒体含能换出口的落地组",
    stream.includes("      - 🌐 落地出口") &&
    stream.includes("      - 📹 油管视频") &&
    /^      - DIRECT$/m.test(stream));
  t("流媒体组的组名引用都真实存在",
    [...stream.matchAll(/^      - ([^\s"].+)$/gm)].map((m) => m[1].trim())
      .filter((m) => m !== "DIRECT")
      .every((m) => gs.includes(m)));
  const streamAuto = y.split("  - name: 🎬 流媒体自动")[1].split("\n  - name:")[0];
  const streamAutoMembers = [...streamAuto.matchAll(/^      - "([^"]+)"$/gm)].map((m) => m[1]);
  t("流媒体自动成员都是真实接入点",
    streamAutoMembers.length > 0 && streamAutoMembers.every((m) => entryNames.includes(m)));
  t("流媒体自动关掉 lazy", /type: url-test/.test(streamAuto) && /lazy: false/.test(streamAuto));
  t(`流媒体自动也用精选池 ${streamAutoMembers.length} 个 < 全量 ${aggMembers.length} 个`,
    streamAutoMembers.length > 0 && streamAutoMembers.length < aggMembers.length);

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

