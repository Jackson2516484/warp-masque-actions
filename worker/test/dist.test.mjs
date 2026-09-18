// 产物测试：验的是「部署出去的那个文件」dist/worker.js，不是 src/。
//
// 为什么要单独测产物：src/ 的测试全绿，也可能因为忘了 npm run build
// 而把旧产物部署上去。这个文件就是那道闸。
//
// 做法：dist/worker.js 是单文件 bundle，buildConfig 就在模块作用域里。
// 读进来、末尾追加一个具名导出、写到临时文件里再 import —— 不需要改构建。
//
// 跑: node test/dist.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(here, "..", "dist", "worker.js");
const srcDir = path.join(here, "..", "src");

let pass = 0, fail = 0, warn = 0;
const t = (n, c) => { c ? (pass++, console.log("  \u2713", n)) : (fail++, console.log("  \u2717", n)); };
const w = (n) => { warn++; console.log("  !", n); };
const R = (s) => s.replace(/\r\n/g, "\n");

// ---- 陈旧的产物要能看出来 ----
// 只警告不判失败：git clone 时 src/ 和 dist/ 的 mtime 几乎同时落地，
// 判失败会在干净检出上误报。
{
  const distM = fs.statSync(distPath).mtimeMs;
  const newer = fs.readdirSync(srcDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => ({ f, m: fs.statSync(path.join(srcDir, f)).mtimeMs }))
    .filter((x) => x.m - distM > 2000);
  if (newer.length) {
    w(`src/ 比 dist/worker.js 新（${newer.map((x) => x.f).join(", ")}）—— 八成忘了 npm run build`);
  }
}

const tmpPath = path.join(os.tmpdir(), `_warp_dist_${process.pid}.mjs`);
fs.writeFileSync(tmpPath, fs.readFileSync(distPath, "utf8") + "\nexport { buildConfig };\n");
const { buildConfig } = await import("file:///" + tmpPath.replace(/\\/g, "/"));
const cleanup = () => fs.rmSync(tmpPath, { force: true });

// fixture 形状照抄 test/config.test.mjs，别自己发明 —— 形状不对会生成
// WS-undefined 这种脏组名，然后你以为测出了 bug，其实是 fixture 的锅。
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
const proton = {
  privateKey: "PK", expiresAt: Math.floor(Date.now() / 1000) + 604800,
  servers: [
    { name: "日本1", cc: "JP", ip: "1.1.1.1", port: 51820, pub: "A" },
    { name: "美国1", cc: "US", ip: "2.2.2.1", port: 51820, pub: "C" },
  ],
};
const wind = {
  username: "WU", password: "WP",
  servers: [
    { tag: "香港1", loc: "香港", host: "hk-016.totallyacdn.com", port: 443 },
    { tag: "英国1", loc: "英国", host: "uk-048.totallyacdn.com", port: 443 },
  ],
};
const zt = { privateKey: "ZTKEY", peerPublicKey: "ZTPUB", ipv4: "100.64.0.2", ipv6: null, deviceId: "zd" };

const { yaml } = buildConfig(warp, opera, proton, wind, zt, []);
const y = R(yaml);

// ---- 切片 ----
// 注意：多行模式下 $ 是「行尾」，拿它当「块结尾」会把组块截成两行。
const END = "(?=^  - name: |(?![^]))";
const gi = y.indexOf("\nproxy-groups:\n");
const ri = y.indexOf("\nrules:\n");
const pi = y.indexOf("\nproxies:\n");
const groupSec = y.slice(gi, ri > 0 ? ri : undefined);
const ruleSec = ri > 0 ? y.slice(ri) : "";
const dnsSec = y.slice(0, pi > 0 ? pi : gi);

const groups = [...groupSec.matchAll(new RegExp("^  - name: (.+)\\n[\\s\\S]*?" + END, "gm"))]
  .map((m) => ({ name: m[1], body: m[0] }));
const grp = (n) => groups.find((b) => b.name === n);
function members(body) {
  const i = body.indexOf("proxies:");
  if (i < 0) return [];
  return body.slice(i + 8).split("\n")
    .map((l) => l.match(/^\s+- (.+)$/))
    .filter(Boolean).map((m) => m[1].trim());
}

const isStream = (s) => (s || "").includes("流媒体");
const isLanding = (s) => (s || "").includes("落地出口");
const REACH = "https://www.gstatic.com/generate_204";
const STRICT = "https://www.google.com/generate_204";

console.log("== 产物测试: dist/worker.js ==");
console.log(`   ${(y.length / 1024).toFixed(1)} KB YAML / ${groups.length} 个组`);

