// 路由级测试：mock env，验证首次初始化、鉴权、UI 改配置都对。
// 跑: node test/route.test.mjs
import worker from "../src/index.js";

const PW = "test-password-123";
let kv, env;

function reset() {
  kv = new Map();
  env = {
    KV: {
      async get(k, t) { const v = kv.get(k); return t === "json" && v ? JSON.parse(v) : v ?? null; },
      async put(k, v) { kv.set(k, v); },
      async delete(k) { kv.delete(k); },
    },
  };
}

const req = (path, opt = {}) => new Request(`https://x.dev${path}`, {
  headers: { "cf-connecting-ip": "9.9.9.9", ...(opt.headers || {}) },
  method: opt.method || "GET",
  body: opt.body,
});
const post = (p, body, headers) =>
  req(p, { method: "POST", body: JSON.stringify(body), headers });

let pass = 0, fail = 0;
const t = (n, c) => { c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n)); };

// ---- KV 未绑 ----
t("KV 未绑给指引页",
  (await (await worker.fetch(req("/"), {})).text()).includes("KV Not Bound"));

// ---- 首次初始化 ----
reset();
t("没设密码时 / 出初始化页",
  (await (await worker.fetch(req("/"), env)).text()).includes("First Run"));
t("没设密码时其他路径 404",
  (await worker.fetch(req("/api/state"), env)).status === 404);
t("密码太短被拒",
  (await worker.fetch(post("/api/setup", { password: "short", confirm: "short" }), env)).status === 400);
t("两次不一致被拒",
  (await worker.fetch(post("/api/setup", { password: "longenough1", confirm: "other" }), env)).status === 400);

const setup = await worker.fetch(post("/api/setup", { password: PW, confirm: PW }), env);
const setc = setup.headers.get("set-cookie") || "";
t("设置密码成功", setup.status === 200);
t("直接下发会话 cookie", setc.includes("om_session="));
t("cookie 带 HttpOnly", setc.includes("HttpOnly"));
t("cookie 带 Secure", setc.includes("Secure"));
t("cookie 带 SameSite", setc.includes("SameSite"));
t("cookie 不含密码明文", !setc.includes(PW));
t("KV 里不存密码明文", !JSON.stringify([...kv.values()]).includes(PW));
// 已初始化后 /api/setup 走未登录分支返回 404 —— 不泄露"已初始化"这个事实
t("已初始化后 /api/setup 不可用",
  (await worker.fetch(post("/api/setup", { password: "another123", confirm: "another123" }), env)).status === 404);

// 真正的竞态：两个请求同时读到 cred 为空
{
  const k2 = new Map();
  const e2 = { KV: {
    async get(k, t) { const v = k2.get(k); return t === "json" && v ? JSON.parse(v) : v ?? null; },
    async put(k, v) { k2.set(k, v); },
    async delete(k) { k2.delete(k); } } };
  const [a, b] = await Promise.all([
    worker.fetch(post("/api/setup", { password: "racer-aaa1", confirm: "racer-aaa1" }), e2),
    worker.fetch(post("/api/setup", { password: "racer-bbb1", confirm: "racer-bbb1" }), e2),
  ]);
  const codes = [a.status, b.status].sort();
  t(`并发初始化只成功一个 (${codes.join("/")})`, codes[0] === 200 && codes[1] === 409);
}

const cookie = setc.split(";")[0];
const auth = { cookie };

// ---- 已初始化后的鉴权 ----
t("设完密码后 / 出状态页",
  (await (await worker.fetch(req("/", { headers: auth }), env)).text()).includes("Opera over MASQUE"));
t("退出后 / 出登录页",
  (await (await worker.fetch(req("/"), env)).text()).includes("Auth Required"));
t("未登录 /api/state 404",
  (await worker.fetch(req("/api/state"), env)).status === 404);
t("错密码登录 401",
  (await worker.fetch(post("/login", { password: "nope" }), env)).status === 401);
t("对密码登录 200",
  (await worker.fetch(post("/login", { password: PW }), env)).status === 200);

