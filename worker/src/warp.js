// Cloudflare WARP 注册 + MASQUE 公钥 enroll。
// 全程 fetch + WebCrypto，Workers 原生能跑。
const API = "https://api.cloudflareclient.com/v0a4471";
const H = {
  "User-Agent": "WARP for Android",
  "CF-Client-Version": "a-6.35-4471",
  "Content-Type": "application/json; charset=UTF-8",
};

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

function randB64(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a));
}

function randHex(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// CF 要 "2006-01-02T15:04:05.000-07:00" 这个格式
function cfTime() {
  return new Date().toISOString().replace("Z", "+00:00");
}

/** 注册一台新 WARP 设备并把 MASQUE 公钥挂上去。
 *
 * consumerMode=false 时走 Zero Trust：调用方要传一个刚从
 * https://<team>.cloudflareaccess.com/warp 拿到的 JWT（只有 60 秒寿命），
 * 通过 Cf-Access-Jwt-Assertion 头生效。注册成功后返回的 account.account_type
 * 会带 "team" 字样；不是 team 的话说明 JWT 没生效或已过期，直接报错。
 */
export async function registerWarp(deviceName = "cf-worker", jwt = "") {
  const headers = { ...H };
  if (jwt) headers["Cf-Access-Jwt-Assertion"] = jwt;

  const reg = await fetch(`${API}/reg`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      key: randB64(32),
      install_id: "",
      fcm_token: "",
      tos: cfTime(),
      model: "PC",
      serial_number: randHex(8),
      os_version: "",
      key_type: "curve25519",
      tunnel_type: "wireguard",
      locale: "en-US",
    }),
  });
  if (!reg.ok) {
    throw new Error(`WARP 注册失败 ${reg.status}: ${(await reg.text()).slice(0, 200)}`);
  }
  const acc = await reg.json();

  // Zero Trust 注册要校验：JWT 没生效会落到 free 账户上，那种号用不了
  // 团队边缘（162.159.197.x）。account_type 带 "team" 才算成功。
  if (jwt) {
    const t = (acc.account?.account_type || "").toLowerCase();
    if (!t.includes("team")) {
      throw new Error(
        "JWT 没生效：注册到的是 free 账户而不是 Zero Trust。" +
        "多半是 token 已过 60 秒有效期，回管理页重新拿一个立刻提交。");
    }
  }

  // MASQUE 用 P-256，和 WireGuard 那套密钥不通用
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const spki = b64(await crypto.subtle.exportKey("spki", kp.publicKey));
  const pkcs8 = b64(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  // mihomo 要 SEC1，WebCrypto 只给 PKCS8，得转一道
  const sec1 = pkcs8ToSec1(pkcs8);

  const patch = await fetch(`${API}/reg/${acc.id}`, {
    method: "PATCH",
    headers: { ...H, Authorization: `Bearer ${acc.token}` },
    body: JSON.stringify({
      key: spki,
      key_type: "secp256r1",
      tunnel_type: "masque",
      name: deviceName,
    }),
  });
  if (!patch.ok) {
    throw new Error(`MASQUE enroll 失败 ${patch.status}: ${(await patch.text()).slice(0, 200)}`);
  }
  const up = await patch.json();

  // peer 公钥回来是 PEM，mihomo 要剥掉头尾的裸 base64
  const pem = up.config?.peers?.[0]?.public_key || "";
  const peerPub = pem.includes("-----")
    ? pem.split("\n").filter((l) => l && !l.startsWith("-----")).join("")
    : pem;

  return {
    deviceId: acc.id,
    token: acc.token,
    privateKey: sec1,
    peerPublicKey: peerPub,
    ipv4: up.config?.interface?.addresses?.v4 || acc.config?.interface?.addresses?.v4,
    ipv6: up.config?.interface?.addresses?.v6 || acc.config?.interface?.addresses?.v6,
    registeredAt: new Date().toISOString(),
    // consumer=false / Zero Trust=true。config.js 据此决定是否启用团队边缘
    zeroTrust: !!jwt,
    accountType: acc.account?.account_type || "",
  };
}

