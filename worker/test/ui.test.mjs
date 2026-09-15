// 管理页渲染测试。跑: node test/ui.test.mjs
//
// 起因：新增了「设备存活体检」区块和「旧配置识别」提示。这两块都是纯字符串
// 拼装，最容易出的问题是「某个降级分支把 undefined 拼进 HTML」或者
// 「模板字面量少个括号」—— 跑一遍渲染 + 断言关键内容在不在，
// 比肉眼看模板便宜得多。顺带守住一条底线：页面里不能出现私钥。
import { renderUI } from "../src/ui.js";

let pass = 0, fail = 0;
const t = (n, c) => { c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n)); };

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const base = { updatedAt: iso(now), expiresAt: iso(now + 3 * 3600e3),
               zeroTrust: true, warpErr: null };
const render = (state, ztDevice = null) =>
  renderUI(state, "h.workers.dev", "/sub", "tok", { updatedAt: now },
           "push", null, null, ztDevice);
const dev = (id, ip, extra = {}) => ({
  deviceId: id, ipv4: ip, ipv6: "2606:4700:110::1",
  registeredAt: iso(now), ...extra,
});

// ---- 三族设备 + 一次「主力活着、备胎被删、ZT 查不了」的体检 ----
{
  const st = {
    ...base,
    stats: { entries: 71, combos: 122, freeEdges: 57, teamEdges: 14,
             landings: 12, proton: 10, wind: 13, extraDevices: 2, extraEdges: 16 },
    warp: dev("aaaaaaaa-bbbb", "172.16.0.2"),
    warpExtras: [dev("11111111-2222", "172.16.0.3"), dev("99999999-8888", "172.16.0.4")],
    diag: { at: iso(now - 3 * 60000), items: [
      { role: "免费 WARP（主力）", deviceId: "aaaaaaaa-bbbb", ipv4: "172.16.0.2",
        accountType: "free", ok: true, error: "" },
      { role: "免费 WARP（备胎 1）", deviceId: "11111111-2222", ipv4: "172.16.0.3",
        accountType: "free", ok: false,
        error: "设备已被 CF 删除或吊销（HTTP 404）—— 这一族的节点会全部连不上" },
      { role: "免费 WARP（备胎 2）", deviceId: "99999999-8888", ipv4: "172.16.0.4",
        accountType: "free", ok: true, error: "" },
      { role: "Zero Trust 团队设备", deviceId: "ffffffff-0000", ipv4: "172.16.0.5",
        accountType: "team", ok: null,
        error: "设备是流水线推来的（不带 device token），CF 侧无法校验。" },
    ] },
  };
  const h = render(st, dev("ffffffff-0000", "172.16.0.5", { accountType: "team" }));

  t("有「设备存活体检」区块", h.includes("设备存活体检"));
  t("列出主力设备", h.includes("免费 WARP（主力）"));
  t("列出两台备胎", h.includes("免费 WARP（备胎 1）") && h.includes("免费 WARP（备胎 2）"));
  t("列出 ZT 团队设备", h.includes("Zero Trust 团队设备"));
  t("活着标成 ✓", h.includes("✓ 活着"));
  t("被 CF 删的标成 ✗", h.includes("✗ 已被 CF 删除"));
  t("查不了的标成 ?（不当成「死了」）", h.includes("? 没法校验"));
  t("把被删那台的原因摊出来", h.includes("HTTP 404"));
  t("体检时间显示成「N 分钟前」", h.includes("3 分钟前"));

  for (const p of ["/api/diag", "/api/warp/repair", "/api/warp/rekey",
                   "/api/warp/add", "/api/warp/remove"]) {
    t("有按钮打 " + p, h.includes("'" + p + "'"));
  }
  t("备胎上限取自 MAX_EXTRA_DEVICES", h.includes("最多 3 台"));
  t("显示当前备胎台数与接入点", h.includes("当前 2 台、16 个接入点"));
  t("说明免费族共用一把密钥", h.includes("共用同一台设备的一把密钥"));
  t("说清体检查不出端口通不通", h.includes("查不出某个接入点通不通"));
  t("点名 CRYPTO_ERROR 0x131 对应「重装密钥」", h.includes("CRYPTO_ERROR 0x131"));
}

// ---- 旧配置识别：数量提示要带上本份应有的数 ----
{
  const h = render({ ...base, stats: { freeEdges: 57, teamEdges: 14, extraEdges: 16 } });
  t("提示「数量对不上就是旧配置」", h.includes("数量对不上就是导入的旧配置"));
  t("写清免费边缘应有 57 个", h.includes("免费边缘 57 个"));
  t("写清 ZT 团队边缘应有 14 个", h.includes("ZT 团队边缘 14 个"));
  t("带上备胎节点数", h.includes("备胎 16 个"));

  const h0 = render({ ...base, stats: { freeEdges: 57, teamEdges: 14, extraEdges: 0 } });
  t("没备胎就不提备胎数量", !h0.includes("备胎 0 个") && h0.includes("ZT 团队边缘 14 个"));
}

// ---- 降级路径：都不能抛异常 ----
{
  const tryRender = (st, zt = null) => { try { return render(st, zt); } catch { return null; } };

  const empty = tryRender({ ...base, stats: {} });
  t("空 state 不抛异常", empty !== null);
  t("空 state 提示 KV 里没设备", !!empty && empty.includes("KV 里一台设备都没有"));
  t("空 state 不显示体检报告", !!empty && !empty.includes("最近一次体检"));
  t("空 state 数量算成 0 而不是 undefined", !!empty && empty.includes("免费边缘 0 个"));

  const one = tryRender({ ...base, stats: { freeEdges: 57 },
                          warp: dev("aaaaaaaa-bbbb", "172.16.0.2") });
  t("有设备但没体检过 → 显示「未体检」",
    !!one && one.includes("免费 WARP（主力）") && one.includes("未体检"));
  t("没体检过就不显示报告块", !!one && !one.includes("最近一次体检"));

  const dirty = tryRender({ ...base, stats: { freeEdges: 57 },
    warp: dev("aaaaaaaa-bbbb", "172.16.0.2"),
    diag: { at: iso(now), items: null } });
  t("diag.items 是脏数据也不炸", !!dirty && dirty.includes("免费 WARP（主力）"));
  t("脏 diag 不渲染报告块", !!dirty && !dirty.includes("最近一次体检"));

  const ztOnly = tryRender({ ...base, stats: { teamEdges: 14 } },
    dev("ffffffff-0000", "172.16.0.5", { accountType: "team" }));
  t("只有 ZT、没有免费设备也能渲染",
    !!ztOnly && ztOnly.includes("Zero Trust 团队设备"));
}

// ---- 底线：密钥不进页面 ----
{
  const h = render({
    ...base, stats: { freeEdges: 57 },
    warp: dev("aaaaaaaa-bbbb", "172.16.0.2",
      { privateKey: "SECRET-KEY-1", peerPublicKey: "SECRET-PUB", token: "SECRET-TOK" }),
    warpExtras: [dev("11111111-2222", "172.16.0.3", { privateKey: "SECRET-KEY-2" })],
  });
  t("页面里没有私钥", !h.includes("SECRET-KEY-1") && !h.includes("SECRET-KEY-2"));
  t("页面里没有 device token", !h.includes("SECRET-TOK"));
}

console.log(`\n通过 ${pass} 失败 ${fail}`);
if (fail) process.exit(1);