// ---- 订阅 ----
// 放一份"还没过期"的配置 + state，访问订阅应直接返回缓存、不触发重建。
// 不设 state 的话 ensureConfig 会判定过期去 rebuild，那要联网注册 WARP/Opera，
// 测试就依赖真实 API 了——这条测的是订阅投递，不是重建。
kv.set("config:yaml", "# fake\nproxies: []");
kv.set("state:meta", JSON.stringify({
  updatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
  stats: {}, warp: {},
}));
const home = await (await worker.fetch(req("/", { headers: auth }), env)).text();
const tok = (home.match(/token=([\w.\-]+)/) || [])[1];
t("状态页给出带 token 的订阅链接", !!tok);

const sub = await worker.fetch(req(`/sub?token=${tok}`), env);
t("默认路径 /sub 带 token 可取", sub.status === 200);
t("订阅是 yaml", (sub.headers.get("content-type") || "").includes("yaml"));
t("订阅带更新间隔头", sub.headers.get("profile-update-interval") === "4");
// 文件名不能带引号：部分客户端不解析，会把 \"x\" 当成文件名显示出来
t("文件名不带引号",
  sub.headers.get("content-disposition") === "attachment; filename=opera-masque.yaml");
t("无 token 取订阅 404", (await worker.fetch(req("/sub"), env)).status === 404);
t("错 token 取订阅 404", (await worker.fetch(req("/sub?token=bad.sig"), env)).status === 404);

// ---- UI 改订阅路径 ----
t("非法路径被拒",
  (await worker.fetch(post("/api/sub-path", { path: "a/b" }, auth), env)).status === 400);
t("保留字被拒",
  (await worker.fetch(post("/api/sub-path", { path: "api" }, auth), env)).status === 400);
t("改路径成功",
  (await worker.fetch(post("/api/sub-path", { path: "my-secret" }, auth), env)).status === 200);
t("新路径生效", (await worker.fetch(req(`/my-secret?token=${tok}`), env)).status === 200);
t("旧路径失效", (await worker.fetch(req(`/sub?token=${tok}`), env)).status === 404);


// ---- UI 改密码 ----
t("当前密码不对时拒绝改",
  (await worker.fetch(post("/api/password",
    { current: "wrong", password: "brandnew123", confirm: "brandnew123" }, auth), env)).status === 401);
t("新密码太短被拒",
  (await worker.fetch(post("/api/password",
    { current: PW, password: "x1", confirm: "x1" }, auth), env)).status === 400);

const chg = await worker.fetch(post("/api/password",
  { current: PW, password: "brandnew123", confirm: "brandnew123" }, auth), env);
t("改密码成功", chg.status === 200);
t("改密码后重新下发 cookie", (chg.headers.get("set-cookie") || "").includes("om_session="));
t("改密码后旧订阅 token 失效",
  (await worker.fetch(req(`/my-secret?token=${tok}`), env)).status === 404);
t("旧密码登不上",
  (await worker.fetch(post("/login", { password: PW }), env)).status === 401);
t("新密码能登上",
  (await worker.fetch(post("/login", { password: "brandnew123" }), env)).status === 200);

// ---- 按需重建：没过期用缓存，过期才重建 ----
{
  reset();
  await worker.fetch(post("/api/setup", { password: PW, confirm: PW }), env);
  const c2 = (await worker.fetch(post("/login", { password: PW }), env))
    .headers.get("set-cookie").split(";")[0];
  const a2 = { cookie: c2 };
  const h2 = await (await worker.fetch(req("/", { headers: a2 }), env)).text();
  const tk = (h2.match(/token=([\w.\-]+)/) || [])[1];

  // 放一份"还没过期"的配置，访问订阅不应触发重建
  kv.set("config:yaml", "# cached\nproxies: []");
  kv.set("state:meta", JSON.stringify({
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
    stats: {}, warp: {},
  }));
  const r1 = await worker.fetch(req(`/sub?token=${tk}`), env);
  t("未过期直接给缓存", (await r1.text()).includes("# cached"));

  // 标记为已过期，此时该重建。这里不真的联网，用锁占住来验证走了重建分支
  kv.set("state:meta", JSON.stringify({
    updatedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    expiresAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    stats: {}, warp: {},
  }));
  kv.set("rebuild:lock", String(Date.now()));   // 假装别人在重建
  const r2 = await worker.fetch(req(`/sub?token=${tk}`), env);
  t("过期但有人在重建时用旧配置顶住", (await r2.text()).includes("# cached"));

  kv.delete("rebuild:lock");
  kv.delete("config:yaml");
  kv.set("state:meta", JSON.stringify({ expiresAt: new Date(Date.now() - 1).toISOString() }));
  kv.set("rebuild:lock", String(Date.now()));
  const r3 = await worker.fetch(req(`/sub?token=${tk}`), env);
  t("过期且无缓存又拿不到锁时给 503", r3.status === 503);
}