/** 向 CF 校验这台设备**还在不在**。
 *
 * 判据是 `GET /reg/{id}` + device token。设备被删掉、被吊销、账号失效时
 * 会拿到 401/404 —— 这就是「整族节点全死」最常见的成因：设备凭据进了
 * KV 之后，CF 那边因为长期不用 / 触发风控把它清了，而客户端还在拿旧
 * 密钥去握手，边缘直接回 `CRYPTO_ERROR 0x131 (remote): tls: access denied`
 * （见 mihomo transport/masque/masque.go 的 ConnectTunnel 错误分支）。
 *
 * 返回 { ok } 三态：
 *   true  设备在，且能看到 config
 *   false CF 明确说它没了（401/404）或返回别的错
 *   null  没法校验（流水线推来的设备不带 token，只有 usque 那份 config）
 */
export async function verifyDevice(dev) {
  if (!dev || !dev.deviceId) return { ok: null, error: "没有 deviceId，无法校验" };
  if (!dev.token) {
    return { ok: null,
      error: "设备是流水线推来的（不带 device token），CF 侧无法校验。" +
             "要能校验就用管理页「Zero Trust」区块粘一份新 JWT 重新注册一次。" };
  }
  let r;
  try {
    r = await fetch(`${API}/reg/${dev.deviceId}`, {
      headers: { ...H, Authorization: `Bearer ${dev.token}` },
    });
  } catch (e) {
    return { ok: null, error: `请求 CF 失败：${e.message}` };
  }
  if (!r.ok) {
    const txt = (await r.text().catch(() => "")).slice(0, 120);
    return {
      ok: false, status: r.status,
      error: r.status === 401 || r.status === 404
        ? `设备已被 CF 删除或吊销（HTTP ${r.status}）—— 这一族的节点会全部连不上`
        : `CF 返回 HTTP ${r.status}${txt ? "：" + txt : ""}`,
    };
  }
  let j = {};
  try { j = await r.json(); } catch { /* 空响应也算活着 */ }
  const acct = j.account?.account_type || dev.accountType || "";
  return {
    ok: true, status: 200,
    accountType: acct,
    zeroTrust: String(acct).toLowerCase().includes("team"),
    // 有 peers 才是可用的 MASQUE 配置。拿不到就当「未知」，别误判成坏
    hasMasqueKey: Array.isArray(j.config?.peers) ? j.config.peers.length > 0 : null,
  };
}


/** 授权码归一化。CF 要的格式是 XXXXXXXX-XXXXXXXXX-XXXXXXXXXX（三段、短横线）。
 *
 * 用户从 1.1.1.1 App 的 Account > Key 里复制，实际粘进来的东西五花八门：
 * 带尖括号（官方 Linux 文档里那个占位符就带）、带空格、带换行、首尾引号。
 * 全部剥掉再校验，能救回一大半「明明复制对了却报格式错」。
 */
