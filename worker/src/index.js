// Opera VPN over Cloudflare WARP (MASQUE) —— Worker 版
//
// 部署只需要绑一个 KV，密码和订阅路径都在界面上设，不用 cron。
//
// 职责:
//   1. 订阅被访问时按需重建：Opera 凭据没过期就直接给缓存，
//      过期了才重新注册。凭据有效期 4 小时（opera-proxy 的 -refresh 默认值）
//   2. WARP 注册信息存 KV 复用，不每次重注册（设备是有限资源）。
//      consumer 免费设备和 Zero Trust 团队设备**各存一份、并存**：
//      前者出免费边缘 198/199 那族，后者出团队边缘 197.x 那族。
//      两套密钥在 CF 那边分开认证，谁也顶替不了谁，所以两份都要留着。
//   3. 首次访问引导设密码，之后订阅路径、改密码都在界面里做
import { registerWarp, verifyDevice, reenrollMasque,
         getAccount, bindLicense, normalizeLicense } from "./warp.js";
import { fetchOpera } from "./opera.js";
import { buildConfig, MAX_EXTRA_DEVICES, CC_PRESETS, DEFAULT_CC } from "./config.js";
import { parseBlob } from "./proton.js";
import { fetchWindscribe, fetchSession } from "./windscribe.js";
import { renderUI, renderLogin, renderSetup, renderNoKV } from "./ui.js";
import {
  safeEqual, makeCred, checkPassword, signToken, verifyToken,
  readCookie, rateLimit, clearRateLimit, normalizePath,
} from "./auth.js";

const K_WARP = "warp:device";     // WARP 注册信息，长期复用
const K_WARP_X = "warp:devices:extra";  // 备用免费设备（备胎），数组
const K_ZT = "zt:device";         // Zero Trust 注册信息（团队边缘用），长期复用
const K_DIAG = "diag:report";     // 最近一次设备体检的结果
const K_LIC = "warp:license";     // 最近一次查到的 WARP+ 状态（warp_plus / 额度）
const K_CFG = "config:yaml";      // 聚合配置（套娃线路 + WARP 直连）
const K_STATE = "state:meta";     // 状态元数据，给 UI 用
const K_CRED = "auth:cred";       // 密码哈希 + 盐
const K_SET = "settings";         // 订阅路径等设置
const K_CLAIM = "auth:claim";     // 初始化时的抢占标记
const K_PROTON = "proton:cred";   // Proton 凭据（由流水线推送）
const K_PUSH = "proton:token";    // 流水线的写入令牌
const K_WIND = "wind:account";    // Windscribe 账号，长期复用（连着开户会被降额）
const K_LOCK = "rebuild:lock";    // 重建锁，防并发重复注册
const COOKIE = "om_session";
const DEFAULT_SUB = "sub";