// ---- 过期判定 ----
{
  reset();
  await worker.fetch(post("/api/setup", { password: PW, confirm: PW }), env);
  const st = await (await worker.fetch(req("/api/state",
    { headers: { cookie: (await worker.fetch(post("/login", { password: PW }), env))
      .headers.get("set-cookie").split(";")[0] } }), env)).json();
  t("初始无配置时 state 为空", Object.keys(st).length === 0);
}

// ---- Proton 推送 ----
{
  reset();
  await worker.fetch(post("/api/setup", { password: PW, confirm: PW }), env);
  const ck = (await worker.fetch(post("/login", { password: PW }), env))
    .headers.get("set-cookie").split(";")[0];
  const a3 = { cookie: ck };

  const blob = btoa(JSON.stringify({
    v: 1, privateKey: "FAKEKEY", expiresAt: Math.floor(Date.now()/1000) + 604800,
    servers: [{ name: "JP1", cc: "JP", ip: "1.2.3.4", port: 51820, pub: "PUB" }],
  }));
  const raw = (p, body) => new Request(`https://x.dev${p}`, {
    method: "POST", headers: { "cf-connecting-ip": "9.9.9.9" }, body });

  t("没生成令牌时推送 404",
    (await worker.fetch(raw("/push/anything", blob), env)).status === 404);

  const tr = await (await worker.fetch(post("/api/proton/token", {}, a3), env)).json();
  t("能生成推送令牌", tr.ok && tr.token && tr.token.length >= 32);

  t("错令牌推送 404",
    (await worker.fetch(raw("/push/wrongtoken", blob), env)).status === 404);
  t("未登录也不能拿令牌",
    (await worker.fetch(post("/api/proton/token", {}), env)).status === 404);

  const bad = await worker.fetch(raw(`/push/${tr.token}`, "not-base64!!"), env);
  t("坏数据被拒且提示明确", bad.status === 400);

  const expired = btoa(JSON.stringify({
    v: 1, privateKey: "K", expiresAt: Math.floor(Date.now()/1000) - 10,
    servers: [{ name: "x", ip: "1.1.1.1", port: 51820, pub: "P" }] }));
  t("过期凭据被拒",
    (await worker.fetch(raw(`/push/${tr.token}`, expired), env)).status === 400);

  // 正常推送（rebuild 会联网失败，但凭据应已写入）
  const okp = await worker.fetch(raw(`/push/${tr.token}`, blob), env);
  const oj = await okp.json();
  t("正常推送被接受", okp.status === 200 && oj.ok);
  t("凭据已落 KV", !!kv.get("proton:cred"));
  t("KV 里存的是解析后的对象",
    JSON.parse(kv.get("proton:cred")).servers[0].name === "JP1");

  // 换令牌后旧的失效
  const tr2 = await (await worker.fetch(post("/api/proton/token", {}, a3), env)).json();
  t("换令牌后旧令牌失效",
    (await worker.fetch(raw(`/push/${tr.token}`, blob), env)).status === 404);
  t("新令牌可用",
    (await worker.fetch(raw(`/push/${tr2.token}`, blob), env)).status === 200);

  await worker.fetch(post("/api/proton/clear", {}, a3), env);
  t("能清除 Proton 凭据", !kv.get("proton:cred"));
}

