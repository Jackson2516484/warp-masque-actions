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

// ---- 拥塞控制档位 / WARP+ 授权码 ----
// 这两块是「怎么一直用上超高速」的操作面：档位决定同一条链路跑多快，
// 授权码决定走不走 CF 的优质骨干（Argo）。UI 上最容易出的问题是
// 「state 里还没有这个字段 → 拼出 undefined」和「已生效了还显示输入框」，
// 所以这里把有/无、成/败几种 state 都渲染一遍。
{
  const withStats = (extra) => ({ ...base,
    stats: { entries: 71, freeEdges: 57, teamEdges: 14, landings: 12,
             cc: "standard", ccLabel: "标准", ...extra } });

  // ---- 档位区块 ----
  {
    const h = render(withStats());
    t("有「拥塞控制」区块", h.includes("拥塞控制 · 单流速度的第一杠杆"));
    t("显示当前档位（标准 / standard）", h.includes("标准（standard）"));
    t("显示实际下发的参数", h.includes("bbr · cwnd 64 · standard"));
    for (const k of ["extreme", "standard", "cubic"]) {
      t(`有切到 ${k} 档的按钮`, h.includes(`setCC('${k}')`));
    }
    t("当前档位那个按钮打了勾", h.includes("标准 ✓"));
    t("说明里点出 masque 出站认这三个键", h.includes("adapter/outbound/masque.go"));
    t("说清内核默认是 Cubic 且丢包就砍窗口", h.includes("Cubic") && h.includes("砍半"));
    t("说清 cwnd 单位是包不是字节", h.includes("单位是<b>包</b>"));
    t("说明这是生成期开关、要重新导入", h.includes("重新导入一次订阅"));
    t("把「回退」档解释成恢复原状", h.includes("等于完全恢复原状"));
  }

  // 极速档 / 回退档要显示不同的参数，不能永远显示默认那一行
  {
    const h1 = render(withStats({ cc: "extreme", ccLabel: "极速" }));
    t("极速档显示 cwnd 128 / aggressive",
      h1.includes("bbr · cwnd 128 · aggressive") && h1.includes("极速（extreme）"));
    t("极速档打勾打在极速上", h1.includes("极速 ✓"));

    const h2 = render(withStats({ cc: "cubic", ccLabel: "回退" }));
    t("回退档显示「不下发」而不是空的",
      h2.includes("不下发，用内核默认 Cubic"));
    t("回退档打勾打在回退上", h2.includes("回退 ✓"));
  }

  // stats 里没有 cc（老 state / 空 state）时不能拼出 undefined
  {
    const h = render({ ...base, stats: { freeEdges: 57 } });
    t("stats 缺 cc 时退回默认档", h.includes("标准（standard）"));
    t("stats 缺 cc 时不出现 undefined", !/undefined/.test(h.split("拥塞控制")[1].split("</div>\n    </div>")[0]));
  }

  // ---- WARP+ 区块 ----
  {
    const h = render(withStats());
    t("有「WARP+ 极速通道」区块", h.includes("WARP+ 极速通道"));
    t("没查过就说「未查询」", h.includes("未查询"));
    t("没查过时给输入框", h.includes('id="lic"'));
    t("有两个按钮：绑当前设备 / 换新设备",
      h.includes("bindLic(false)") && h.includes("bindLic(true)"));
    t("输入框带格式提示", h.includes("XXXXXXXX-XXXXXXXXX-XXXXXXXXXX"));
    t("说明里点出走 Argo 智能选路", h.includes("Argo"));
    t("说清授权码在 1.1.1.1 App 里取", h.includes("1.1.1.1 App"));
    t("说清只认官方买的码", h.includes("只认官方买的"));
    t("解释了两个按钮的区别", h.includes("已经连过 WARP 的账号"));
    t("提醒一个码只能绑一个账号", h.includes("同一时间只能绑一个账号"));
  }

  // 已生效：显示 WARP+ 并撤掉输入框（避免用户重复提交）
  {
    const h = render({ ...withStats(),
      license: { at: iso(now), warpPlus: true, premiumData: 5 * 1073741824, quota: 0 } });
    t("已生效时显示 WARP+ 已启用", h.includes("WARP+ 已启用"));
    t("已生效时显示剩余额度", h.includes("剩余 5.00 GB"));
    t("已生效时不再显示输入框", !h.includes('id="lic"'));
    t("已生效时不再显示那两个按钮中依赖输入框的那个", !h.includes("bindLic(false)"));
  }

  // 半成功：CF 收下了但没生效 —— 必须留着输入框和「换新设备」这条路
  {
    const h = render({ ...withStats(), license: { at: iso(now), warpPlus: false } });
    t("没生效时显示「免费版」并标注查询时间", h.includes("免费版（"));
    t("没生效时仍显示输入框", h.includes('id="lic"'));
    t("没生效时仍能点「换新设备再绑定」", h.includes("bindLic(true)"));
    t("没生效时不显示 WARP+ 已启用", !h.includes("WARP+ 已启用"));

    // ---- 「客户端里怎么选 WARP+ 节点」----
    // 线上真的被这么问过（用户看着管理页写着「WARP+ 已启用」，回客户端里
    // 找不到任何 WARP+ 字样）。根因：WARP+ 是**账号属性**，不会另长出一份
    // 节点。UI 必须主动把这件事讲清楚，否则用户会一直找「WARP+ 那一组」。
    {
      const h = render({ ...withStats(),
        license: { at: iso(now), warpPlus: true, premiumData: 5 * 1073741824 } });
      t("正面回答「怎么选」：没得选、整族都是", h.includes("没得选，整族都是"));
      t("说清 W+ 是节点名前缀", h.includes("W+&nbsp;"));
      t("说清哪些节点不带 W+（备胎 / ZT）", h.includes("哪些节点不带 W+"));
      t("节点区块也说明 W+ 标记的含义",
        h.includes("看到这个标记就说明授权码"));
      t("不再说 ZT 团队边缘也吃消费版授权码",
        !h.includes("ZT 团队边缘都吃这个账号"));
    }
  }

  // ---- 节点区块那条「别钉死单个节点」的提示 ----
  {
    const h = render(withStats());
    t("提示别手动钉死单个节点", h.includes("别手动钉死某一个具体节点"));
    t("指路 ♻️ 自动选择 并写清 60 秒 / 10ms", h.includes("60 秒重测") && h.includes("10ms"));
    t("指路 🔄 故障转移 给「绝不自动换」的人", h.includes("🔄 故障转移"));
    t("指路 WARP直连 给想手选的人", h.includes("WARP直连"));
  }

  // ---- 降级：空 state 也得能渲染 ----
  {
    let h = null;
    try { h = render({}); } catch (e) { h = null; }
    t("空 state 下两个新区块也能渲染",
      !!h && h.includes("拥塞控制") && h.includes("WARP+ 极速通道") && h.includes('id="lic"'));
    t("空 state 下档位显示默认而不是崩溃", !!h && h.includes("标准（standard）"));
  }
}

console.log(`\n通过 ${pass} 失败 ${fail}`);
if (fail) process.exit(1);