// ---- 1. 探测点全部 HTTPS ----
// 明文 http 探测点会被劫持，而且 unified-delay 的重复 HEAD 计时会被它带歪。
t("没有明文 http:// 探测点", !/^\s*url:\s*http:\/\//m.test(y));
t("宽档探测点存在", y.includes(REACH));
t("严档探测点存在", y.includes(STRICT));

// ---- 2. 🎬 流媒体自动：严档 + 粘性 ----
{
  const g = grp("🎬 流媒体自动");
  t("有 🎬 流媒体自动 组", !!g);
  if (g) {
    t("  用严档探测点", g.body.includes(`url: ${STRICT}`));
    // expected-status 在 mihomo 里是 Go string，不引号会整份配置加载失败
    t('  带 expected-status: "204"（带引号）', /expected-status:\s*"204"/.test(g.body));
    t("  interval 300：粘性，不频繁换出口", /interval:\s*300/.test(g.body));
    t("  tolerance 150：换出口门槛高", /tolerance:\s*150/.test(g.body));
    t("  已不是 90s/10ms 的快切", !/interval:\s*90\b/.test(g.body) && !/tolerance:\s*10\b/.test(g.body));
  }
}

// ---- 3. 🛟 流媒体兜底：跨族降级链 ----
{
  const g = groups.find((b) => /^    type: fallback$/m.test(b.body) && isStream(b.name));
  t("有 🛟 流媒体兜底 (fallback) 组", !!g);
  if (g) {
    t("  用严档探测点", g.body.includes(`url: ${STRICT}`));
    t('  带 expected-status: "204"', /expected-status:\s*"204"/.test(g.body));
    const ms = members(g.body);
    t("  成员含 🎬 流媒体自动", ms.some(isStream));
    t("  成员含 🌐 落地出口（跨族换出口 IP）", ms.some(isLanding));
    t("  最后一级是 DIRECT", ms.includes("DIRECT"));
    // 手机内核（sing-box/SFA 系）不认嵌套 load-balance 组
    t("  不嵌 ⚡ 聚合 load-balance 组", !ms.some((m) => /聚合/.test(m)));
  }
}

// ---- 4. 🎬 流媒体 的首选 = 兜底组 ----
{
  const g = grp("🎬 流媒体");
  t("有 🎬 流媒体 组", !!g);
  if (g) {
    const ms = members(g.body);
    t("  首选是 🛟 流媒体兜底（降级链排在第一位）", !!ms[0] && ms[0].includes("兜底"));
  }
}

// ---- 5. 落地族自动组也升严档 ----
for (const key of ["Proton-自动", "WS-自动"]) {
  const g = grp(key);
  t(`有 ${key} 组`, !!g);
  if (g) t(`  ${key} 严档 + expected-status`, g.body.includes(`url: ${STRICT}`) && /expected-status:\s*"204"/.test(g.body));
}
t("没有 undefined 混进组名", !groups.some((b) => /undefined/.test(b.name)));

// ---- 6. 服务族同出口：YouTube 的 API 域名和 CDN 域名必须同路 ----
// googlevideo 的分片 URL 是绑出口 IP 签的，两个域名走不同出口就是 403。
{
  const ruleLines = ruleSec.split("\n").filter((l) => /^  - /.test(l));
  t("有 rules 段", ruleLines.length > 100);
  const matchRule = (host) => {
    for (const l of ruleLines) {
      const m = l.match(/^  - ([A-Z-]+),(.+?),(.+)$/);
      if (!m) continue;
      const [, type, value, target] = m;
      const v = value.trim();
      if (type === "DOMAIN" && v === host) return target.trim();
      if (type === "DOMAIN-SUFFIX" && (host === v || host.endsWith("." + v))) return target.trim();
      if (type === "DOMAIN-KEYWORD" && host.includes(v)) return target.trim();
    }
    return null;
  };
  for (const h of ["www.youtube.com", "youtubei.googleapis.com", "rr1---sn-x.googlevideo.com",
                   "manifest.googlevideo.com", "i.ytimg.com", "yt3.ggpht.com"]) {
    const target = matchRule(h);
    // ggpht 曾经同时挂在 PLAY 和 STREAM 两个表里，被更早的敏感域名规则
    // 抢走，缩略图就漂到 🌐 落地出口去了。
    t(`  ${h} -> 🎬 流媒体`, !!target && isStream(target) && !isLanding(target));
  }
}

// ---- 7. 流媒体域名 DNS 钉死，不靠 geosite 的地理位置推断 ----
{
  const nsp = /nameserver-policy:([\s\S]*)$/.exec(dnsSec);
  t("dns 段有 nameserver-policy", !!nsp);
  if (nsp) {
    t("  googlevideo 钉到 1.1.1.1 / 8.8.8.8",
      /googlevideo\.com/.test(nsp[1]) && /1\.1\.1\.1/.test(nsp[1]) && /8\.8\.8\.8/.test(nsp[1]));
    t("  ggpht 也钉了（同族）", /ggpht\.com/.test(nsp[1]));
  }
}

cleanup();
console.log(`\n产物: ${pass} 通过 / ${fail} 失败${warn ? ` / ${warn} 警告` : ""}`);
process.exit(fail ? 1 : 0);