// ---- Windscribe ----
{
  reset();
  await worker.fetch(post("/api/setup", { password: PW, confirm: PW }), env);
  const c4 = (await worker.fetch(post("/login", { password: PW }), env))
    .headers.get("set-cookie").split(";")[0];
  const a4 = { cookie: c4 };

  // 首页要查 Windscribe 用量。接口挂了不能把整个管理页带塌
  kv.set("wind:account", JSON.stringify({
    sessionAuthHash: "sah", locHash: "lh", userId: "u1",
  }));
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network down"); };
  const boom = await worker.fetch(req("/", { headers: a4 }), env);
  globalThis.fetch = real;
  t("查用量失败不影响管理页", boom.status === 200);

  // 有用量时按 GB 显示
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: { traffic_used: 536870912, traffic_max: 2147483648, status: 1, loc_hash: "lh" },
  }), { status: 200 });
  kv.set("state:meta", JSON.stringify({
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600e3).toISOString(),
    stats: { wind: 62 }, warp: {}, wind: { userId: "u1", servers: 62 },
  }));
  const okpg = await (await worker.fetch(req("/", { headers: a4 }), env)).text();
  globalThis.fetch = real;
  t("显示用量", okpg.includes("0.50 GB") && okpg.includes("2.00 GB"));
  t("显示账号", okpg.includes("u1"));
  t("显示落地数", okpg.includes("62"));

  // 没账号时不查，也不该报错
  reset();
  await worker.fetch(post("/api/setup", { password: PW, confirm: PW }), env);
  const c5 = (await worker.fetch(post("/login", { password: PW }), env))
    .headers.get("set-cookie").split(";")[0];
  const noacc = await (await worker.fetch(req("/", { headers: { cookie: c5 } }), env)).text();
  t("没账号显示未启用", noacc.includes("未启用"));

  t("清除账号要登录", (await worker.fetch(post("/api/wind/clear", {}), env)).status === 404);
  t("清除账号只认 POST",
    (await worker.fetch(req("/api/wind/clear", { headers: { cookie: c5 } }), env)).status === 404);
}

// ---- Windscribe 账号由流水线推送 ----
{
  reset();
  await worker.fetch(post("/api/setup", { password: PW, confirm: PW }), env);
  const c6 = (await worker.fetch(post("/login", { password: PW }), env))
    .headers.get("set-cookie").split(";")[0];
  const a6 = { cookie: c6 };
  const tk = (await (await worker.fetch(post("/api/proton/token", {}, a6), env)).json()).token;
  const raw = (p, body) => new Request(`https://x.dev${p}`, {
    method: "POST", headers: { "cf-connecting-ip": "9.9.9.9" }, body });

  const good = JSON.stringify({
    userId: "u1", sessionAuthHash: "sah", locHash: "lh",
    status: 1, trafficMax: 2147483648,
  });

  t("错令牌推 wind 是 404",
    (await worker.fetch(raw("/push/wrong/wind", good), env)).status === 404);
  t("坏 JSON 被拒",
    (await worker.fetch(raw(`/push/${tk}/wind`, "{oops"), env)).status === 400);
  t("缺字段被拒",
    (await worker.fetch(raw(`/push/${tk}/wind`, '{"userId":"x"}'), env)).status === 400);

  // 降额账号必须挡住 —— status=2 的号连代理凭据都取不到
  const dud = JSON.stringify({
    userId: "u2", sessionAuthHash: "s", locHash: "l",
    status: 2, trafficMax: 1048576,
  });
  const dr = await worker.fetch(raw(`/push/${tk}/wind`, dud), env);
  t("降额账号被拒", dr.status === 400 && (await dr.json()).error.includes("status=2"));
  t("降额账号没落 KV", !kv.get("wind:account"));

  // 正常账号：rebuild 会联网失败，但账号本身应已写入
  const okr = await worker.fetch(raw(`/push/${tk}/wind`, good), env);
  t("正常账号被接受", okr.status === 200);
  t("账号已落 KV", JSON.parse(kv.get("wind:account") || "{}").userId === "u1");

  // 同一个令牌，不带后缀还是走 Proton
  const blob = btoa(JSON.stringify({
    v: 1, privateKey: "K", expiresAt: Math.floor(Date.now() / 1000) + 604800,
    servers: [{ name: "JP1", ip: "1.1.1.1", port: 51820, pub: "P" }] }));
  await worker.fetch(raw(`/push/${tk}`, blob), env);
  t("同一令牌不带后缀走 Proton", !!kv.get("proton:cred"));
  t("两种凭据互不覆盖", !!kv.get("wind:account") && !!kv.get("proton:cred"));

  // 清除
  await worker.fetch(post("/api/wind/clear", {}, a6), env);
  t("能清除 Windscribe 账号", !kv.get("wind:account"));
  t("清除 wind 不动 Proton", !!kv.get("proton:cred"));
}