export function normalizeLicense(raw) {
  const k = String(raw || "").replace(/[\s<>"']/g, "");
  if (!k) return { ok: false, error: "授权码是空的" };
  if (!/^[0-9a-zA-Z]{4,16}(-[0-9a-zA-Z]{4,16}){2}$/.test(k)) {
    return { ok: false,
      error: `这串不像 WARP+ 授权码（应该是 XXXXXXXX-XXXXXXXXX-XXXXXXXXXX 三段式）：${k.slice(0, 40)}` };
  }
  return { ok: true, key: k };
}

/** 读这台设备的账号状态。
 *
 * `GET /reg/{id}/account` 回 { license, warp_plus, premium_data, quota, ... }：
 *   warp_plus: true      已经吃到 WARP+（走 Argo 智能选路）
 *   premium_data/quota   剩余可用额度（字节）。0 通常表示不限量
 * 注意：官方应用里买的授权码是**按账号**的，一台设备 = 一个账号。
 */
export async function getAccount(dev) {
  if (!dev || !dev.deviceId) return { ok: null, error: "没有 deviceId" };
  if (!dev.token) return { ok: null, error: "这台设备没有 device token，读不了账号状态" };
  let r;
  try {
    r = await fetch(`${API}/reg/${dev.deviceId}/account`, {
      headers: { ...H, Authorization: `Bearer ${dev.token}` },
    });
  } catch (e) {
    return { ok: null, error: `请求 CF 失败：${e.message}` };
  }
  if (!r.ok) {
    return { ok: null, status: r.status,
      error: `CF 返回 HTTP ${r.status}：${(await r.text().catch(() => "")).slice(0, 120)}` };
  }
  let j = {};
  try { j = await r.json(); } catch { /* 空响应 */ }
  return {
    ok: true,
    warpPlus: !!j.warp_plus,
    license: j.license || "",
    premiumData: Number(j.premium_data || 0),
    quota: Number(j.quota || 0),
    accountType: j.account_type || "",
    role: j.role || "",
  };
}

/** 把 WARP+ 授权码绑到这台设备所在的账号上。
 *
 * `PUT /reg/{id}/account` + `{"license": "<key>"}`。成功后账号的
 * account_type 会从 free 变成 warp_plus 一类，流量改走 Cloudflare 的
 * Argo 智能选路 —— 这是**单流速度**上最大的一根杠杆：免费版走的是
 * 共享的普通出口，容易被链路 QoS 和出口拥塞拖住；WARP+ 走 CF 的优质骨干。
 *
 * 两个必须告诉用户的坑（都在返回值里带上）：
 *  1. 只有「从官方 1.1.1.1 App 里买的」授权码有效。推荐/活动拿到的
 *     一律无效，CF 会直接拒。
 *  2. CF 侧有个老 bug：**已经连过 WARP 的账号**绑了授权码也可能不生效
 *     （warp_plus 仍是 false）。解法是「新注册一台设备、在它连任何一次
 *     之前就把授权码绑上」—— 所以调用方拿到 ok:true 但 warpPlus:false 时，
 *     要提示用户改用「换新设备再绑定」那条路。
 */
export async function bindLicense(dev, rawKey) {
  if (!dev || !dev.deviceId) throw new Error("没有设备可绑定，先注册一台");
  if (!dev.token) {
    throw new Error("这台设备没有 device token（多半是流水线推来的 ZT 设备），" +
                    "绑不了授权码。免费设备才有 token。");
  }
  const nz = normalizeLicense(rawKey);
  if (!nz.ok) throw new Error(nz.error);

  const r = await fetch(`${API}/reg/${dev.deviceId}/account`, {
    method: "PUT",
    headers: { ...H, Authorization: `Bearer ${dev.token}` },
    body: JSON.stringify({ license: nz.key }),
  });
  const txt = await r.text();
  if (!r.ok) {
    // CF 常见的两种拒绝：授权码已被别的账号占用、授权码无效。
    // 原文比任何转述都准，直接透出去。
    const hint = /already|in use|used/i.test(txt)
      ? "。这个码已经绑在别的账号上了 —— 先在 1.1.1.1 App 里把其他设备解绑再试。"
      : "";
    throw new Error(`CF 拒绝了这个授权码（HTTP ${r.status}）：${txt.slice(0, 200)}${hint}`);
  }
  let j = {};
  try { j = JSON.parse(txt); } catch { /* 空响应 */ }
  return {
    ok: true,
    warpPlus: !!j.warp_plus,
    license: j.license || nz.key,
    premiumData: Number(j.premium_data || 0),
    quota: Number(j.quota || 0),
    accountType: j.account_type || "",
  };
}

/** 给已存在的设备**重新装一把 MASQUE 密钥**，返回更新后的设备对象。
 *
 * 用在「设备在 CF 那边还活着，但本地这把密钥认证不过」的情况。成因有两种：
 *  1. KV 里那份私钥在写入/读取环节被弄坏（截断、换行、编码）；
 *  2. 同一台设备被别处重新 enroll 过，旧密钥在 CF 侧已经作废。
 * 两种表现完全一样：整族节点全死，边缘回 tls: access denied。
 * 重注册会丢掉 deviceId（换新设备），重装密钥不会 —— 所以先用这个。
 */
export async function reenrollMasque(dev, deviceName = "cf-worker") {
  if (!dev || !dev.deviceId || !dev.token) {
    throw new Error("这台设备没有 deviceId / token，没法重装密钥，只能重新注册");
  }
  // 每台设备每次重装都生成新密钥对，不复用旧的
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const spki = b64(await crypto.subtle.exportKey("spki", kp.publicKey));
  const pkcs8 = b64(await crypto.subtle.exportKey("pkcs8", kp.privateKey));

  const r = await fetch(`${API}/reg/${dev.deviceId}`, {
    method: "PATCH",
    headers: { ...H, Authorization: `Bearer ${dev.token}` },
    body: JSON.stringify({
      key: spki, key_type: "secp256r1", tunnel_type: "masque", name: deviceName,
    }),
  });
  if (!r.ok) {
    throw new Error(`重装密钥失败 ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  const up = await r.json();
  const pem = up.config?.peers?.[0]?.public_key || dev.peerPublicKey || "";
  const peerPub = pem.includes("-----")
    ? pem.split("\n").filter((l) => l && !l.startsWith("-----")).join("")
    : pem;

  return {
    ...dev,
    privateKey: pkcs8ToSec1(pkcs8),
    peerPublicKey: peerPub,
    ipv4: up.config?.interface?.addresses?.v4 || dev.ipv4,
    ipv6: up.config?.interface?.addresses?.v6 || dev.ipv6,
    rekeyedAt: new Date().toISOString(),
  };
}

/** PKCS8 -> SEC1(RFC 5915)，带 P-256 曲线参数。
 *
 * WebCrypto 只能导出 PKCS8，mihomo 要 SEC1，直接喂会报
 * "use ParsePKCS8PrivateKey instead"。
 *
 * 但只把 PKCS8 里那段 OCTET STRING 抠出来还不够：WebCrypto 生成的
 * 内层 SEC1 省略了曲线参数（放在 PKCS8 外层的 AlgorithmIdentifier 里），
 * mihomo 会报 "unknown elliptic curve"。所以要重新编码一份带
 * [0] namedCurve 的完整 SEC1。
 *
 * SEC1 结构:
 *   SEQUENCE {
 *     INTEGER 1
 *     OCTET STRING  privateKey (32 字节)
 *     [0] { OID 1.2.840.10045.3.1.7 }   -- prime256v1
 *     [1] { BIT STRING publicKey }
 *   }
 */
export function pkcs8ToSec1(b64pkcs8) {
  const der = Uint8Array.from(atob(b64pkcs8), (c) => c.charCodeAt(0));

  // 读一个 DER TLV: [tag, 值起始, 值长度, 下一个 TLV 起始]
  const tlv = (pos) => {
    const tag = der[pos];
    let len = der[pos + 1];
    let p = pos + 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let k = 0; k < n; k++) len = (len << 8) | der[p + k];
      p += n;
    }
    return [tag, p, len, p + len];
  };

  let i = tlv(0)[1];            // 进最外层 SEQUENCE
  i = tlv(i)[3];                // 跳过 version
  i = tlv(i)[3];                // 跳过 AlgorithmIdentifier
  const [tag, start, len] = tlv(i);
  if (tag !== 0x04) throw new Error("PKCS8 结构不符合预期");

  // 内层 SEC1，可能已带也可能不带曲线参数
  const inner = der.subarray(start, start + len);
  let j = tlv2(inner, 0)[1];
  j = tlv2(inner, j)[3];                       // 跳过 version
  const [ptag, pstart, plen] = tlv2(inner, j); // privateKey OCTET STRING
  if (ptag !== 0x04) throw new Error("SEC1 结构不符合预期");
  const rawKey = inner.subarray(pstart, pstart + plen);

  // prime256v1 = 1.2.840.10045.3.1.7
  const oid = [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];
  const body = [
    0x02, 0x01, 0x01,                          // version = 1
    0x04, rawKey.length, ...rawKey,            // privateKey
    0xa0, oid.length, ...oid,                  // [0] namedCurve
  ];
  const out = [0x30, ...derLen(body.length), ...body];
  return btoa(String.fromCharCode(...out));
}

function tlv2(buf, pos) {
  const tag = buf[pos];
  let len = buf[pos + 1];
  let p = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let k = 0; k < n; k++) len = (len << 8) | buf[p + k];
    p += n;
  }
  return [tag, p, len, p + len];
}

function derLen(n) {
  if (n < 0x80) return [n];
  if (n < 0x100) return [0x81, n];
  return [0x82, n >> 8, n & 0xff];
}