// Opera 凭据有效期。opera-proxy 默认每 4 小时刷新一次登录和设备密码
// （main.go: -refresh 4h），API 本身不返回真实 TTL，按这个值走。
// 留 10 分钟余量，别卡着点过期。
const TTL_MS = 4 * 3600 * 1000;
const SKEW_MS = 10 * 60 * 1000;

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const html = (body, s = 200) =>
  new Response(body, {
    status: s,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const notFound = () => new Response("Not Found", { status: 404 });

async function getSettings(env) {
  const s = (await env.KV.get(K_SET, "json")) || {};
  return {
    subPath: s.subPath || DEFAULT_SUB,
    // 拥塞控制档位。认不出来（手改坏、老版本写过别的值）就退回默认档，
    // 不抛错 —— 一份订阅里少个可选调优项，好过整个页面打不开。
    cc: CC_PRESETS[s.cc] ? s.cc : DEFAULT_CC,
  };
}

/** 拿 WARP 设备信息，KV 里有就复用，没有才注册。 */
async function getWarp(env, force = false) {
  if (!force) {
    const cached = await env.KV.get(K_WARP, "json");
    if (cached && cached.privateKey) return cached;
  }
  const w = await registerWarp("cf-worker");
  await env.KV.put(K_WARP, JSON.stringify(w));
  return w;
}

/** Windscribe 账号只用流水线推来的那个，Worker 不自己开户。
 *
 * 原因：Cloudflare Worker 的出口 IP 是整个平台共享的，早就被别人拿去开过号。
 * Windscribe 认这个 IP，直接发 status=2 的降额账号（traffic_max=1MB），
 * 而 status=2 的号连 /ServerCredentials 都取不到
 * （400 errorCode 1700 "User unable to generate credentials"），
 * 也就是说降额号完全没法用，不是"额度小一点"的问题。
 *
 * 所以开户放到 GitHub Actions 上做，runner 的 IP 是干净的。
 */
async function getWind(env) {
  const acc = await env.KV.get(K_WIND, "json");
  if (!acc || !acc.sessionAuthHash) return null;
  return await fetchWindscribe(acc);
}

/** 读备用免费设备（备胎）。
 *
 * 免费边缘那 57 个节点全挂在**同一把密钥**上，那台设备被 CF 删除/吊销时
 * 整族瞬间全死 —— 用户看到的就是「warp 的节点全死了，只剩 ZT 能用」。
 * 备胎是另一台免费设备（另一个账号、另一把密钥），加进来给这一族做冗余。
 *
 * 残缺的记录一律丢掉：宁可少一台备胎，也不能把空壳设备喂给生成器
 * 配出一堆永远连不上的节点。 */
async function getExtraWarps(env) {
  const arr = await env.KV.get(K_WARP_X, "json");
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((d) => d && d.privateKey && d.ipv4 && !d.zeroTrust)
    .slice(0, MAX_EXTRA_DEVICES);
}

/** 重建配置。WARP 复用，Opera 每次重取（凭据会过期）。
 *
 * 两份 WARP 注册**并存**，不是二选一：
 *   K_WARP  consumer 免费设备 -> 免费边缘 198/199
 *   K_ZT    Zero Trust 团队设备 -> 团队边缘 197.x
 *
 * 两套密钥在 CF 那边是分开认证的，谁也不能顶替谁。所以两份都要读进来
 * 交给 config.js，三族节点（WARP免费边缘 / ZT团队边缘 / 落地族）才能
 * 在同一份订阅里都活着。
 *
 * 以前这里是 `const warp = zt || await getWarp()` —— ZT 设备一上位就把
 * consumer 那份整个丢掉，而 config.js 又用 ZT 的密钥去生成免费边缘节点，
 * 那 57 个节点全部认证失败，客户端里就只剩 ZT 那 4 个能用。
 */
async function rebuild(env, { forceWarp = false } = {}) {
  // ZT 设备凭据残缺（比如没拿到 ipv4）就当没有，避免配出残废节点
  let ztDev = await env.KV.get(K_ZT, "json");
  if (ztDev && (!ztDev.privateKey || !ztDev.ipv4)) ztDev = null;

  // consumer 那份注册失败（设备数上限之类）不该把整份订阅干掉，
  // ZT 那一路照样能用。两个都没有才真的没法生成。
  let warp = null, warpErr = null;
  try {
    warp = await getWarp(env, forceWarp);
  } catch (e) {
    warpErr = e.message;
  }
  if (!warp && !ztDev) {
    throw new Error(`没有可用的 WARP 设备：consumer 注册失败（${warpErr || "未知原因"}）` +
                    "，Zero Trust 也没配");
  }

  const opera = await fetchOpera();
  // Proton 凭据是流水线推来的，没有就跳过，不影响其他线路
  let proton = null;
  const pc = await env.KV.get(K_PROTON, "json");
  if (pc && (!pc.expiresAt || pc.expiresAt * 1000 > Date.now())) proton = pc;
  // Windscribe 拿不到就跳过。它只是多一条线路，不该拖垮整份订阅。
  // 但错误要留下来 —— 之前直接吞掉，管理页只能显示一句笼统的失败，
  // 排查时完全看不出是限速、开户被拒还是别的。
  let wind = null, windErr = null;
  try {
    wind = await getWind(env);
  } catch (e) {
    windErr = e.message;
  }
  // 备用免费设备（备胎）。拿不到就是空数组，不影响主力那台。
  const extras = await getExtraWarps(env);
  // 拥塞控制档位存在 settings 里，改档位走 /api/cc 然后重建
  const settings = await getSettings(env);
  const { yaml, entries, landings, combos, proton: pn, wind: wn,
          zeroTrust: ztFlag, teamEdges, freeEdges,
          extraDevices, extraEdges, cc, ccLabel } =
    buildConfig(warp, opera, proton, wind, ztDev, extras, { cc: settings.cc });

  const now = Date.now();
  const devInfo = (d) => d ? {
    deviceId: d.deviceId,
    ipv4: d.ipv4,
    ipv6: d.ipv6,
    registeredAt: d.registeredAt,
    zeroTrust: !!d.zeroTrust,
    accountType: d.accountType || "",
  } : null;

  const state = {
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
    stats: { entries, landings, combos, proton: pn || 0, wind: wn || 0,
             teamEdges: teamEdges || 0, freeEdges: freeEdges || 0,
             extraDevices: extraDevices || 0, extraEdges: extraEdges || 0,
             cc: cc || DEFAULT_CC, ccLabel: ccLabel || "" },
    protonExpiresAt: proton ? proton.expiresAt : null,
    wind: wind ? { userId: wind.account.userId, servers: wn || 0 } : null,
    windErr,
    zeroTrust: ztFlag,
    warpErr,
    warp: devInfo(warp),
    // 备胎列表（不含密钥，只给 UI 显示用）
    warpExtras: extras.map(devInfo),
    zt: devInfo(ztDev),
    // 最近一次设备体检结果。没体检过就是 null。
    diag: await env.KV.get(K_DIAG, "json"),
    // 最近一次查到的 WARP+ 状态（绑定时、体检时都会刷新）
    license: await env.KV.get(K_LIC, "json"),
  };

  await env.KV.put(K_CFG, yaml);
  await env.KV.put(K_STATE, JSON.stringify(state));
  return state;
}

/** 凭据是否还在有效期内。没有配置或没有到期时间都算过期。 */
function isFresh(state) {
  if (!state || !state.expiresAt) return false;
  return Date.parse(state.expiresAt) - SKEW_MS > Date.now();
}

/** 按需重建。没过期直接返回缓存，过期了才重新注册。
 *
 * 加锁是因为订阅可能被多个客户端同时拉，不加锁会并发注册一堆
 * Opera 账号，还可能触发风控。拿不到锁的一方用旧配置顶一下，
 * 旧配置也没有才等着。
 */
async function ensureConfig(env) {
  const state = await env.KV.get(K_STATE, "json");
  const yaml = await env.KV.get(K_CFG);
  if (yaml && isFresh(state)) return yaml;

  const lock = await env.KV.get(K_LOCK);
  if (lock && Date.now() - Number(lock) < 90000) {
    // 别人正在重建。有旧配置就先顶着，用户不至于拿不到东西
    if (yaml) return yaml;
  } else {
    await env.KV.put(K_LOCK, String(Date.now()), { expirationTtl: 120 });
    try {
      await rebuild(env);
    } finally {
      await env.KV.delete(K_LOCK);
    }
  }
  return (await env.KV.get(K_CFG)) || yaml;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const ip = req.headers.get("cf-connecting-ip") || "unknown";

    // KV 没绑就没法工作，给个明确指引而不是报一堆栈
    if (!env || !env.KV) return html(renderNoKV(), 500);

    const cred = await env.KV.get(K_CRED, "json");
    const authed = cred && (await verifyToken(cred, readCookie(req, COOKIE)));

    // ---- 首次使用：还没设密码 ----
    if (!cred) {
      if (path === "/api/setup" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const pw = String(body.password || "");
        if (pw.length < 8) return json({ ok: false, error: "密码至少 8 位" }, 400);
        if (pw !== body.confirm) return json({ ok: false, error: "两次输入不一致" }, 400);

        // 抢占式竞态保护。KV 没有 CAS，check-then-put 不是原子的，
        // 两个并发请求会都读到空。这里先写一个带随机标记的占位，
        // 回读确认是自己写的才继续，否则说明被别人抢先了。
        const claim = crypto.randomUUID();
        if (await env.KV.get(K_CRED)) {
          return json({ ok: false, error: "密码已被设置，请刷新页面" }, 409);
        }
        await env.KV.put(K_CLAIM, claim, { expirationTtl: 60 });
        if ((await env.KV.get(K_CLAIM)) !== claim) {
          return json({ ok: false, error: "密码已被设置，请刷新页面" }, 409);
        }

        const c = await makeCred(pw);
        if (await env.KV.get(K_CRED)) {
          return json({ ok: false, error: "密码已被设置，请刷新页面" }, 409);
        }
        await env.KV.put(K_CRED, JSON.stringify(c));
        await env.KV.delete(K_CLAIM);
        const token = await signToken(c);
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; ` +
                          `SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
          },
        });
      }
      if (path === "/") return html(renderSetup());
      return notFound();
    }

    const settings = await getSettings(env);
    const subPath = "/" + settings.subPath;

    // ---- 订阅。客户端带不了 cookie，用 ?token= ----
    if (path === subPath) {
      const t = url.searchParams.get("token") || "";
      if (!(await verifyToken(cred, t)) && !authed) return notFound();

      const yaml = await ensureConfig(env);
      if (!yaml) {
        return new Response("配置生成失败，稍后重试或到管理页手动刷新",
          { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      return new Response(yaml, {
        headers: {
          "content-type": "text/yaml; charset=utf-8",
          // 文件名不加引号：部分客户端不解析引号，会把 \"x\" 当成文件名的一部分
          "content-disposition": "attachment; filename=opera-masque.yaml",
          "profile-update-interval": "4",
          "cache-control": "no-store",
        },
      });
    }

    // ---- 流水线推送 Proton 凭据 ----
    // 令牌直接放在路径里，这样 Actions 只需要配一个 secret。
    // 它只能写 Proton 凭据，动不了管理页；泄露了在管理页换一个即可。
    if (path.startsWith("/push/") && req.method === "POST") {
      const tk = await env.KV.get(K_PUSH);
      // 路径可以带类型后缀：/push/<令牌> 是 Proton，/push/<令牌>/wind 是
      // Windscribe，/push/<令牌>/zt 是 Zero Trust。同一个令牌收三种，
      // Actions 那边还是只配一个 secret。
      const rest = path.slice(6);
      const slash = rest.indexOf("/");
      const got = slash < 0 ? rest : rest.slice(0, slash);
      const kind = slash < 0 ? "proton" : rest.slice(slash + 1);
      if (!tk || !got || !safeEqual(got, tk)) return notFound();

      const body = await req.text();

      if (kind === "wind") {
        // Windscribe 账号由流水线在 GitHub runner 上开。
        // Worker 自己开不了 —— CF 的出口 IP 是共享的，早被人用过，
        // Windscribe 直接发 status=2 的降额号(1MB)，那种号连代理凭据都取不到。
        let acc;
        try {
          acc = JSON.parse(body);
        } catch {
          return json({ ok: false, error: "不是合法的 JSON" }, 400);
        }
        if (!acc || !acc.sessionAuthHash || !acc.locHash) {
          return json({ ok: false, error: "缺 sessionAuthHash 或 locHash" }, 400);
        }
        if (acc.status !== undefined && acc.status !== 1) {
          return json({ ok: false, error: `账号 status=${acc.status}，是被降额的号，没法用` }, 400);
        }
        await env.KV.put(K_WIND, JSON.stringify(acc));
        try {
          const st = await rebuild(env);
          return json({ ok: true, msg: `已写入 Windscribe 账号，${st.stats.wind} 台落地` });
        } catch (e) {
          return json({ ok: true, msg: "账号已写入，但重建配置失败：" + e.message });
        }
      }

      if (kind === "zt") {
        // Zero Trust 设备由 Actions 流水线用 usque 注册好推过来。
        // blob 是 base64(JSON)，里面是 MASQUE 密钥 + 内网地址 + zeroTrust 标记。
        // 拿到就当骨干存进 KV，rebuild 时会用它放团队边缘节点。
        let dev;
        try {
          dev = JSON.parse(atob(body.trim()));
        } catch {
          return json({ ok: false, error: "不是合法的 base64 JSON" }, 400);
        }
        if (!dev || !dev.privateKey || !dev.ipv4) {
          return json({ ok: false, error: "缺 privateKey 或 ipv4" }, 400);
        }
        if (dev.v !== 1) {
          return json({ ok: false, error: `不认识的版本 v${dev.v}` }, 400);
        }
        // 强制标记成 Zero Trust，不管流水线那边写了什么
        dev.zeroTrust = true;
        if (!dev.accountType) dev.accountType = "team";
        await env.KV.put(K_ZT, JSON.stringify(dev));
        try {
          const st = await rebuild(env);
          return json({ ok: true,
            msg: `已写入 Zero Trust 设备，${st.stats.teamEdges} 个团队边缘已加入` });
        } catch (e) {
          return json({ ok: true, msg: "设备已写入，但重建配置失败：" + e.message });
        }
      }

      let parsed;
      try {
        parsed = parseBlob(body);
      } catch (e) {
        return json({ ok: false, error: e.message }, 400);
      }
      await env.KV.put(K_PROTON, JSON.stringify(parsed));
      // 凭据换了，配置得重建才生效
      try {
        const st = await rebuild(env);
        return json({ ok: true, msg: `已写入 ${parsed.servers.length} 台 Proton 落地`,
                      combos: st.stats.combos, proton: st.stats.proton });
      } catch (e) {
        return json({ ok: true, msg: "凭据已写入，但重建配置失败：" + e.message });
      }
    }

    // ---- 登录 ----
    if (path === "/login" && req.method === "POST") {
      if (!(await rateLimit(env, ip))) {
        return json({ ok: false, error: "尝试过多，15 分钟后再试" }, 429);
      }
      const body = await req.json().catch(() => ({}));
      if (!(await checkPassword(cred, String(body.password || "")))) {
        return json({ ok: false, error: "密码错误" }, 401);
      }
      await clearRateLimit(env, ip);
      const token = await signToken(cred);
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; ` +
                        `SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
        },
      });
    }

    if (path === "/logout") {
      return new Response(null, {
        status: 302,
        headers: {
          location: "/",
          "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        },
      });
    }

    // ---- 首页 ----
    if (path === "/") {
      if (!authed) return html(renderLogin());
      const state = await env.KV.get(K_STATE, "json");
      const token = await signToken(cred);
      const pushToken = await env.KV.get(K_PUSH);
      const protonCred = await env.KV.get(K_PROTON, "json");
      const ztDevice = await env.KV.get(K_ZT, "json");
      // 用量是实时问 Windscribe 的，问不到就不显示，不影响页面其他部分
      let windUsage = null;
      const wa = await env.KV.get(K_WIND, "json");
      if (wa && wa.sessionAuthHash) {
        try { windUsage = await fetchSession(wa); } catch { windUsage = null; }
      }
      return html(renderUI(state, url.host, subPath, token, cred,
                           pushToken, protonCred, windUsage, ztDevice));
    }

    // ---- 以下都要登录。未登录一律 404，不用 401 ----
    // 401 会告诉探测者"这个路径存在"，等于泄露订阅路径的存在性
    if (!authed) return notFound();

    if (path === "/api/state") {
      return json((await env.KV.get(K_STATE, "json")) || {});
    }

    // 重新生成流水线的写入令牌
    if (path === "/api/proton/token" && req.method === "POST") {
      const t = crypto.randomUUID().replace(/-/g, "") +
                crypto.randomUUID().replace(/-/g, "");
      await env.KV.put(K_PUSH, t);
      return json({ ok: true, token: t, msg: "令牌已更新，旧的立即失效" });
    }

    // 清掉 Proton 凭据
    if (path === "/api/proton/clear" && req.method === "POST") {
      await env.KV.delete(K_PROTON);
      try {
        await rebuild(env);
      } catch { /* 重建失败不影响清除本身 */ }
      return json({ ok: true, msg: "Proton 凭据已清除" });
    }

    // 改订阅路径
    if (path === "/api/sub-path" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const p = normalizePath(body.path);
      if (!p) {
        return json({
          ok: false,
          error: "只能用字母数字和 - _，1-64 位，且不能是 login/logout/api/setup",
        }, 400);
      }
      await env.KV.put(K_SET, JSON.stringify({ ...settings, subPath: p }));
      return json({ ok: true, msg: `订阅路径已改为 /${p}` });
    }

    // 改密码。旧 token 会因为哈希变化自动失效，所以要重新下发
    if (path === "/api/password" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (!(await checkPassword(cred, String(body.current || "")))) {
        return json({ ok: false, error: "当前密码不对" }, 401);
      }
      const pw = String(body.password || "");
      if (pw.length < 8) return json({ ok: false, error: "新密码至少 8 位" }, 400);
      if (pw !== body.confirm) return json({ ok: false, error: "两次输入不一致" }, 400);

      const c = await makeCred(pw);
      await env.KV.put(K_CRED, JSON.stringify(c));
      const token = await signToken(c);
      return new Response(
        JSON.stringify({ ok: true, msg: "密码已改，旧的订阅链接全部失效" }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; ` +
                          `SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
          },
        });
    }

    // 只换 Opera 凭据，WARP 设备保留
    if (path === "/api/refresh" && req.method === "POST") {
      try {
        const s = await rebuild(env);
        return json({ ok: true, msg: `已刷新，${s.stats.combos} 个组合` });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // 重注册 consumer 免费 WARP 设备，免费边缘那族整体连不上时才用。
    //
    // 两份设备现在是并存的，所以 Zero Trust 在也照样能重注册这一份 ——
    // 它只换 K_WARP，不碰 K_ZT。ZT 那边要换仍得走「清除 ZT → 重新粘 JWT」
    // （JWT 只有 60 秒寿命，没法静默重注册）。
    if (path === "/api/reset-warp" && req.method === "POST") {
      const ztDev = await env.KV.get(K_ZT, "json");
      try {
        const s = await rebuild(env, { forceWarp: true });
        return json({ ok: true,
          msg: `免费 WARP 已重注册，免费边缘 ${s.stats.freeEdges || 0} 个` +
               (ztDev ? "；Zero Trust 那份没动" : "") });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // ---- 设备体检 ----
    // 正面回答「为什么整族节点全死了」：拿 device token 去 CF 问一句
    // 「这台设备还在吗」。设备被删/被吊销时 `GET /reg/{id}` 回 401/404，
    // 而客户端那边只会显示一片超时 —— 看起来就是「节点全死了」。
    //
    // 能查的只有「密钥还作不作数」，**查不了某个接入点通不通**：
    // Workers 没有 UDP 出站，跑不了 QUIC，没法替客户端做真实的 MASQUE
    // 握手。所以别把这个结果当成「哪个节点快」。
    if (path === "/api/diag" && req.method === "POST") {
      const warp = await env.KV.get(K_WARP, "json");
      const ztDev = await env.KV.get(K_ZT, "json");
      const extras = await getExtraWarps(env);

      const roles = [
        warp ? { role: "免费 WARP（主力）", dev: warp } : null,
        ...extras.map((d, i) => ({ role: `免费 WARP（备胎 ${i + 1}）`, dev: d })),
        ztDev ? { role: "Zero Trust 团队设备", dev: ztDev } : null,
      ].filter(Boolean);

      if (!roles.length) {
        return json({ ok: false, error: "KV 里一台设备都没有，先注册" }, 400);
      }

      const items = [];
      for (const r of roles) {
        const v = await verifyDevice(r.dev);
        // 顺手把账号状态也读出来 —— 「我到底在不在 WARP+ 上」是用户
        // 问得最多的一句，跟体检共用一次点击。
        const acc = v.ok === true ? await getAccount(r.dev) : { ok: null };
        items.push({
          // null = 查不了（没有 token 的流水线 ZT 设备）
          warpPlus: acc.ok === true ? acc.warpPlus : null,
          premiumData: acc.ok === true ? acc.premiumData : 0,
          quota: acc.ok === true ? acc.quota : 0,
          role: r.role,
          deviceId: r.dev.deviceId || "",
          ipv4: r.dev.ipv4 || "",
          registeredAt: r.dev.registeredAt || "",
          accountType: v.accountType || r.dev.accountType || "",
          // ok: true 活着 / false 被删 / null 查不了（没有 token）
          ok: v.ok, error: v.error || "",
        });
      }

      const report = { at: new Date().toISOString(), items };
      await env.KV.put(K_DIAG, JSON.stringify(report));

      // 主力那台的账号状态单独存一份：管理页的 WARP+ 区块直接读它，
      // 不用每次开页面都去打一次 CF。
      const main = items.find((x) => x.role === "免费 WARP（主力）" && x.warpPlus !== null);
      if (main) {
        await env.KV.put(K_LIC, JSON.stringify({
          at: report.at, warpPlus: main.warpPlus,
          premiumData: main.premiumData, quota: main.quota,
          license: main.license || "", deviceId: main.deviceId || "",
        }));
      }
      // 顺手并进 state：体检本身不重建配置（重建要重新拉 Opera 凭据，
      // 代价大且没必要），但管理页读的是 K_STATE，不写进去刷新后看不到。
      // state 可能还不存在（KV 全新、还没生成过订阅）—— 那就先建个壳，
      // 否则刷新后一样看不到体检结果。重建时 rebuild() 会从 K_DIAG 把它读回来。
      const meta = (await env.KV.get(K_STATE, "json")) || {};
      meta.diag = report;
      await env.KV.put(K_STATE, JSON.stringify(meta));

      const dead = items.filter((x) => x.ok === false);
      const unknown = items.filter((x) => x.ok === null);
      return json({
        ok: true, report,
        msg: dead.length
          ? `${dead.map((d) => d.role).join("、")} 已被 CF 删除或吊销 —— ` +
            "这就是整族节点全死的原因。免费那几台可以点「一键修复」自动换新；" +
            "Zero Trust 那份要回下面粘一份新 JWT。"
          : `设备都正常${unknown.length ? `（${unknown.length} 台没法校验，见下表）` : ""}。` +
            "如果客户端里还是有节点连不上，那就是链路/端口层面的问题，" +
            "不是设备凭据：换个端口（4443 / 8443 / 8095）或用 ZT 族试。",
      });
    }

    // ---- 换拥塞控制档位 ----
    // 这是「网速」最直接的一个开关，所以做成一个按钮而不是让用户改 YAML。
    // 三个档：
    //   极速  bbr + cwnd 128 + aggressive —— 单流吞吐最大，丢包也硬冲
    //   标准  bbr + cwnd 64  + standard   —— 默认，抗丢包且不霸占链路
    //   回退  不下发，用内核默认 Cubic     —— 极拥堵链路上最保守
    // 注意它是**生成期**开关：改完必须重建，客户端要重新导入订阅才生效。
    if (path === "/api/cc" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const cc = String(body.cc || "");
      if (!CC_PRESETS[cc]) {
        return json({ ok: false,
          error: `档位只能是 ${Object.keys(CC_PRESETS).join(" / ")}` }, 400);
      }
      const st0 = await getSettings(env);
      await env.KV.put(K_SET, JSON.stringify({ ...st0, cc }));
      let st = null;
      try { st = await rebuild(env); }
      catch (e) { return json({ ok: false, error: `已保存档位，但重建失败：${e.message}` }, 500); }
      const p = CC_PRESETS[cc];
      return json({ ok: true,
        msg: `拥塞控制已切到「${p.label}」档` +
          (p.cc ? `（${p.cc}${p.cwnd ? ` · cwnd ${p.cwnd}` : ""}${p.profile ? ` · ${p.profile}` : ""}）`
                : "（不下发，内核默认 Cubic）") +
          `。客户端要重新导入一次订阅才生效（免费边缘 ${st.stats.freeEdges || 0} 个节点已重写）` });
    }

    // ---- WARP+ 授权码 ----
    // 免费版走的是共享的普通出口，容易被出口拥塞和链路 QoS 拖住；
    // 绑了授权码之后账号变成 WARP+，流量走 Cloudflare 的 Argo 智能选路，
    // 这是单流速度上最大的一根杠杆。授权码在 1.1.1.1 App 的
    // Account > Key 里（只认官方买的，推荐得来的无效）。
    //
    // fresh=true 走「换新设备再绑定」：CF 侧有个老 bug，已经连过 WARP 的
    // 账号绑了授权码也可能不生效（warp_plus 仍是 false）。正解是注册一台
    // 干净设备、在它连任何一次之前就把授权码绑上去。
    if (path === "/api/warp/license" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const nz = normalizeLicense(body.key);
      if (!nz.ok) return json({ ok: false, error: nz.error }, 400);
      const fresh = !!body.fresh;

      let warp = await env.KV.get(K_WARP, "json");
      const notes = [];
      if (fresh || !warp || !warp.token) {
        if (!fresh && (!warp || !warp.token)) {
          notes.push("原设备没有 device token，先注册了一台新的");
        }
        try {
          warp = await registerWarp(fresh ? "cf-worker-plus" : "cf-worker");
          if (fresh) notes.push("已新注册一台干净设备");
        } catch (e) {
          return json({ ok: false, error: `注册设备失败：${e.message}` }, 500);
        }
      }

      let acc;
      try {
        acc = await bindLicense(warp, nz.key);
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }

      // 绑定成功才落盘：失败时保留原来那台设备，别把它弄丢了
      await env.KV.put(K_WARP, JSON.stringify(warp));
      const rec = { at: new Date().toISOString(), ...acc,
                    license: nz.key.slice(0, 4) + "…", deviceId: warp.deviceId || "" };
      await env.KV.put(K_LIC, JSON.stringify(rec));

      let st = null;
      try { st = await rebuild(env); } catch { /* 重建失败不影响绑定本身 */ }

      const head = notes.length ? notes.join("；") + "。" : "";
      if (acc.warpPlus) {
        return json({ ok: true, warpPlus: true,
          msg: `${head}授权码已生效 —— 账号已是 WARP+，流量走 Argo 智能选路，` +
            `速度通常明显更高更稳。配置已重建` +
            `${st ? `（免费边缘 ${st.stats.freeEdges || 0} 个）` : ""}，` +
            "重新导入一次订阅即可" });
      }
      return json({ ok: true, warpPlus: false,
        msg: `${head}授权码 CF 收下了，但 warp_plus 仍是 false。` +
          "这是 CF 侧已知问题：已经连过 WARP 的账号绑了也可能不生效。" +
          "点「换新设备再绑定」—— 新设备在连任何一次之前绑，就生效。" });
    }

    // ---- 一键修复：把被 CF 删掉的免费设备换新 ----
    // 免费设备（主力 + 备胎）能静默重注册，因为它们走匿名 API，不需要 JWT。
    // Zero Trust 那份不行 —— 重注册要一个新的 60 秒 JWT，只能提示用户重粘。
    if (path === "/api/warp/repair" && req.method === "POST") {
      const out = [];

      let warp = await env.KV.get(K_WARP, "json");
      if (warp) {
        const v = await verifyDevice(warp);
        if (v.ok === false) {
          try {
            warp = await registerWarp("cf-worker");
            await env.KV.put(K_WARP, JSON.stringify(warp));
            out.push(`免费主力已换新（原来那台：${v.error}）`);
          } catch (e) {
            out.push(`免费主力换新失败：${e.message}`);
          }
        } else if (v.ok === true) {
          out.push("免费主力还活着，没动它");
        } else {
          out.push(`免费主力没法校验：${v.error}`);
        }
      }

      const extras = await getExtraWarps(env);
      if (extras.length) {
        const kept = [];
        for (const d of extras) {
          const v = await verifyDevice(d);
          if (v.ok === false) {
            try {
              kept.push(await registerWarp("cf-worker-backup"));
              out.push(`备胎 ${(d.deviceId || "").slice(0, 8)}… 已换新`);
            } catch (e) {
              out.push(`备胎换新失败：${e.message}`);
            }
          } else {
            kept.push(d);
          }
        }
        await env.KV.put(K_WARP_X, JSON.stringify(kept));
      }

      let st = null;
      try { st = await rebuild(env); }
      catch (e) { return json({ ok: false, msg: out.join("；"), error: e.message }, 500); }

      return json({ ok: true, msg: out.join("；") +
        `。已重建：免费边缘 ${st.stats.freeEdges} 个` +
        (st.stats.extraEdges ? ` + 备胎 ${st.stats.extraEdges} 个` : "") });
    }

    // ---- 给免费主力设备重装一把 MASQUE 密钥 ----
    // 用在「设备在 CF 那边还活着，但本地这把密钥认证不过」的情况。
    // 客户端会报 `CRYPTO_ERROR 0x131 (remote): tls: access denied`，
    // 整族节点全死。重装密钥不换 deviceId，比重新注册温和。
    if (path === "/api/warp/rekey" && req.method === "POST") {
      const warp = await env.KV.get(K_WARP, "json");
      if (!warp) return json({ ok: false, error: "还没有免费设备，先点刷新生成" }, 400);
      if (!warp.token) {
        return json({ ok: false, error: "这台设备没有 device token，没法重装密钥，只能重新注册" }, 400);
      }
      try {
        const upd = await reenrollMasque(warp, "cf-worker");
        await env.KV.put(K_WARP, JSON.stringify(upd));
        const st = await rebuild(env);
        return json({ ok: true,
          msg: `已给免费主力重装 MASQUE 密钥并重建（免费边缘 ${st.stats.freeEdges} 个）` });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // ---- 增加 / 移除备用免费设备 ----
    // 备胎是另一台免费设备（另一个账号、另一把密钥）。免费族的节点全挂在
    // 一把密钥上，加一台备胎就是给这一族上冗余：主力被 CF 清掉时，
    // 「♻️ 自动选择」里还有备胎的节点能测到，不至于整族全红。
    if (path === "/api/warp/add" && req.method === "POST") {
      const extras = await getExtraWarps(env);
      if (extras.length >= MAX_EXTRA_DEVICES) {
        return json({ ok: false,
          error: `最多 ${MAX_EXTRA_DEVICES} 台备胎。再多收益很小，只会把订阅撑大。` }, 400);
      }
      try {
        extras.push(await registerWarp(`cf-worker-backup${extras.length + 1}`));
        await env.KV.put(K_WARP_X, JSON.stringify(extras));
        const st = await rebuild(env);
        return json({ ok: true,
          msg: `备胎 +1（共 ${extras.length} 台，${st.stats.extraEdges} 个接入点）` });
      } catch (e) {
        return json({ ok: false, error: `注册备胎失败：${e.message}` }, 500);
      }
    }

    if (path === "/api/warp/remove" && req.method === "POST") {
      const extras = await getExtraWarps(env);
      if (!extras.length) return json({ ok: false, error: "现在没有备胎" }, 400);
      extras.pop();
      await env.KV.put(K_WARP_X, JSON.stringify(extras));
      try { await rebuild(env); } catch { /* 重建失败不影响移除本身 */ }
      return json({ ok: true, msg: `备胎 -1，剩 ${extras.length} 台` });
    }

    // 用 Zero Trust 的 Team Token（JWT）注册团队设备。
    //
    // JWT 只有 60 秒寿命，所以必须在这里立刻用掉，不能存起来改天用。
    // 注册成功后拿到的是长期有效的设备凭据，存进 KV 复用，之后
    // rebuild 会拿它当骨干、把团队边缘 197.x 放进订阅。
    //
    // 这条要登录才能打：JWT 等同你 Zero Trust 团队的临时钥匙，
    // 敞着放等于谁都能往你团队塞设备。
    if (path === "/api/zt/enroll" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const jwt = String(body.jwt || "").trim();
      if (!jwt) return json({ ok: false, error: "把 Team Token 粘进来" }, 400);
      if (jwt.length < 40) {
        return json({ ok: false, error: "这个不像 JWT，太短了。回管理页重新拿一个。" }, 400);
      }
      try {
        const dev = await registerWarp("cf-worker-zt", jwt);
        await env.KV.put(K_ZT, JSON.stringify(dev));
        let st;
        try { st = await rebuild(env); }
        catch (e) {
          return json({ ok: true, msg: "设备已注册，但重建配置失败：" + e.message });
        }
        return json({ ok: true,
          msg: `已注册 Zero Trust 设备：团队边缘 ${st.stats.teamEdges} 个 + ` +
               `免费边缘 ${st.stats.freeEdges || 0} 个，两族并存` });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // 清掉 Zero Trust 设备。只摘掉团队边缘那一族，
    // consumer 免费 WARP 那份不受影响，订阅里其他节点照常。
    if (path === "/api/zt/clear" && req.method === "POST") {
      await env.KV.delete(K_ZT);
      try { await rebuild(env); } catch { /* 重建失败不影响清除本身 */ }
      return json({ ok: true,
        msg: "已清除 Zero Trust（团队边缘那一族），免费 WARP 和落地族不受影响" });
    }

    // 清掉 Windscribe 账号。换号要重跑流水线 —— Worker 自己开不出可用的号
    if (path === "/api/wind/clear" && req.method === "POST") {
      await env.KV.delete(K_WIND);
      try {
        await rebuild(env);
      } catch { /* 重建失败不影响清除本身 */ }
      return json({ ok: true, msg: "已清除，重跑一次流水线拿新账号" });
    }

    return notFound();
  },
};