// ---- Zero Trust 注册 ----
// JWT 只有 60 秒寿命，注册必须当场用掉。这里 mock 掉 CF API，
// 验证：JWT 走 Cf-Access-Jwt-Assertion 头、非 team 账户被拒、设备落 KV、
// 清除可用、要登录。
{
  reset();
  await worker.fetch(post("/api/setup", { password: PW, confirm: PW }), env);
  const ck = (await worker.fetch(post("/login", { password: PW }), env))
    .headers.get("set-cookie").split(";")[0];
  const az = { cookie: ck };

  // 未登录 enroll 直接 404（不泄露路径存在）
  t("未登录 enroll 是 404",
    (await worker.fetch(post("/api/zt/enroll", { jwt: "x" }), env)).status === 404);
  t("未登录 clear 是 404",
    (await worker.fetch(post("/api/zt/clear", {}), env)).status === 404);

  // 空JWT / 太短的 JWT 被拒
  t("空 JWT 被拒",
    (await worker.fetch(post("/api/zt/enroll", { jwt: "" }, az), env)).status === 400);
  t("太短 JWT 被拒",
    (await worker.fetch(post("/api/zt/enroll", { jwt: "abc" }, az), env)).status === 400);

  // mock CF API。POST /reg 看 JWT 值决定回 team 还是 free：
  // 「好 JWT」回 team（注册成功），别的 JWT 回 free（模拟过期/未生效，
  // registerWarp 必须拒掉，不能把降级号当 ZT 用）。
  // PATCH /reg/<id> 回 MASQUE enroll 结果。
  //
  // Opera 也一起 mock 掉：rebuild 现在会**同时**确保 consumer 免费设备存在
  // （两份设备并存），所以它除了打 CF API 还会打 Opera。Opera 通了 rebuild
  // 才能走完，下面 reset-warp 那条才测得到「真的重注册成功了」。
  const GOOD_JWT = "fake.jwt.team.token.value.long.enough.to.pass.length.check";
  const realFetch = globalThis.fetch;
  // /reg 会被打两次：一次带 JWT 的 ZT 注册、一次不带 JWT 的 consumer 注册。
  // 不能只留最后一个（会被 consumer 那次覆盖成空串），要全记下来。
  const regJwts = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || "GET";
    if (u.includes("api2.sec-tunnel.com")) {
      const path = u.split("/v4/")[1] || "";
      const data = path === "register_device" ? { device_id: "dev-1" }
        : path === "device_generate_password" ? { device_password: "pw" }
        : path === "discover" ? { ips: [{ ip: "77.111.245.1", port: [443] }] }
        : {};
      // status.code=0 才不被 rpc 当错误抛掉
      return new Response(JSON.stringify({ status: { code: 0 }, data }),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("api.cloudflareclient.com") && u.endsWith("/reg") && m === "POST") {
      const h = init.headers?.["Cf-Access-Jwt-Assertion"] || "";
      regJwts.push(h);
      const isTeam = h === GOOD_JWT;
      return new Response(JSON.stringify({
        id: "dev-abc", token: "tok-abc",
        account: { account_type: isTeam ? "team" : "free" },
        config: { interface: { addresses: { v4: "172.16.0.2", v6: "2606:4700:110::2" } } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("api.cloudflareclient.com") && u.includes("/reg/dev-abc") && m === "PATCH") {
      return new Response(JSON.stringify({
        config: { peers: [{ public_key: "PEERPUBKEY" }],
                  interface: { addresses: { v4: "172.16.0.2", v6: "2606:4700:110::2" } } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("no mock", { status: 500 });
  };

  // JWT 让 CF 回 free 账户 → 必须被拒（不能把降级号当 ZT 用）
  const bad = await worker.fetch(post("/api/zt/enroll",
    { jwt: "not.a.real.jwt.but.long.enough.to.pass.length.check" }, az), env);
  t("落到 free 账户被拒", bad.status === 500);
  t("错误提示提到 free",
    (await bad.json()).error.includes("free"));
  t("没落 KV", !kv.get("zt:device"));

  // 正常 team 注册。JWT 走头生效，设备落 KV。
  // rebuild 会因 Opera 没 mock 而失败，但 enroll 本身该成功。
  const good = await worker.fetch(post("/api/zt/enroll",
    { jwt: GOOD_JWT }, az), env);
  const gj = await good.json();
  t("team 注册返回 ok", good.status === 200 && gj.ok);
  t("JWT 走了 Cf-Access-Jwt-Assertion 头", regJwts.includes(GOOD_JWT));
  // 只有 ZT 那一次带 GOOD_JWT。consumer 免费设备是独立账号，注册时绝不能
  // 带团队 JWT，否则免费设备也注册到团队下，两族就串了。
  t("consumer 注册不带 JWT（只有 ZT 那次带）",
    regJwts.filter((h) => h === GOOD_JWT).length === 1 &&
    regJwts.filter((h) => !h).length >= 1);
  t("ZT 设备已落 KV", !!kv.get("zt:device"));
  // 关键：ZT 注册不该把 consumer 那份挤掉，两份必须并存 ——
  // 这正是「只能用一个（只能用 zt 的）」那个 bug 的防线。
  t("consumer WARP 设备也在 KV 里（两份并存）", !!kv.get("warp:device"));
  const dev = JSON.parse(kv.get("zt:device"));
  t("设备标记 zeroTrust=true", dev.zeroTrust === true);
  t("设备 accountType 是 team", dev.accountType === "team");
  t("设备有 deviceId", dev.deviceId === "dev-abc");
  t("设备有 MASQUE 私钥", !!dev.privateKey);
  t("设备有内网地址", dev.ipv4 === "172.16.0.2");
  t("consumer 设备没被标成 zeroTrust",
    JSON.parse(kv.get("warp:device")).zeroTrust === false);

  // 状态页要能同时看到两份设备，否则用户没法判断哪一族还在
  const st = await (await worker.fetch(req("/api/state", { headers: az }), env)).json();
  t("state 同时上报两份设备", !!st.warp && !!st.zt);
  t("state.zt 是 team 设备", st.zt.accountType === "team");
  t("state 标记 ZT 已启用", st.zeroTrust === true);
  t(`state 统计免费边缘 ${st.stats.freeEdges} + 团队边缘 ${st.stats.teamEdges}`,
    st.stats.freeEdges === 57 && st.stats.teamEdges === 4);
  t(`state 接入点总数 ${st.stats.entries}`, st.stats.entries === 61);

  // 清除只摘团队边缘那一族，免费 WARP 那份不能跟着掉
  const clr = await worker.fetch(post("/api/zt/clear", {}, az), env);
  t("清除 ZT 返回 ok", clr.status === 200 && (await clr.json()).ok);
  t("清除后 KV 无 ZT 设备", !kv.get("zt:device"));
  t("清除 ZT 不动免费 WARP 设备", !!kv.get("warp:device"));

  // reset-warp：两份设备并存之后不再需要「先清 ZT」，它只重注册免费那份
  kv.set("zt:device", JSON.stringify({ ...dev }));
  const rw = await worker.fetch(post("/api/reset-warp", {}, az), env);
  const rwj = await rw.json();
  t("ZT 在时 reset-warp 照样能用", rw.status === 200 && rwj.ok);
  t("reset-warp 只动免费那份，ZT 设备原样保留",
    !!kv.get("zt:device") &&
    JSON.parse(kv.get("zt:device")).deviceId === "dev-abc");

  // 状态页要能把「两族并存」讲清楚，否则用户还是会以为只能用一个
  const uiRes = await worker.fetch(req("/", { headers: az }), env);
  const ui = await uiRes.text();
  t("状态页渲染成功", uiRes.status === 200 && ui.includes("OPERA // MASQUE"));
  t("状态页显示两份设备", ui.includes("免费 WARP 设备") && ui.includes("ZT 团队设备"));
  t("状态页说明两族并存", ui.includes("两份设备并存") && ui.includes("并存，不是二选一"));
  t("状态页列出免费边缘节点数", ui.includes("免费边缘节点"));

  globalThis.fetch = realFetch;
}

// ---- Zero Trust 设备由流水线推送 ----
// 和 Proton/Windscribe 共用推送地址，末尾加 /zt。
{
  reset();
  await worker.fetch(post("/api/setup", { password: PW, confirm: PW }), env);
  const ck = (await worker.fetch(post("/login", { password: PW }), env))
    .headers.get("set-cookie").split(";")[0];
  const az2 = { cookie: ck };
  const tk = (await (await worker.fetch(post("/api/proton/token", {}, az2), env)).json()).token;
  const raw = (p, body) => new Request(`https://x.dev${p}`, {
    method: "POST", headers: { "cf-connecting-ip": "9.9.9.9" }, body });

  const blob = btoa(JSON.stringify({
    v: 1, deviceId: "dev-from-actions",
    privateKey: "SEC1KEY", peerPublicKey: "PEERPUB",
    ipv4: "172.16.0.9", ipv6: "2606:4700:110::9",
    zeroTrust: true, accountType: "team",
    registeredAt: new Date().toISOString(),
  }));

  t("错令牌推 zt 是 404",
    (await worker.fetch(raw("/push/wrong/zt", blob), env)).status === 404);
  t("坏 base64 被拒",
    (await worker.fetch(raw(`/push/${tk}/zt`, "not-base64!!"), env)).status === 400);
  t("缺 privateKey 被拒",
    (await worker.fetch(raw(`/push/${tk}/zt`,
      btoa(JSON.stringify({ v: 1, ipv4: "1.1.1.1" }))), env)).status === 400);
  t("错版本被拒",
    (await worker.fetch(raw(`/push/${tk}/zt`,
      btoa(JSON.stringify({ v: 2, privateKey: "k", ipv4: "1.1.1.1" }))), env)).status === 400);

  // 正常推送（rebuild 联网失败不影响设备写入）
  const okr = await worker.fetch(raw(`/push/${tk}/zt`, blob), env);
  t("正常 ZT 推送被接受", okr.status === 200);
  t("ZT 设备已落 KV", !!kv.get("zt:device"));
  const d = JSON.parse(kv.get("zt:device"));
  t("设备 deviceId 正确", d.deviceId === "dev-from-actions");
  t("强制标记 zeroTrust", d.zeroTrust === true);
  t("推过来的设备不影响 Proton",
    !kv.get("proton:cred") && !kv.get("wind:account"));

  // 同一令牌不带后缀走 Proton，/zt 走 ZT，互不干扰
  const pblob = btoa(JSON.stringify({
    v: 1, privateKey: "K", expiresAt: Math.floor(Date.now()/1000)+604800,
    servers: [{ name: "JP1", ip: "1.1.1.1", port: 51820, pub: "P" }] }));
  await worker.fetch(raw(`/push/${tk}`, pblob), env);
  t("同一令牌不带后缀走 Proton", !!kv.get("proton:cred"));
  t("两种凭据互不覆盖", !!kv.get("zt:device") && !!kv.get("proton:cred"));
}

console.log(`\n通过 ${pass} 失败 ${fail}`);
if (fail) process.exit(1);
