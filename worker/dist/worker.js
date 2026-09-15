// Opera VPN over Cloudflare WARP (MASQUE) —— 单文件版\n// 由 src/ 打包而成，网页部署用。改代码请改 src/ 后重新 npm run build。\n// 仓库 https://github.com/byJoey/warp-masque-actions\n

// src/warp.js
var API = "https://api.cloudflareclient.com/v0a4471";
var H = {
  "User-Agent": "WARP for Android",
  "CF-Client-Version": "a-6.35-4471",
  "Content-Type": "application/json; charset=UTF-8"
};
var b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
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
function cfTime() {
  return (/* @__PURE__ */ new Date()).toISOString().replace("Z", "+00:00");
}
async function registerWarp(deviceName = "cf-worker", jwt = "") {
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
      locale: "en-US"
    })
  });
  if (!reg.ok) {
    throw new Error(`WARP \u6CE8\u518C\u5931\u8D25 ${reg.status}: ${(await reg.text()).slice(0, 200)}`);
  }
  const acc = await reg.json();
  if (jwt) {
    const t = (acc.account?.account_type || "").toLowerCase();
    if (!t.includes("team")) {
      throw new Error(
        "JWT \u6CA1\u751F\u6548\uFF1A\u6CE8\u518C\u5230\u7684\u662F free \u8D26\u6237\u800C\u4E0D\u662F Zero Trust\u3002\u591A\u534A\u662F token \u5DF2\u8FC7 60 \u79D2\u6709\u6548\u671F\uFF0C\u56DE\u7BA1\u7406\u9875\u91CD\u65B0\u62FF\u4E00\u4E2A\u7ACB\u523B\u63D0\u4EA4\u3002"
      );
    }
  }
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const spki = b64(await crypto.subtle.exportKey("spki", kp.publicKey));
  const pkcs8 = b64(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const sec1 = pkcs8ToSec1(pkcs8);
  const patch = await fetch(`${API}/reg/${acc.id}`, {
    method: "PATCH",
    headers: { ...H, Authorization: `Bearer ${acc.token}` },
    body: JSON.stringify({
      key: spki,
      key_type: "secp256r1",
      tunnel_type: "masque",
      name: deviceName
    })
  });
  if (!patch.ok) {
    throw new Error(`MASQUE enroll \u5931\u8D25 ${patch.status}: ${(await patch.text()).slice(0, 200)}`);
  }
  const up = await patch.json();
  const pem = up.config?.peers?.[0]?.public_key || "";
  const peerPub = pem.includes("-----") ? pem.split("\n").filter((l) => l && !l.startsWith("-----")).join("") : pem;
  return {
    deviceId: acc.id,
    token: acc.token,
    privateKey: sec1,
    peerPublicKey: peerPub,
    ipv4: up.config?.interface?.addresses?.v4 || acc.config?.interface?.addresses?.v4,
    ipv6: up.config?.interface?.addresses?.v6 || acc.config?.interface?.addresses?.v6,
    registeredAt: (/* @__PURE__ */ new Date()).toISOString(),
    // consumer=false / Zero Trust=true。config.js 据此决定是否启用团队边缘
    zeroTrust: !!jwt,
    accountType: acc.account?.account_type || ""
  };
}
async function verifyDevice(dev) {
  if (!dev || !dev.deviceId) return { ok: null, error: "\u6CA1\u6709 deviceId\uFF0C\u65E0\u6CD5\u6821\u9A8C" };
  if (!dev.token) {
    return {
      ok: null,
      error: "\u8BBE\u5907\u662F\u6D41\u6C34\u7EBF\u63A8\u6765\u7684\uFF08\u4E0D\u5E26 device token\uFF09\uFF0CCF \u4FA7\u65E0\u6CD5\u6821\u9A8C\u3002\u8981\u80FD\u6821\u9A8C\u5C31\u7528\u7BA1\u7406\u9875\u300CZero Trust\u300D\u533A\u5757\u7C98\u4E00\u4EFD\u65B0 JWT \u91CD\u65B0\u6CE8\u518C\u4E00\u6B21\u3002"
    };
  }
  let r;
  try {
    r = await fetch(`${API}/reg/${dev.deviceId}`, {
      headers: { ...H, Authorization: `Bearer ${dev.token}` }
    });
  } catch (e) {
    return { ok: null, error: `\u8BF7\u6C42 CF \u5931\u8D25\uFF1A${e.message}` };
  }
  if (!r.ok) {
    const txt = (await r.text().catch(() => "")).slice(0, 120);
    return {
      ok: false,
      status: r.status,
      error: r.status === 401 || r.status === 404 ? `\u8BBE\u5907\u5DF2\u88AB CF \u5220\u9664\u6216\u540A\u9500\uFF08HTTP ${r.status}\uFF09\u2014\u2014 \u8FD9\u4E00\u65CF\u7684\u8282\u70B9\u4F1A\u5168\u90E8\u8FDE\u4E0D\u4E0A` : `CF \u8FD4\u56DE HTTP ${r.status}${txt ? "\uFF1A" + txt : ""}`
    };
  }
  let j = {};
  try {
    j = await r.json();
  } catch {
  }
  const acct = j.account?.account_type || dev.accountType || "";
  return {
    ok: true,
    status: 200,
    accountType: acct,
    zeroTrust: String(acct).toLowerCase().includes("team"),
    // 有 peers 才是可用的 MASQUE 配置。拿不到就当「未知」，别误判成坏
    hasMasqueKey: Array.isArray(j.config?.peers) ? j.config.peers.length > 0 : null
  };
}
async function reenrollMasque(dev, deviceName = "cf-worker") {
  if (!dev || !dev.deviceId || !dev.token) {
    throw new Error("\u8FD9\u53F0\u8BBE\u5907\u6CA1\u6709 deviceId / token\uFF0C\u6CA1\u6CD5\u91CD\u88C5\u5BC6\u94A5\uFF0C\u53EA\u80FD\u91CD\u65B0\u6CE8\u518C");
  }
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const spki = b64(await crypto.subtle.exportKey("spki", kp.publicKey));
  const pkcs8 = b64(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const r = await fetch(`${API}/reg/${dev.deviceId}`, {
    method: "PATCH",
    headers: { ...H, Authorization: `Bearer ${dev.token}` },
    body: JSON.stringify({
      key: spki,
      key_type: "secp256r1",
      tunnel_type: "masque",
      name: deviceName
    })
  });
  if (!r.ok) {
    throw new Error(`\u91CD\u88C5\u5BC6\u94A5\u5931\u8D25 ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  const up = await r.json();
  const pem = up.config?.peers?.[0]?.public_key || dev.peerPublicKey || "";
  const peerPub = pem.includes("-----") ? pem.split("\n").filter((l) => l && !l.startsWith("-----")).join("") : pem;
  return {
    ...dev,
    privateKey: pkcs8ToSec1(pkcs8),
    peerPublicKey: peerPub,
    ipv4: up.config?.interface?.addresses?.v4 || dev.ipv4,
    ipv6: up.config?.interface?.addresses?.v6 || dev.ipv6,
    rekeyedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function pkcs8ToSec1(b64pkcs8) {
  const der = Uint8Array.from(atob(b64pkcs8), (c) => c.charCodeAt(0));
  const tlv = (pos) => {
    const tag2 = der[pos];
    let len2 = der[pos + 1];
    let p2 = pos + 2;
    if (len2 & 128) {
      const n = len2 & 127;
      len2 = 0;
      for (let k = 0; k < n; k++) len2 = len2 << 8 | der[p2 + k];
      p2 += n;
    }
    return [tag2, p2, len2, p2 + len2];
  };
  let i = tlv(0)[1];
  i = tlv(i)[3];
  i = tlv(i)[3];
  const [tag, start, len] = tlv(i);
  if (tag !== 4) throw new Error("PKCS8 \u7ED3\u6784\u4E0D\u7B26\u5408\u9884\u671F");
  const inner = der.subarray(start, start + len);
  let j = tlv2(inner, 0)[1];
  j = tlv2(inner, j)[3];
  const [ptag, pstart, plen] = tlv2(inner, j);
  if (ptag !== 4) throw new Error("SEC1 \u7ED3\u6784\u4E0D\u7B26\u5408\u9884\u671F");
  const rawKey = inner.subarray(pstart, pstart + plen);
  const oid = [6, 8, 42, 134, 72, 206, 61, 3, 1, 7];
  const body = [
    2,
    1,
    1,
    // version = 1
    4,
    rawKey.length,
    ...rawKey,
    // privateKey
    160,
    oid.length,
    ...oid
    // [0] namedCurve
  ];
  const out = [48, ...derLen(body.length), ...body];
  return btoa(String.fromCharCode(...out));
}
function tlv2(buf, pos) {
  const tag = buf[pos];
  let len = buf[pos + 1];
  let p2 = pos + 2;
  if (len & 128) {
    const n = len & 127;
    len = 0;
    for (let k = 0; k < n; k++) len = len << 8 | buf[p2 + k];
    p2 += n;
  }
  return [tag, p2, len, p2 + len];
}
function derLen(n) {
  if (n < 128) return [n];
  if (n < 256) return [129, n];
  return [130, n >> 8, n & 255];
}

// src/md5.js
function md5Hex(str) {
  const msg = new TextEncoder().encode(str);
  const S = [
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21
  ];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  const len = msg.length;
  const withOne = len + 1;
  const padLen = withOne + 8 + 63 & ~63;
  const buf = new Uint8Array(padLen);
  buf.set(msg);
  buf[len] = 128;
  const dv = new DataView(buf.buffer);
  dv.setUint32(padLen - 8, len << 3 >>> 0, true);
  dv.setUint32(padLen - 4, Math.floor(len / 536870912), true);
  let a0 = 1732584193, b0 = 4023233417, c0 = 2562383102, d0 = 271733878;
  const rol = (x, c) => x << c | x >>> 32 - c;
  for (let off = 0; off < padLen; off += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) {
        F = B & C | ~B & D;
        g = i;
      } else if (i < 32) {
        F = D & B | ~D & C;
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = 7 * i % 16;
      }
      F = F + A + K[i] + M[g] >>> 0;
      A = D;
      D = C;
      C = B;
      B = B + rol(F, S[i]) >>> 0;
    }
    a0 = a0 + A >>> 0;
    b0 = b0 + B >>> 0;
    c0 = c0 + C >>> 0;
    d0 = d0 + D >>> 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true);
  odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true);
  odv.setUint32(12, d0, true);
  return [...out].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// src/opera.js
var EP = "https://api2.sec-tunnel.com/v4";
var API_USER = "se0316";
var API_PASS = "SILrMEPBmJuhomxWkfm3JalqHX2Eheg1YhlEZiMh8II";
var CLIENT_TYPE = "se0316";
var H2 = {
  "SE-Client-Version": "Stable 114.0.5282.21",
  "SE-Operating-System": "Windows",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 OPR/114.0.0.0",
  "Content-Type": "application/x-www-form-urlencoded",
  "Accept": "application/json"
};
var REGIONS = { AS: "\u4E9A\u6D32", EU: "\u6B27\u6D32", AM: "\u7F8E\u6D32" };
async function digestHash(algo, s) {
  if (/^md5$/i.test(algo)) return md5Hex(s);
  const name = /512/.test(algo) ? "SHA-512" : "SHA-256";
  const d = await crypto.subtle.digest(name, new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha1Upper(s) {
  const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function randHex2(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}
var Session = class {
  constructor() {
    this.jar = "";
  }
  _absorb(r) {
    const sc = r.headers.getSetCookie?.() || [];
    if (sc.length) this.jar = sc.map((c) => c.split(";")[0]).join("; ");
  }
  async rpc(path, params) {
    const url = `${EP}/${path}`;
    const body = new URLSearchParams(params).toString();
    const base = () => ({ ...H2, ...this.jar ? { Cookie: this.jar } : {} });
    let r = await fetch(url, { method: "POST", headers: base(), body });
    if (r.status === 401) {
      const wa = r.headers.get("www-authenticate") || "";
      const g = (k) => (wa.match(new RegExp(`${k}="([^"]*)"`)) || [])[1] || "";
      const realm = g("realm"), nonce = g("nonce"), qop = g("qop"), opaque = g("opaque");
      const algo = g("algorithm") || (wa.match(/algorithm=([\w-]+)/) || [])[1] || "MD5";
      const uri = new URL(url).pathname;
      const cnonce = randHex2(8), nc = "00000001";
      const H1 = await digestHash(algo, `${API_USER}:${realm}:${API_PASS}`);
      const H22 = await digestHash(algo, `POST:${uri}`);
      const q2 = qop ? qop.split(",")[0].trim() : "";
      const resp = q2 ? await digestHash(algo, `${H1}:${nonce}:${nc}:${cnonce}:${q2}:${H22}`) : await digestHash(algo, `${H1}:${nonce}:${H22}`);
      let a = `Digest username="${API_USER}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${resp}", algorithm=${algo}`;
      if (q2) a += `, qop=${q2}, nc=${nc}, cnonce="${cnonce}"`;
      if (opaque) a += `, opaque="${opaque}"`;
      this._absorb(r);
      r = await fetch(url, {
        method: "POST",
        headers: { ...base(), Authorization: a },
        body
      });
    }
    this._absorb(r);
    if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
    const j = await r.json();
    if (j.status && j.status.code !== 0) {
      throw new Error(`${path} code=${j.status.code} ${j.status.message || ""}`);
    }
    return j;
  }
};
async function fetchOpera() {
  const s = new Session();
  const email = `${randHex2(10)}@${CLIENT_TYPE}.best.vpn`;
  await s.rpc("register_subscriber", { email, password: await sha1Upper(email) });
  const dev = await s.rpc("register_device", {
    client_type: CLIENT_TYPE,
    device_hash: randHex2(20).toUpperCase(),
    device_name: "Opera-Browser-Client"
  });
  const deviceId = dev.data.device_id;
  const idHash = await sha1Upper(deviceId);
  const gp = await s.rpc("device_generate_password", { device_id: deviceId });
  const password = gp.data.device_password;
  const landings = [];
  for (const [code, loc] of Object.entries(REGIONS)) {
    let disc;
    try {
      disc = await s.rpc("discover", { serial_no: idHash, requested_geo: code });
    } catch {
      continue;
    }
    let seq = 0;
    for (const x of disc.data.ips || []) {
      seq += 1;
      landings.push({
        tag: `${loc}${seq}`,
        loc,
        ip: x.ip,
        port: x.port && x.port[0] || 443,
        host: `${code.toLowerCase()}${seq - 1}.sec-tunnel.com`
      });
    }
  }
  return { username: idHash, password, landings, fetchedAt: (/* @__PURE__ */ new Date()).toISOString() };
}

// src/config.js
var V4 = ["162.159.198.1", "162.159.198.2", "162.159.199.1", "162.159.199.2"];
var V6 = [
  "2606:4700:103::1",
  "2606:4700:103::2",
  "2606:4700:104::1",
  "2606:4700:104::2"
];
var PORTS = [443, 500, 1701, 4500, 4443, 8443, 8095];
var PICK_PORTS = [443, 4443, 8443, 8095];
var EXTRA_PORTS = [443, 8095];
var TEAM_V4 = ["162.159.197.1", "162.159.197.2"];
var TEAM_PORTS = [443, 500, 1701, 4500, 4443, 8443, 8095];
var ZT_SNI = "zt-masque.cloudflareclient.com";
var CONSUMER_SNI = "consumer-masque.cloudflareclient.com";
var SNI_NODE = ["162.159.198.1", 443];
var RS = "https://raw.githubusercontent.com";
var RULESETS = [
  ["\u{1F3AF} \u5168\u7403\u76F4\u8FDE", RS + "/cmliu/ACL4SSR/refs/heads/main/Clash/CFnat.list"],
  ["\u{1F3AF} \u5168\u7403\u76F4\u8FDE", RS + "/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list"],
  ["\u{1F3AF} \u5168\u7403\u76F4\u8FDE", RS + "/ACL4SSR/ACL4SSR/master/Clash/UnBan.list"],
  ["\u{1F6D1} \u5168\u7403\u62E6\u622A", RS + "/ACL4SSR/ACL4SSR/master/Clash/BanAD.list"],
  ["\u{1F343} \u5E94\u7528\u51C0\u5316", RS + "/ACL4SSR/ACL4SSR/master/Clash/BanProgramAD.list"],
  ["\u{1F343} \u5E94\u7528\u51C0\u5316", RS + "/cmliu/ACL4SSR/main/Clash/adobe.list"],
  ["\u{1F343} \u5E94\u7528\u51C0\u5316", RS + "/cmliu/ACL4SSR/main/Clash/IDM.list"],
  ["\u{1F4E2} \u8C37\u6B4CFCM", RS + "/ACL4SSR/ACL4SSR/master/Clash/Ruleset/GoogleFCM.list"],
  ["\u{1F3AF} \u5168\u7403\u76F4\u8FDE", RS + "/ACL4SSR/ACL4SSR/master/Clash/GoogleCN.list"],
  ["\u{1F3AF} \u5168\u7403\u76F4\u8FDE", RS + "/ACL4SSR/ACL4SSR/master/Clash/Ruleset/SteamCN.list"],
  ["\u24C2\uFE0F \u5FAE\u8F6F\u670D\u52A1", RS + "/ACL4SSR/ACL4SSR/master/Clash/Microsoft.list"],
  ["\u{1F34E} \u82F9\u679C\u670D\u52A1", RS + "/ACL4SSR/ACL4SSR/master/Clash/Apple.list"],
  ["\u{1F4F2} \u7535\u62A5\u4FE1\u606F", RS + "/ACL4SSR/ACL4SSR/master/Clash/Telegram.list"],
  ["\u{1F916} AI\u670D\u52A1", RS + "/ACL4SSR/ACL4SSR/master/Clash/Ruleset/OpenAi.list"],
  ["\u{1F916} AI\u670D\u52A1", RS + "/juewuy/ShellClash/master/rules/ai.list"],
  ["\u{1F916} AI\u670D\u52A1", RS + "/cmliu/ACL4SSR/main/Clash/Copilot.list"],
  ["\u{1F916} AI\u670D\u52A1", RS + "/cmliu/ACL4SSR/main/Clash/GithubCopilot.list"],
  ["\u{1F916} AI\u670D\u52A1", RS + "/cmliu/ACL4SSR/main/Clash/Claude.list"],
  ["\u{1F916} AI\u670D\u52A1", RS + "/cmliu/ACL4SSR/main/Clash/Gemini.list"],
  ["\u{1F4F9} \u6CB9\u7BA1\u89C6\u9891", RS + "/ACL4SSR/ACL4SSR/master/Clash/Ruleset/YouTube.list"],
  ["\u{1F3A5} \u5948\u98DE\u89C6\u9891", RS + "/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Netflix.list"],
  ["\u{1F30D} \u56FD\u5916\u5A92\u4F53", RS + "/ACL4SSR/ACL4SSR/master/Clash/ProxyMedia.list"],
  ["\u{1F30D} \u56FD\u5916\u5A92\u4F53", RS + "/cmliu/ACL4SSR/main/Clash/Emby.list"],
  ["\u{1F680} \u8282\u70B9\u9009\u62E9", RS + "/ACL4SSR/ACL4SSR/master/Clash/ProxyLite.list"],
  ["\u{1F680} \u8282\u70B9\u9009\u62E9", RS + "/cmliu/ACL4SSR/main/Clash/CMBlog.list"],
  ["\u{1F3AF} \u5168\u7403\u76F4\u8FDE", RS + "/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list"],
  ["\u{1F3AF} \u5168\u7403\u76F4\u8FDE", RS + "/ACL4SSR/ACL4SSR/master/Clash/ChinaCompanyIp.list"]
];
function entryName(ip, port) {
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `v6-${parts[2]}-${parts[parts.length - 1]}-${port}`;
  }
  return `${ip.split(".").slice(2).join(".")}-${port}`;
}
function masqueNode(name, ip, port, priv, pub, v4, v6, sni) {
  const srv = ip.includes(":") ? `"${ip}"` : ip;
  const extra = sni ? `
    sni: ${sni}` : "";
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
function buildEntries(dev, { slot = 1 } = {}) {
  const { privateKey: priv, peerPublicKey: pub, ipv4: v4, ipv6: v6, zeroTrust } = dev;
  const entries = [], v4Entries = [], proxies = [];
  const tag = slot > 1 ? `W${slot}-` : "";
  if (zeroTrust) {
    for (const ip of TEAM_V4) {
      for (const port of TEAM_PORTS) {
        const n = `ZT-${entryName(ip, port)}`;
        entries.push(n);
        v4Entries.push(n);
        proxies.push(masqueNode(n, ip, port, priv, pub, v4, v6, ZT_SNI));
      }
    }
    return {
      entries,
      proxies,
      v4Entries,
      teamEntries: [...entries],
      teamProxies: [...proxies]
    };
  }
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
  if (slot === 1) {
    entries.push("\u5B98\u65B9\u57DF\u540D");
    v4Entries.push("\u5B98\u65B9\u57DF\u540D");
    proxies.push(masqueNode(
      "\u5B98\u65B9\u57DF\u540D",
      SNI_NODE[0],
      SNI_NODE[1],
      priv,
      pub,
      v4,
      v6,
      CONSUMER_SNI
    ));
  }
  return { entries, proxies, v4Entries, teamEntries: [], teamProxies: [] };
}
var AI_DOMAINS = [
  // OpenAI（规则集已有 openai.com/chatgpt.com/sora.com，这几个是补的）
  "openai.fm",
  "operator.chatgpt.com",
  "chat.com",
  // Anthropic
  "anthropic.com",
  "claude.ai",
  "claudeusercontent.com",
  // Google
  "gemini.google.com",
  "aistudio.google.com",
  "generativelanguage.googleapis.com",
  "notebooklm.google.com",
  "notebooklm.google",
  "labs.google",
  "deepmind.com",
  // xAI
  "x.ai",
  "grok.com",
  // Meta
  "meta.ai",
  // Perplexity
  "perplexity.ai",
  "pplx.ai",
  "perplexity.com",
  // Mistral
  "mistral.ai",
  "chat.mistral.ai",
  // Cohere / AI21 / Together / Fireworks / Groq
  "cohere.com",
  "cohere.ai",
  "ai21.com",
  "together.ai",
  "together.xyz",
  "fireworks.ai",
  "groq.com",
  // 开源社区与推理平台
  "huggingface.co",
  "hf.co",
  "huggingface.js.org",
  "replicate.com",
  "replicate.delivery",
  "runpod.io",
  "modal.com",
  "openrouter.ai",
  "poe.com",
  "quora.com",
  // 编程助手
  "cursor.com",
  "cursor.sh",
  "codeium.com",
  "windsurf.com",
  "tabnine.com",
  "sourcegraph.com",
  "phind.com",
  "v0.dev",
  "v0.app",
  "bolt.new",
  "lovable.dev",
  "devin.ai",
  "cognition.ai",
  // 图像与视频
  "midjourney.com",
  "stability.ai",
  "stablediffusionweb.com",
  "leonardo.ai",
  "runwayml.com",
  "pika.art",
  "lumalabs.ai",
  "ideogram.ai",
  "recraft.ai",
  "krea.ai",
  "civitai.com",
  // 语音
  "elevenlabs.io",
  "eleven-labs.com",
  "play.ht",
  "suno.com",
  "suno.ai",
  "udio.com",
  "assemblyai.com",
  "deepgram.com",
  // 搜索与写作
  "you.com",
  "kagi.com",
  "exa.ai",
  "tavily.com",
  "jasper.ai",
  "copy.ai",
  "writesonic.com",
  "notion.so",
  // 观测与工具链
  "langchain.com",
  "langsmith.com",
  "wandb.ai",
  "weightsandbiases.com",
  "pinecone.io",
  "weaviate.io",
  "qdrant.tech",
  "chromadb.com",
  // 国产（默认也走代理，很多在国内反而连不上或要境外号）
  "deepseek.com",
  "moonshot.cn",
  "moonshotai.com",
  "kimi.com",
  "bigmodel.cn",
  "zhipuai.cn",
  "z.ai",
  "minimaxi.com",
  "minimax.io",
  "hailuoai.com",
  "siliconflow.cn",
  "dashscope.aliyuncs.com"
];
var PLAY_DOMAINS = [
  // Google Play 本体 + 下载 CDN。下载 CDN 是最常被漏掉的一环：
  // 商店页面能打开、但装不上 / 更新失败，基本都是 *.gvt1.com / dl.google.com
  // 没走代理，落到国内直连去了。
  "play.google.com",
  "play.googleapis.com",
  "android.clients.google.com",
  "dl.google.com",
  "dl-ssl.google.com",
  "gvt1.com",
  "gvt2.com",
  "gvt3.com",
  "ggpht.com",
  "googleusercontent.com"
];
var WIKI_DOMAINS = [
  "wikipedia.org",
  "wikimedia.org",
  "wikidata.org",
  "wikisource.org",
  "wiktionary.org",
  "wikibooks.org",
  "wikinews.org",
  "wikiversity.org",
  "wikiquote.org",
  "mediawiki.org"
];
var ADULT_DOMAINS = [
  "pornhub.com",
  "pornhubpremium.com",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "redtube.com",
  "youporn.com",
  "spankbang.com",
  "beeg.com",
  "eporner.com",
  "txxx.com",
  "hqporner.com"
];
var STREAM_DOMAINS = [
  // 油管 / 奈飞 / 迪士尼 / 亚马逊 / HBO
  "googlevideo.com",
  "youtube.com",
  "youtu.be",
  "ytimg.com",
  "ggpht.com",
  "netflix.com",
  "nflxvideo.net",
  "nflximg.net",
  "nflxso.net",
  "disneyplus.com",
  "dssott.com",
  "bamgrid.com",
  "primevideo.com",
  "aiv-cdn.net",
  "aiv-delivery.net",
  "hbomax.com",
  "max.com",
  // 音乐 / 直播 / 短视频
  "spotify.com",
  "scdn.co",
  "twitch.tv",
  "ttvnw.net",
  "vimeo.com",
  "vimeocdn.com",
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "ibytedtos.com",
  // 测速站点（Fast/Speedtest 是最好用的「隧道真实吞吐」量尺）
  "fast.com",
  "speedtest.net"
];
var SENSITIVE_ROUTES = [
  ...PLAY_DOMAINS.map((d) => ["DOMAIN-SUFFIX", d, "\u{1F310} \u843D\u5730\u51FA\u53E3"]),
  ...WIKI_DOMAINS.map((d) => ["DOMAIN-SUFFIX", d, "\u{1F310} \u843D\u5730\u51FA\u53E3"]),
  ...ADULT_DOMAINS.map((d) => ["DOMAIN-SUFFIX", d, "\u{1F310} \u843D\u5730\u51FA\u53E3"])
];
var q = (a, n = 6) => a.map((x) => " ".repeat(n) + `- "${x}"`).join("\n");
var p = (a, n = 6) => a.map((x) => " ".repeat(n) + `- ${x}`).join("\n");
function interleave(a, b) {
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}
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
  const head2 = [
    `  - AND,((NETWORK,UDP),(DST-PORT,443),(GEOSITE,cn)),DIRECT`,
    `  - AND,((NETWORK,UDP),(DST-PORT,443)),\u{1F6AB} QUIC`,
    `  - DOMAIN-SUFFIX,speed.cloudflare.com,\u{1F680} \u8282\u70B9\u9009\u62E9`
  ];
  for (const [type, domain, target] of SENSITIVE_ROUTES) {
    head2.push(`  - ${type},${domain},${target}`);
  }
  for (const d of STREAM_DOMAINS) {
    head2.push(`  - DOMAIN-SUFFIX,${d},\u{1F3AC} \u6D41\u5A92\u4F53`);
  }
  const ai = AI_DOMAINS.map((d) => `  - DOMAIN-SUFFIX,${d},\u{1F916} AI\u670D\u52A1`);
  return { prov: prov.join("\n"), rules: [...head2, ...ai, ...rules].join("\n") };
}
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
  # \u8FD9\u91CC\u6545\u610F\u5199\u6B7B false\uFF0C\u4E0D\u8DDF\u9876\u5C42\u7684 ipv6 \u8D70\uFF1A
  # fake-ip \u6A21\u5F0F\u4E0B\u5982\u679C\u8FD8\u56DE\u7B54 AAAA\uFF0C\u5BA2\u6237\u7AEF\u4F1A\u4F18\u5148\u62FF IPv6 \u53BB\u8FDE\u76EE\u6807\uFF0C
  # \u672C\u5730 IPv6 \u51FA\u53E3\u70C2\u7684\u65F6\u5019\u5C31\u662F\u300C\u5EF6\u8FDF\u4E0D\u9AD8\u4F46\u6253\u4E0D\u5F00 / \u7279\u522B\u6162\u300D\u3002
  # \u9876\u5C42 ipv6 \u4FDD\u6301 true\uFF0C\u662F\u4E3A\u4E86\u8BA9 IPv6 \u63A5\u5165\u70B9\u672C\u8EAB\u8FD8\u80FD\u7528\uFF08\u90A3\u662F\u76F4\u8FDE\u5B57\u9762\u5730\u5740\uFF0C\u4E0D\u8D70 DNS\uFF09\u3002
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
    # \u4E0B\u9762\u8FD9\u4E9B\u7ECF\u5E38\u88AB\u5730\u7406\u5E93\u8BEF\u5224\u6210\u300C\u56FD\u5185\u300D\uFF0C\u4E00\u65E6\u5224\u6210\u76F4\u8FDE\u5C31\u76F4\u63A5\u6B7B\u4E86\uFF0C
    # \u663E\u5F0F\u9489\u5230\u5883\u5916 DNS\uFF0C\u7ED5\u5F00\u8BEF\u5224\u3002\u548C\u4E0A\u9762\u7684 inline \u89C4\u5219\u662F\u4E24\u7801\u4E8B\uFF1A
    # \u8FD9\u91CC\u53EA\u7BA1\u89E3\u6790\uFF0C\u8DEF\u7531\u8D70\u54EA\u6761\u770B rules\u3002
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
function tailGroups(picks) {
  return `  - name: \u{1F4F9} \u6CB9\u7BA1\u89C6\u9891
    type: select
    proxies:
      - \u{1F680} \u8282\u70B9\u9009\u62E9
      - \u267B\uFE0F \u81EA\u52A8\u9009\u62E9
      - \u{1F504} \u6545\u969C\u8F6C\u79FB
${p(picks)}

  - name: \u{1F3A5} \u5948\u98DE\u89C6\u9891
    type: select
    proxies:
      - \u{1F680} \u8282\u70B9\u9009\u62E9
      - \u267B\uFE0F \u81EA\u52A8\u9009\u62E9
      - \u{1F504} \u6545\u969C\u8F6C\u79FB
${p(picks)}

  - name: \u{1F30D} \u56FD\u5916\u5A92\u4F53
    type: select
    proxies:
      - \u{1F680} \u8282\u70B9\u9009\u62E9
      - \u267B\uFE0F \u81EA\u52A8\u9009\u62E9
      - \u{1F504} \u6545\u969C\u8F6C\u79FB
      - \u{1F3AF} \u5168\u7403\u76F4\u8FDE

  - name: \u{1F4F2} \u7535\u62A5\u4FE1\u606F
    type: select
    proxies:
      - \u{1F680} \u8282\u70B9\u9009\u62E9
      - \u267B\uFE0F \u81EA\u52A8\u9009\u62E9
      - \u{1F3AF} \u5168\u7403\u76F4\u8FDE

  - name: \u{1F916} AI\u670D\u52A1
    type: select
    proxies:
      - \u{1F310} \u843D\u5730\u51FA\u53E3
      - \u{1F680} \u8282\u70B9\u9009\u62E9
      - \u267B\uFE0F \u81EA\u52A8\u9009\u62E9
      - \u{1F504} \u6545\u969C\u8F6C\u79FB
${p(picks)}

  - name: \u24C2\uFE0F \u5FAE\u8F6F\u670D\u52A1
    type: select
    proxies:
      - \u{1F3AF} \u5168\u7403\u76F4\u8FDE
      - \u{1F680} \u8282\u70B9\u9009\u62E9
      - \u267B\uFE0F \u81EA\u52A8\u9009\u62E9

  - name: \u{1F34E} \u82F9\u679C\u670D\u52A1
    type: select
    proxies:
      - \u{1F3AF} \u5168\u7403\u76F4\u8FDE
      - \u{1F680} \u8282\u70B9\u9009\u62E9
      - \u267B\uFE0F \u81EA\u52A8\u9009\u62E9

  - name: \u{1F4E2} \u8C37\u6B4CFCM
    type: select
    proxies:
      - \u{1F680} \u8282\u70B9\u9009\u62E9
      - \u{1F3AF} \u5168\u7403\u76F4\u8FDE
      - \u267B\uFE0F \u81EA\u52A8\u9009\u62E9

  - name: \u{1F3AF} \u5168\u7403\u76F4\u8FDE
    type: select
    proxies:
      - DIRECT
      - \u{1F680} \u8282\u70B9\u9009\u62E9
      - \u267B\uFE0F \u81EA\u52A8\u9009\u62E9

  - name: \u{1F6D1} \u5168\u7403\u62E6\u622A
    type: select
    proxies:
      - REJECT
      - DIRECT

  - name: \u{1F343} \u5E94\u7528\u51C0\u5316
    type: select
    proxies:
      - REJECT
      - DIRECT

  - name: \u{1F41F} \u6F0F\u7F51\u4E4B\u9C7C
    type: select
    proxies:
      - \u{1F680} \u8282\u70B9\u9009\u62E9
      - \u{1F3AC} \u6D41\u5A92\u4F53
      - \u{1F3AF} \u5168\u7403\u76F4\u8FDE
      - \u267B\uFE0F \u81EA\u52A8\u9009\u62E9`;
}
var MAX_EXTRA_DEVICES = 3;
function buildConfig(warp, opera, proton, wind, ztDevice = null, extraWarps = []) {
  let freeDev = warp, ztDev = ztDevice;
  if (warp && warp.zeroTrust) {
    ztDev = warp;
    freeDev = null;
  }
  const free = freeDev ? buildEntries(freeDev, { slot: 1 }) : null;
  const zteam = ztDev ? buildEntries(ztDev) : null;
  const extras = (extraWarps || []).filter((d) => d && d.privateKey && d.ipv4 && !d.zeroTrust).slice(0, MAX_EXTRA_DEVICES).map((d, i) => buildEntries(d, { slot: i + 2 }));
  const freeEntries = free ? free.entries : [];
  const freeV4 = free ? free.v4Entries : [];
  const extraEntries = extras.flatMap((e) => e.entries);
  const extraV4 = extraEntries;
  const teamEntries = zteam ? zteam.teamEntries : [];
  const zt = teamEntries.length > 0;
  const proxies = [];
  if (free) proxies.push(...free.proxies);
  for (const e of extras) proxies.push(...e.proxies);
  if (zteam) proxies.push(...zteam.proxies);
  const frontAll = [...freeEntries, ...extraEntries, ...teamEntries];
  const frontV4 = [...freeV4, ...extraEntries, ...teamEntries];
  const warpAll = [...freeEntries, ...extraEntries];
  const warpV4 = [...freeV4, ...extraV4];
  if (!frontAll.length) {
    throw new Error("\u6CA1\u6709\u53EF\u7528\u7684 MASQUE \u63A5\u5165\u70B9\uFF1Aconsumer WARP \u548C Zero Trust \u8BBE\u5907\u90FD\u7F3A\u5931");
  }
  const dialerPool = zt ? interleave(teamEntries, warpV4) : warpV4;
  const byLoc = {};
  for (const land of opera.landings) {
    for (const ent of frontAll) {
      const name = `${land.tag}@${ent}`;
      (byLoc[land.loc] ||= []).push(name);
      proxies.push(
        `  - {name: "${name}", type: http, server: ${land.ip}, port: ${land.port}, username: ${opera.username}, password: ${opera.password}, tls: true, sni: ${land.host}, skip-cert-verify: false, dialer-proxy: ${ent}}`
      );
    }
  }
  const combos = Object.values(byLoc).reduce((a, b) => a + b.length, 0);
  let protonNames = [];
  const protonByCC = {};
  if (proton && proton.servers && proton.servers.length) {
    proton.servers.forEach((srv, i) => {
      const ent = dialerPool[i % dialerPool.length] || frontV4[i % frontV4.length];
      protonNames.push(srv.name);
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
  const windNames = [];
  const windByLoc = {};
  if (wind && wind.servers && wind.servers.length) {
    wind.servers.forEach((srv, i) => {
      const ent = dialerPool[i % dialerPool.length] || frontV4[i % frontV4.length];
      const name = `WS-${srv.tag}`;
      windNames.push(name);
      (windByLoc[srv.loc] = windByLoc[srv.loc] || []).push(name);
      proxies.push(
        `  - {name: "${name}", type: http, server: ${srv.host}, port: ${srv.port}, username: ${wind.username}, password: ${wind.password}, tls: true, sni: ${srv.host}, skip-cert-verify: false, dialer-proxy: ${ent}}`
      );
    });
  }
  const windLocNames = Object.keys(windByLoc).map((l) => `WS-${l}`);
  const windLocDefs = Object.entries(windByLoc).map(([loc, names]) => `  - name: WS-${loc}
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 100
    lazy: true
    proxies:
${q(names)}`).join("\n\n");
  const locNames = Object.keys(byLoc).map((l) => `${l}\u7EBF\u8DEF`);
  const protonCCNames = Object.keys(protonByCC).map((c) => `Proton-${c}`);
  const protonCCDefs = Object.entries(protonByCC).map(([cc, names]) => `  - name: Proton-${cc}
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 100
    lazy: true
    proxies:
${q(names)}`).join("\n\n");
  const landingPool = [];
  if (protonNames.length) landingPool.push("Proton\u7EBF\u8DEF");
  if (windNames.length) landingPool.push("Windscribe\u7EBF\u8DEF");
  landingPool.push(...locNames);
  if (zt) landingPool.push("ZT\u56E2\u961F\u8FB9\u7F18");
  if (warpAll.length) landingPool.push("WARP\u76F4\u8FDE");
  const picks = [...locNames];
  if (zt) picks.push("ZT\u56E2\u961F\u8FB9\u7F18");
  if (warpAll.length) picks.push("WARP\u76F4\u8FDE");
  picks.push("\u26A1 \u805A\u5408");
  if (zt) picks.push("\u26A1 \u805A\u5408ZT");
  if (warpV4.length) picks.push("\u26A1 \u805A\u5408WARP");
  if (protonNames.length) picks.push("Proton\u7EBF\u8DEF", ...protonCCNames);
  if (windNames.length) picks.push("Windscribe\u7EBF\u8DEF", ...windLocNames);
  const aggPool = frontV4;
  const ztAggPool = teamEntries;
  const freeAggPool = warpV4;
  const pickNode = (n) => {
    const m = /-(\d+)$/.exec(n);
    return !m || PICK_PORTS.includes(Number(m[1]));
  };
  const extraPick = extras.slice(0, 2).flatMap((e) => e.entries);
  const pickPool = [
    ...freeV4.filter(pickNode),
    ...teamEntries.filter(pickNode),
    ...extraPick
  ];
  const locDefs = Object.entries(byLoc).map(([loc, tags]) => `  - name: ${loc}\u7EBF\u8DEF
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 80
    lazy: true
    proxies:
${q(tags)}`).join("\n\n");
  const ztGroupDef = zt ? `
  - name: ZT\u56E2\u961F\u8FB9\u7F18
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
  const ztAggDef = zt ? `
  - name: \u26A1 \u805A\u5408ZT
    type: load-balance
    strategy: consistent-hashing
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 40
    proxies:
${q(ztAggPool)}
` : "";
  const freeAggDef = warpV4.length ? `
  - name: \u26A1 \u805A\u5408WARP
    type: load-balance
    strategy: consistent-hashing
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 40
    proxies:
${q(freeAggPool)}
` : "";
  const warpGroupDef = warpAll.length ? `
  - name: WARP\u76F4\u8FDE
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
  const streamExtra = [
    "      - \u26A1 \u805A\u5408",
    zt ? "      - \u26A1 \u805A\u5408ZT" : "",
    warpV4.length ? "      - \u26A1 \u805A\u5408WARP" : "",
    protonNames.length ? "      - Proton\u7EBF\u8DEF" : "",
    windNames.length ? "      - Windscribe\u7EBF\u8DEF" : "",
    "      - \u{1F310} \u843D\u5730\u51FA\u53E3",
    "      - \u{1F4F9} \u6CB9\u7BA1\u89C6\u9891",
    "      - DIRECT"
  ].filter(Boolean).join("\n") + "\n";
  const { prov, rules } = buildRules();
  const yaml = `# Opera VPN over Cloudflare WARP (MASQUE)
# \u7531 Cloudflare Worker \u751F\u6210\u4E8E ${(/* @__PURE__ */ new Date()).toISOString()}
#
# \u805A\u5408\u7248\uFF1A\u4E09\u65CF\u8282\u70B9\u90FD\u5728\u8FD9\u4E00\u4EFD\u91CC\uFF0C\u5404\u7528\u5404\u7684\u5BC6\u94A5\uFF0C\u4E92\u4E0D\u9876\u66FF\u3002
#
#   \u4E9A\u6D32/\u6B27\u6D32/\u7F8E\u6D32\u7EBF\u8DEF  \u672C\u673A -> MASQUE -> Opera \u843D\u5730 -> \u76EE\u6807\uFF08\u80FD\u6362\u51FA\u53E3\u56FD\u5BB6\uFF09
#   Proton/Windscribe   \u672C\u673A -> MASQUE -> \u5BF9\u5E94\u843D\u5730 -> \u76EE\u6807\uFF08\u80FD\u6362\u51FA\u53E3\u56FD\u5BB6\uFF09
#   WARP\u76F4\u8FDE            \u672C\u673A -> MASQUE(\u514D\u8D39\u8FB9\u7F18 198/199) -> \u76EE\u6807\uFF08\u51FA\u53E3\u662F CF \u7684 IP\uFF0C\u5FEB\uFF09
${zt ? `#   ZT\u56E2\u961F\u8FB9\u7F18         \u672C\u673A -> MASQUE(\u56E2\u961F\u8FB9\u7F18 197.x) -> \u76EE\u6807\uFF08\u66F4\u7A33\uFF0C\u4EC5 Zero Trust \u53EF\u7528\uFF09` : ""}
#
# \u8282\u70B9\u540D "\u6B27\u6D321@198.1-443" = \u6B27\u6D32\u7B2C 1 \u4E2A\u843D\u5730\uFF0C\u7ECF 162.159.198.1:443 \u63A5\u5165\u3002
# ZT- \u5F00\u5934\u7684\u662F Zero Trust \u56E2\u961F\u8FB9\u7F18\u8282\u70B9\uFF08162.159.197.x\uFF09\u3002
# W2- / W3- \u5F00\u5934\u7684\u662F**\u5907\u7528\u514D\u8D39\u8BBE\u5907**\u7684\u63A5\u5165\u70B9\uFF08\u53E6\u4E00\u628A\u5BC6\u94A5\u3001\u53E6\u4E00\u4E2A\u8D26\u53F7\uFF0C
# \u53EA\u51FA 443 / 8095 \u4E24\u4E2A\u7AEF\u53E3 \u2014\u2014 \u5B83\u4EEC\u662F\u4E3B\u529B\u8BBE\u5907\u7684\u5907\u80CE\uFF0C\u4E0D\u662F\u4E3B\u529B\uFF09\u3002
#
# \u63A5\u5165\u70B9\u5171 ${frontAll.length} \u4E2A\uFF08\u514D\u8D39\u8FB9\u7F18 ${freeEntries.length}${extraEntries.length ? ` + \u5907\u7528\u514D\u8D39 ${extraEntries.length}` : ""} + ZT \u56E2\u961F\u8FB9\u7F18 ${teamEntries.length}\uFF09
# x \u843D\u5730 ${opera.landings.length} \u4E2A = \u7EC4\u5408 ${combos} \u4E2A${protonNames.length ? `\uFF0C\u5916\u52A0 ${protonNames.length} \u4E2A Proton \u843D\u5730` : ""}${windNames.length ? ` \u548C ${windNames.length} \u4E2A Windscribe \u843D\u5730` : ""}\u3002
# \u4EFB\u4E00\u73AF\u5931\u6548\u90FD\u6709\u66FF\u4EE3\u8DEF\u5F84\uFF1B\u67D0\u4E2A\u65CF\u6574\u4F53\u4E0D\u53EF\u7528\u65F6\uFF0C\u53E6\u5916\u4E24\u65CF\u7167\u5E38\u5DE5\u4F5C\u3002
# \u8282\u70B9\u6570\u5B57\u5BF9\u4E0D\u5BF9\u662F\u5224\u65AD\u300C\u6709\u6CA1\u6709\u5BFC\u5165\u5230\u65E7\u914D\u7F6E\u300D\u6700\u5FEB\u7684\u529E\u6CD5\uFF1A
#   \u672C\u4EFD\u5E94\u8BE5\u6709 \u514D\u8D39\u8FB9\u7F18 ${freeEntries.length} \u4E2A / ZT \u56E2\u961F\u8FB9\u7F18 ${teamEntries.length} \u4E2A\u3002
#   \u5BA2\u6237\u7AEF\u91CC\u8981\u662F\u53EA\u770B\u5230 4 \u4E2A ZT \u8282\u70B9\uFF0C\u8BF4\u660E\u5BFC\u5165\u7684\u662F\u65E7\u914D\u7F6E\uFF0C\u91CD\u65B0\u5BFC\u5165\u4E00\u6B21\u5373\u53EF\u3002
#
# \u9700\u8981 mihomo Alpha \u5206\u652F\uFF1A\u7A33\u5B9A\u7248\u6CA1\u6709 masque outbound\uFF0C\u4E5F\u4E0D\u8BA4 dialer-proxy\u3002
# private-key \u7B49\u540C WARP \u8D26\u53F7\u51ED\u636E\uFF0C\u522B\u5916\u4F20\u3002

${head(true)}

proxies:
${proxies.join("\n")}

proxy-groups:
  - name: \u{1F310} \u843D\u5730\u51FA\u53E3
    type: select
    proxies:
${p(landingPool)}
      - DIRECT

  # QUIC \u603B\u5F00\u5173\u3002\u9ED8\u8BA4 REJECT\uFF08\u6D4F\u89C8\u5668\u4F1A\u81EA\u52A8\u56DE\u9000 TCP\uFF09\uFF1B
  # \u4E2A\u522B App \u975E\u7528 QUIC \u4E0D\u53EF\u7684\u8BDD\uFF0C\u5728\u5BA2\u6237\u7AEF\u91CC\u628A\u5B83\u5207\u6210 DIRECT\u3002
  - name: \u{1F6AB} QUIC
    type: select
    proxies:
      - REJECT
      - DIRECT

  # \u5E76\u53D1\u8FDE\u63A5\u5206\u6563\u5230\u591A\u4E2A\u63A5\u5165\u70B9\uFF0C\u5355\u96A7\u9053\u8DD1\u4E0D\u5FEB\u65F6\u7528\u5B83\u3002
  # \u6DF7\u4E86\u4E24\u65CF\uFF08\u514D\u8D39\u8FB9\u7F18 + ZT \u56E2\u961F\u8FB9\u7F18\uFF09\uFF0C\u51FA\u53E3 IP \u56E0\u6B64\u4F1A\u6709\u4E24\u4E2A\uFF1B
  # consistent-hashing \u6309\u76EE\u6807\u57DF\u540D\u6563\uFF0C\u540C\u4E00\u4E2A\u7AD9\u70B9\u59CB\u7EC8\u843D\u5728\u540C\u4E00\u6761\u96A7\u9053\u4E0A\uFF0C
  # \u4E0D\u4F1A\u51FA\u73B0\u300C\u4E00\u4E2A\u4F1A\u8BDD\u4E2D\u9014\u6362\u51FA\u53E3\u300D\u3002\u8981\u51FA\u53E3\u4E25\u683C\u7EDF\u4E00\u7528\u4E0B\u9762\u4E24\u4E2A\u5355\u65CF\u6C60\u3002
  - name: \u26A1 \u805A\u5408
    type: load-balance
    strategy: consistent-hashing
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 40
    proxies:
${q(aggPool)}
${ztAggDef}${freeAggDef}
  # \u6D41\u5A92\u4F53 / \u6D4B\u901F\u4E13\u7528\u51FA\u53E3\u3002
  #
  # \u4E3A\u4EC0\u4E48\u4E0D\u8DDF\u7F51\u9875\u5171\u7528 \u{1F680} \u8282\u70B9\u9009\u62E9\uFF1A4K \u89C6\u9891\u662F\u6301\u7EED\u51E0\u5341 Mbps \u7684\u5355\u6761 UDP \u6D41\uFF0C
  # \u4E5F\u662F\u8FD0\u8425\u5546 QoS \u6700\u5148\u76EF\u4E0A\u7684\u76EE\u6807\uFF1B\u7F51\u9875\u662F\u51E0\u767E\u4E2A\u77ED\u8FDE\u63A5\uFF0C\u88AB\u538B\u4E00\u70B9\u611F\u89C9\u4E0D\u5230\u3002
  # \u62C6\u5F00\u4E4B\u540E\u770B\u89C6\u9891\u7684\u6D41\u548C\u5237\u7F51\u9875\u7684\u6D41\u843D\u5728\u4E0D\u540C\u63A5\u5165\u70B9\u4E0A\uFF0C\u4E92\u4E0D\u62A2\u3002
  #
  # YouTube \u6253\u4E0D\u5F00 / \u4E00\u76F4\u8F6C\u5708\u65F6\uFF0C\u5F80\u4E0B\u5207\u6210\u4E0B\u9762\u63A5\u7684\u843D\u5730\u7EC4\uFF1A
  # CF \u81EA\u5DF1\u7684\u51FA\u53E3 IP \u88AB Google \u5224\u6210\u673A\u623F\u800C\u9650\u6D41\u65F6\uFF0C\u6362\u4E2A\u51FA\u53E3\u5C31\u597D\u3002
  # \u9009\u5B9A\u540E\u5199\u8FDB profile.store-selected\uFF0C\u91CD\u542F\u4E0D\u4E22\u3002
  - name: \u{1F3AC} \u6D41\u5A92\u4F53
    type: select
    proxies:
      - \u{1F3AC} \u6D41\u5A92\u4F53\u81EA\u52A8
${streamExtra}${q(pickPool)}

  # \u6D41\u5A92\u4F53\u81EA\u52A8\u9009\u4F18\u3002\u53EA\u6D4B\u7CBE\u9009\u6C60\uFF08\u624B\u673A\u4E0A\u4E5F\u6D4B\u5F97\u5B8C\uFF09\uFF0C\u5F00\u673A\u5C31\u7EEA\u3002
  - name: \u{1F3AC} \u6D41\u5A92\u4F53\u81EA\u52A8
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 180
    tolerance: 40
    timeout: 3000
    max-failed-times: 2
    lazy: false
    proxies:
${q(pickPool)}

  - name: \u{1F680} \u8282\u70B9\u9009\u62E9
    type: select
    proxies:
      - \u267B\uFE0F \u81EA\u52A8\u9009\u62E9
${p(picks)}
      - \u{1F504} \u6545\u969C\u8F6C\u79FB

  # \u539F\u6765\u8FD9\u91CC\u662F url-test \u5957 url-test\uFF08\u6210\u5458\u5168\u662F\u7EC4\uFF09\u3002\u5D4C\u5957\u7EC4\u7684\u5EF6\u8FDF\u53D6\u7684\u662F
  # \u5B50\u7EC4\u300C\u5F53\u524D\u9009\u4E2D\u8282\u70B9\u300D\u7684\u65E7\u503C\uFF0C\u4E0D\u5237\u65B0\u5C31\u4E00\u76F4\u662F\u65E7\u503C \u2014\u2014 \u8FD9\u5C31\u662F
  # \u300C\u81EA\u52A8\u9009\u62E9\u6311\u4E0D\u5230\u6700\u5FEB\u300D\u7684\u6839\u56E0\u3002\u644A\u5E73\u6210\u771F\u5B9E\u63A5\u5165\u70B9\uFF0C\u5E76\u5173\u6389 lazy \u8BA9\u5F00\u673A\u5C31\u6D4B\u3002
  #
  # \u6210\u5458\u7528\u7CBE\u9009\u6C60\u800C\u4E0D\u662F\u5168\u91CF\uFF1A\u624B\u673A\u4E0A\u5E76\u53D1 33 \u6B21 MASQUE \u63E1\u624B\u4F1A\u88AB\u7CFB\u7EDF\u9650\u6D41\uFF0C
  # \u6D4B\u4E0D\u5B8C\u7684\u76F4\u63A5\u6807\u7EA2\uFF0C\u770B\u7740\u5C31\u50CF\u300C\u8282\u70B9\u5168\u6B7B\u4E86\u300D\u3002\u7CBE\u9009\u6C60 17 \u4E2A\u591F\u8986\u76D6
  # 443/4443/8443/8095 \u56DB\u4E2A\u4EE3\u8868\u6027\u7AEF\u53E3\uFF0C\u8981\u5168\u91CF\u5C31\u5728\u76F4\u8FDE\u7EC4\u91CC\u624B\u9009\u3002
  - name: \u267B\uFE0F \u81EA\u52A8\u9009\u62E9
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 180
    tolerance: 40
    timeout: 3000
    max-failed-times: 2
    lazy: false
    proxies:
${q(pickPool)}

  - name: \u{1F504} \u6545\u969C\u8F6C\u79FB
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
  - name: Proton\u7EBF\u8DEF
    type: select
    proxies:
      - Proton-\u81EA\u52A8
${p(protonCCNames)}

  - name: Proton-\u81EA\u52A8
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 80
    lazy: true
    proxies:
${q(protonNames)}

${protonCCDefs}
` : ""}${windNames.length ? `
  - name: Windscribe\u7EBF\u8DEF
    type: select
    proxies:
      - WS-\u81EA\u52A8
${p(windLocNames)}

  - name: WS-\u81EA\u52A8
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
  - GEOIP,LAN,\u{1F3AF} \u5168\u7403\u76F4\u8FDE,no-resolve
  - GEOIP,CN,\u{1F3AF} \u5168\u7403\u76F4\u8FDE
  - MATCH,\u{1F41F} \u6F0F\u7F51\u4E4B\u9C7C
`;
  return {
    yaml,
    entries: frontAll.length,
    landings: opera.landings.length,
    combos,
    proton: protonNames.length,
    wind: windNames.length,
    zeroTrust: zt,
    teamEdges: teamEntries.length,
    freeEdges: freeEntries.length,
    // 备用免费设备：台数 + 它们的节点数。UI 要靠这两个数跟用户说清楚
    // 「免费族有几台设备在扛」，也是排查「一族全死」时的第一手信息。
    extraDevices: extras.length,
    extraEdges: extraEntries.length
  };
}

// src/proton.js
function parseBlob(text) {
  const raw = String(text || "").trim().replace(/\s+/g, "");
  if (!raw) throw new Error("\u5185\u5BB9\u4E3A\u7A7A");
  let obj;
  try {
    obj = JSON.parse(atob(raw));
  } catch {
    throw new Error("\u89E3\u6790\u5931\u8D25\uFF0C\u786E\u8BA4\u590D\u5236\u5B8C\u6574\u4E86\uFF08\u5E94\u8BE5\u662F\u4E00\u957F\u4E32\u5B57\u6BCD\u6570\u5B57\uFF0C\u6CA1\u6709\u6362\u884C\uFF09");
  }
  if (obj.v !== 1) throw new Error(`\u4E0D\u8BA4\u8BC6\u7684\u7248\u672C v${obj.v}\uFF0C\u6D41\u6C34\u7EBF\u548C Worker \u7248\u672C\u5BF9\u4E0D\u4E0A`);
  if (!obj.privateKey || !Array.isArray(obj.servers) || !obj.servers.length) {
    throw new Error("\u5185\u5BB9\u4E0D\u5B8C\u6574\uFF0C\u91CD\u8DD1\u4E00\u6B21\u6D41\u6C34\u7EBF");
  }
  if (obj.expiresAt && obj.expiresAt * 1e3 < Date.now()) {
    throw new Error("\u8FD9\u4EFD\u51ED\u636E\u5DF2\u7ECF\u8FC7\u671F\u4E86\uFF0C\u91CD\u8DD1\u6D41\u6C34\u7EBF\u62FF\u65B0\u7684");
  }
  return obj;
}

// src/windscribe.js
var CLIENT_AUTH_SECRET = "952b4412f002315aa50751032fcaab03";
var API2 = "https://api.windscribe.com";
var ASSETS = "https://assets.windscribe.com/serverlist";
var PROXY_PORT = 443;
var H3 = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.53 Safari/537.36",
  "Origin": "chrome-extension://hnmpcagpplmpfojmgmnngilcnanddlhb",
  "Accept": "application/json"
};
var CC = {
  "US-C": "\u7F8E\u56FD\u4E2D\u90E8",
  "US": "\u7F8E\u56FD\u4E1C\u90E8",
  "US-W": "\u7F8E\u56FD\u897F\u90E8",
  "CA": "\u52A0\u62FF\u5927\u4E1C\u90E8",
  "CA-W": "\u52A0\u62FF\u5927\u897F\u90E8",
  "FR": "\u6CD5\u56FD",
  "DE": "\u5FB7\u56FD",
  "NL": "\u8377\u5170",
  "NO": "\u632A\u5A01",
  "RO": "\u7F57\u9A6C\u5C3C\u4E9A",
  "CH": "\u745E\u58EB",
  "GB": "\u82F1\u56FD",
  "HK": "\u9999\u6E2F"
};
function authHash() {
  const t = Math.floor(Date.now() / 1e3);
  return { hash: md5Hex(CLIENT_AUTH_SECRET + String(t)), time: t };
}
async function call(url, init) {
  const r = await fetch(url, { ...init, headers: { ...H3, ...init?.headers || {} } });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`\u54CD\u5E94\u4E0D\u662F JSON: ${text.slice(0, 120)}`);
  }
  if (!j.data) {
    const msg = (j.errorMessage || j.message || text).toString().slice(0, 160);
    throw new Error(`Windscribe ${r.status}: ${msg}`);
  }
  return j.data;
}
async function fetchCredentials(acc) {
  const { hash, time } = authHash();
  const q2 = new URLSearchParams({
    client_auth_hash: hash,
    session_auth_hash: acc.sessionAuthHash,
    time: String(time)
  });
  const d = await call(`${API2}/ServerCredentials?${q2}`);
  return { username: atob(d.username), password: atob(d.password) };
}
async function fetchSession(acc) {
  const { hash, time } = authHash();
  const q2 = new URLSearchParams({
    client_auth_hash: hash,
    session_auth_hash: acc.sessionAuthHash,
    time: String(time),
    session_type_id: "2"
  });
  const d = await call(`${API2}/Session?${q2}`);
  return {
    used: d.traffic_used,
    max: d.traffic_max,
    status: d.status,
    locHash: d.loc_hash
  };
}
async function fetchServers(acc) {
  const r = await fetch(`${ASSETS}/chrome/0/${acc.locHash}`, { headers: H3 });
  if (!r.ok) throw new Error(`serverlist HTTP ${r.status}`);
  const j = await r.json();
  const out = [];
  for (const c of j.data || []) {
    if (c.premium_only) continue;
    const loc = CC[c.short_name];
    if (!loc) continue;
    let seq = 0;
    for (const g of c.groups || []) {
      for (const h of g.hosts || []) {
        if (!h.hostname) continue;
        seq += 1;
        out.push({ tag: `${loc}${seq}`, loc, host: h.hostname, port: PROXY_PORT });
      }
    }
  }
  return out;
}
async function fetchWindscribe(account) {
  if (!account || !account.sessionAuthHash) {
    throw new Error("\u6CA1\u6709 Windscribe \u8D26\u53F7\uFF0C\u8DD1\u4E00\u6B21\u6D41\u6C34\u7EBF\u63A8\u4E00\u4E2A\u8FC7\u6765");
  }
  const [cred, servers] = await Promise.all([
    fetchCredentials(account),
    fetchServers(account)
  ]);
  return { account, ...cred, servers };
}

// src/ui.js
var CSS = `
:root{
  --bg:#05030e; --bg2:#0a0820;
  --cyan:#00f0ff; --pink:#ff2bd6; --purple:#a347ff;
  --yellow:#fff200; --mint:#00ff9d; --red:#ff3860;
  --text:#e6f5ff; --dim:#7aa9c4;
  --border:rgba(0,240,255,.55); --grid:rgba(255,43,214,.16);
}
*{margin:0;padding:0;box-sizing:border-box}
html{overflow-x:hidden}
html,body{min-height:100%}
body{
  font-family:"JetBrains Mono","Fira Code","Courier New",
    "PingFang SC","Microsoft YaHei","Noto Sans SC",monospace;
  background:radial-gradient(ellipse at 20% 10%,#2a0040 0%,var(--bg) 55%,#000 100%);
  color:var(--text);
  padding:32px 16px 56px;
  display:flex;justify-content:center;
  position:relative;overflow-x:hidden;
}
body::before{
  content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
  background:
    linear-gradient(var(--grid) 1px,transparent 1px) 0 0/44px 44px,
    linear-gradient(90deg,var(--grid) 1px,transparent 1px) 0 0/44px 44px;
  opacity:.5;
}
body::after{
  content:"";position:fixed;inset:0;pointer-events:none;z-index:1;
  background:repeating-linear-gradient(180deg,rgba(0,240,255,.05) 0 1px,transparent 1px 4px);
}
.term{
  min-width:0;overflow:hidden;
  border:1px solid var(--border);
  background:rgba(8,4,28,.86);
  box-shadow:0 0 24px rgba(0,240,255,.14),inset 0 0 60px rgba(163,71,255,.07);
}
.head{
  display:flex;align-items:center;gap:12px;
  padding:12px 16px;border-bottom:1px solid var(--border);
  background:linear-gradient(90deg,rgba(255,43,214,.16),rgba(0,240,255,.16));
}
.dots{display:flex;gap:8px}
.dot{width:11px;height:11px;transform:rotate(45deg);background:var(--pink);box-shadow:0 0 8px var(--pink)}
.dot:nth-child(2){background:var(--yellow);box-shadow:0 0 8px var(--yellow)}
.dot:nth-child(3){background:var(--mint);box-shadow:0 0 8px var(--mint)}
.title{
  color:var(--cyan);font-size:13px;font-weight:700;
  letter-spacing:.25em;text-transform:uppercase;text-shadow:0 0 6px var(--cyan);
}
.title::before{content:"// ";color:var(--pink)}
.body{padding:22px 20px;min-width:0}
input{
  background:rgba(0,0,0,.45);
  border:1px solid var(--border);color:var(--cyan);
  font-family:inherit;font-size:12px;padding:11px 12px;outline:none;
  text-shadow:0 0 4px var(--cyan);
}
input:focus{border-color:var(--pink);box-shadow:0 0 12px rgba(255,43,214,.4)}
button{
  font-family:inherit;font-size:12px;letter-spacing:.12em;text-transform:uppercase;
  padding:11px 18px;cursor:pointer;
  background:transparent;border:1px solid var(--pink);color:var(--pink);
  text-shadow:0 0 6px var(--pink);transition:.15s;white-space:nowrap;
}
button:hover{background:var(--pink);color:#05030e;text-shadow:none;box-shadow:0 0 16px var(--pink)}
button.gh{border-color:var(--cyan);color:var(--cyan);text-shadow:0 0 6px var(--cyan)}
button.gh:hover{background:var(--cyan);color:#05030e;box-shadow:0 0 16px var(--cyan)}
button:disabled{opacity:.4;cursor:not-allowed}
#msg{margin-top:10px;font-size:12px;min-height:18px}
`;
function renderNoKV() {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OPERA // MASQUE</title>
<style>${CSS}
.wrap{width:100%;max-width:520px;position:relative;z-index:2;min-width:0;align-self:center}
.step{font-size:12px;color:var(--dim);line-height:2;margin-top:6px}
.step b{color:var(--cyan);font-weight:400}
.step code{color:var(--yellow)}
</style></head>
<body><div class="wrap"><div class="term">
  <div class="head">
    <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    <div class="title">KV Not Bound</div>
  </div>
  <div class="body">
    <div class="step">
      \u8FD8\u6CA1\u7ED1 KV\uFF0C\u914D\u7F6E\u548C\u5BC6\u7801\u90FD\u6CA1\u5730\u65B9\u5B58\u3002<br><br>
      <b>1.</b> Cloudflare \u540E\u53F0 \u2192 \u5B58\u50A8\u548C\u6570\u636E\u5E93 \u2192 KV \u2192 \u521B\u5EFA\u5B9E\u4F8B<br>
      <b>2.</b> \u56DE\u5230\u8FD9\u4E2A Worker \u2192 \u8BBE\u7F6E \u2192 \u7ED1\u5B9A \u2192 \u6DFB\u52A0 \u2192 KV \u547D\u540D\u7A7A\u95F4<br>
      <b>3.</b> \u53D8\u91CF\u540D\u586B <code>KV</code>\uFF08\u4E24\u4E2A\u5B57\u6BCD\uFF0C\u5927\u5199\uFF09\uFF0C\u547D\u540D\u7A7A\u95F4\u9009\u521A\u5EFA\u7684<br>
      <b>4.</b> \u90E8\u7F72\uFF0C\u5237\u65B0\u672C\u9875
    </div>
  </div>
</div></div></body></html>`;
}
function renderSetup() {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OPERA // MASQUE</title>
<style>${CSS}
.wrap{width:100%;max-width:430px;position:relative;z-index:2;min-width:0;align-self:center}
.f{display:flex;flex-direction:column;gap:10px}
.hint{font-size:11px;color:var(--dim);line-height:1.9;margin-top:14px}
.hint b{color:var(--yellow);font-weight:400}
.lead{font-size:12px;color:var(--cyan);line-height:1.8;margin-bottom:16px}
</style></head>
<body><div class="wrap"><div class="term">
  <div class="head">
    <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    <div class="title">First Run</div>
  </div>
  <div class="body">
    <div class="lead">\u7B2C\u4E00\u6B21\u6253\u5F00\uFF0C\u5148\u8BBE\u4E00\u4E2A\u7BA1\u7406\u5BC6\u7801\u3002<br>\u4E4B\u540E\u8BA2\u9605\u8DEF\u5F84\u3001\u6539\u5BC6\u7801\u90FD\u5728\u754C\u9762\u91CC\u505A\u3002</div>
    <form class="f" onsubmit="return go(event)">
      <input type="password" id="p" placeholder="PASSWORD (>= 8)" autofocus autocomplete="new-password">
      <input type="password" id="c" placeholder="CONFIRM" autocomplete="new-password">
      <button type="submit">\u8BBE\u7F6E</button>
    </form>
    <div id="msg"></div>
    <div class="hint">
      \u5BC6\u7801\u53EA\u5B58\u54C8\u5E0C\uFF08PBKDF2 + \u968F\u673A\u76D0\uFF09\uFF0CKV \u91CC\u770B\u4E0D\u5230\u660E\u6587\u3002<br>
      <b>\u5FD8\u4E86\u53EA\u80FD\u5220\u6389 KV \u91CC\u7684 auth:cred \u91CD\u6765</b>\uFF0C\u6CA1\u6709\u627E\u56DE\u3002
    </div>
  </div>
</div></div>
<script>
async function go(e){
  e.preventDefault();
  const b=document.querySelector('button'), m=document.getElementById('msg');
  b.disabled=true; m.textContent='> \u8BBE\u7F6E\u4E2D\u2026'; m.style.color='var(--yellow)';
  try{
    const r=await fetch('/api/setup',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({password:document.getElementById('p').value,
                           confirm:document.getElementById('c').value})});
    const j=await r.json();
    if(j.ok){m.textContent='> \u5B8C\u6210';m.style.color='var(--mint)';location.reload();}
    else{m.textContent='> '+j.error;m.style.color='var(--red)';b.disabled=false;}
  }catch(err){m.textContent='> '+err.message;m.style.color='var(--red)';b.disabled=false;}
  return false;
}
<\/script>
</body></html>`;
}
function renderLogin(err) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OPERA // MASQUE</title>
<style>${CSS}
.wrap{width:100%;max-width:400px;position:relative;z-index:2;min-width:0;align-self:center}
.f{display:flex;flex-direction:column;gap:12px}
.hint{font-size:11px;color:var(--dim);line-height:1.8;margin-top:14px}
</style></head>
<body><div class="wrap"><div class="term">
  <div class="head">
    <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    <div class="title">Auth Required</div>
  </div>
  <div class="body">
    <form class="f" onsubmit="return go(event)">
      <input type="password" id="p" placeholder="PASSWORD" autofocus autocomplete="current-password">
      <button type="submit">\u8FDB\u5165</button>
    </form>
    <div id="msg"></div>
    <div class="hint">\u8FDE\u7EED\u5931\u8D25 8 \u6B21\u4F1A\u9501\u5B9A 15 \u5206\u949F\u3002</div>
  </div>
</div></div>
<script>
async function go(e){
  e.preventDefault();
  const b=document.querySelector('button'), m=document.getElementById('msg');
  b.disabled=true; m.textContent='> \u9A8C\u8BC1\u4E2D\u2026'; m.style.color='var(--yellow)';
  try{
    const r=await fetch('/login',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({password:document.getElementById('p').value})});
    const j=await r.json();
    if(j.ok){m.textContent='> \u901A\u8FC7';m.style.color='var(--mint)';location.reload();}
    else{m.textContent='> '+j.error;m.style.color='var(--red)';b.disabled=false;}
  }catch(err){m.textContent='> '+err.message;m.style.color='var(--red)';b.disabled=false;}
  return false;
}
<\/script>
</body></html>`;
}
function renderUI(state, host, sp, token, cred, pushToken, protonCred, windUsage, ztDevice) {
  const s = state || {};
  const warp = s.warp || {};
  const stat = s.stats || {};
  const updated = s.updatedAt ? new Date(s.updatedAt) : null;
  const ago = updated ? Math.floor((Date.now() - updated.getTime()) / 6e4) : null;
  const exp = s.expiresAt ? new Date(s.expiresAt) : null;
  const left = exp ? Math.floor((exp.getTime() - Date.now()) / 6e4) : null;
  const leftTxt = left === null ? "\u2014" : left <= 0 ? "\u5DF2\u8FC7\u671F\uFF0C\u4E0B\u6B21\u8BBF\u95EE\u8BA2\u9605\u65F6\u81EA\u52A8\u91CD\u5EFA" : `${Math.floor(left / 60)} \u5C0F\u65F6 ${left % 60} \u5206\u540E\u8FC7\u671F`;
  const fmt = (d) => d ? d.toISOString().replace("T", " ").slice(0, 19) + " UTC" : "\u2014";
  const sub = `https://${host}${sp}?token=${token}`;
  const pushUrl = pushToken ? `https://${host}/push/${pushToken}` : "";
  const pExp = protonCred && protonCred.expiresAt ? new Date(protonCred.expiresAt * 1e3) : null;
  const windInfo = s.wind || null;
  const windPct = windUsage && windUsage.max ? Math.round(windUsage.used / windUsage.max * 100) : 0;
  const gb = (n) => (n / 1073741824).toFixed(2) + " GB";
  const windUsageTxt = windUsage && windUsage.max ? `${gb(windUsage.used)} / ${gb(windUsage.max)}\uFF08${windPct}%\uFF09` : null;
  const pLeft = pExp ? Math.floor((pExp.getTime() - Date.now()) / 864e5) : null;
  const diagItems = s.diag && Array.isArray(s.diag.items) ? s.diag.items : [];
  const diagAt = s.diag && s.diag.at ? new Date(s.diag.at) : null;
  const diagAgo = diagAt ? Math.floor((Date.now() - diagAt.getTime()) / 6e4) : null;
  const diagMap = {};
  diagItems.forEach((it) => {
    diagMap[it.role] = it;
  });
  const tone = (ok) => ok === true ? "color:var(--mint)" : ok === false ? "color:var(--red)" : ok === null ? "color:var(--yellow)" : "color:var(--dim)";
  const word = (ok) => ok === true ? "\u2713 \u6D3B\u7740" : ok === false ? "\u2717 \u5DF2\u88AB CF \u5220\u9664" : ok === null ? "? \u6CA1\u6CD5\u6821\u9A8C" : "\u672A\u4F53\u68C0";
  const devRows = [];
  if (warp.deviceId) devRows.push({ role: "\u514D\u8D39 WARP\uFF08\u4E3B\u529B\uFF09", d: warp });
  (s.warpExtras || []).forEach((d, i) => devRows.push({ role: "\u514D\u8D39 WARP\uFF08\u5907\u80CE " + (i + 1) + "\uFF09", d: d || {} }));
  if (ztDevice && ztDevice.deviceId) {
    devRows.push({ role: "Zero Trust \u56E2\u961F\u8BBE\u5907", d: ztDevice });
  }
  const row = (k, v, cls = "") => `<div class="row"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OPERA // MASQUE</title>
<style>${CSS}
.wrap{width:100%;max-width:880px;position:relative;z-index:2;min-width:0}
.sec{margin-bottom:26px;min-width:0}
.sec:last-child{margin-bottom:0}
.sec-t{
  color:var(--pink);font-size:11px;letter-spacing:.22em;text-transform:uppercase;
  margin-bottom:12px;text-shadow:0 0 6px var(--pink);
}
.sec-t::before{content:"\u258D";color:var(--cyan);margin-right:6px}
.row{
  display:flex;justify-content:space-between;align-items:baseline;gap:16px;
  padding:7px 0;border-bottom:1px dashed rgba(0,240,255,.14);font-size:13px;
}
.row:last-child{border-bottom:none}
.k{color:var(--dim);letter-spacing:.06em;white-space:nowrap}
.v{color:var(--cyan);text-align:right;word-break:break-all}
.v.ok{color:var(--mint);text-shadow:0 0 6px var(--mint)}
.v.warn{color:var(--yellow);text-shadow:0 0 6px var(--yellow)}
.v.err{color:var(--red);text-shadow:0 0 6px var(--red)}
.grid{display:grid;min-width:0;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.cell{
  border:1px solid rgba(0,240,255,.3);padding:12px 14px;
  background:rgba(0,240,255,.04);min-width:0;
}
.cell .n{font-size:26px;font-weight:700;color:var(--cyan);text-shadow:0 0 10px var(--cyan);line-height:1.1}
.cell .l{font-size:10px;color:var(--dim);letter-spacing:.14em;text-transform:uppercase;margin-top:6px;
  overflow-wrap:anywhere}
.sub{display:flex;gap:8px;align-items:stretch;margin-top:4px;flex-wrap:wrap}
.sub input{flex:1;min-width:0}
.pw{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;margin-top:4px}
.pw input{min-width:0}
@media(max-width:700px){.pw{grid-template-columns:1fr}}
.note{font-size:11px;color:var(--dim);line-height:1.85;margin-top:12px;
  overflow-wrap:anywhere;word-break:break-word}
.note b{color:var(--yellow);font-weight:400}
.foot{
  margin-top:18px;text-align:center;font-size:10px;color:var(--dim);
  letter-spacing:.2em;text-transform:uppercase;
}
.foot a{color:var(--purple);text-decoration:none}
.foot a:hover{color:var(--pink)}
.head{position:relative}
.out{
  margin-left:auto;font-size:10px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--dim);text-decoration:none;border:1px solid rgba(122,169,196,.4);
  padding:4px 10px;transition:.15s;
}
.out:hover{color:var(--red);border-color:var(--red);text-shadow:0 0 6px var(--red)}
@media(max-width:560px){
  body{padding:18px 10px 40px}
  .row{flex-direction:column;gap:2px;font-size:12px}
  .v{text-align:left}
  .sub{flex-direction:column}
  button{width:100%}
  .grid{grid-template-columns:1fr 1fr;gap:8px}
  .body{padding:16px 12px}
  .note{letter-spacing:0;font-size:11px}
  .title{font-size:10px;letter-spacing:.12em}
  .k,.v{letter-spacing:0}
  .cell .n{font-size:22px}
  .cell .l{letter-spacing:.08em;font-size:9px}
  .sec-t{letter-spacing:.14em}
}
@media(max-width:360px){
  .grid{grid-template-columns:1fr}
}
</style></head>
<body><div class="wrap"><div class="term">
  <div class="head">
    <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    <div class="title">Opera over MASQUE</div>
    <a class="out" href="/logout">\u9000\u51FA</a>
  </div>
  <div class="body">

    <div class="sec">
      <div class="sec-t">\u8BA2\u9605</div>
      <div class="sub">
        <input id="u" value="${sub}" readonly>
        <button onclick="cp('u')">\u590D\u5236</button>
        <button class="gh" onclick="location.href=document.getElementById('u').value">\u4E0B\u8F7D</button>
      </div>
      <div class="note">
        \u4E00\u4EFD\u805A\u5408\uFF0C\u5BFC\u8FDB\u53BB\u6709\u4E09\u65CF\u8282\u70B9\u53EF\u5207\uFF0C<b>\u5404\u7528\u5404\u7684\u5BC6\u94A5\u3001\u4E92\u4E0D\u9876\u66FF</b>\uFF1A<br>
        <b>WARP\u76F4\u8FDE</b> \u2014 \u8D70\u514D\u8D39\u8FB9\u7F18\uFF08198/199\uFF09\uFF0C\u51FA\u53E3\u662F Cloudflare \u7684 IP\uFF0C\u5FEB\u4F46\u9009\u4E0D\u4E86\u56FD\u5BB6\u3002<br>
        ${s.zeroTrust ? "<b>ZT\u56E2\u961F\u8FB9\u7F18</b> \u2014 \u8D70 197.x \u56E2\u961F\u8FB9\u7F18\uFF08Zero Trust \u72EC\u7ACB\u5BC6\u94A5\uFF09\uFF0C\u66F4\u7A33\u3002<br>" : ""}
        <b>\u4E9A\u6D32/\u6B27\u6D32/\u7F8E\u6D32\u7EBF\u8DEF</b> \u2014 MASQUE \u6253\u5E95\u518D\u843D Opera\uFF0C\u80FD\u6362\u51FA\u53E3\u56FD\u5BB6\uFF0C\u591A\u4E00\u8DF3\u4F1A\u6162\u4E9B\u3002<br>
        <b>Proton\u7EBF\u8DEF</b> \u2014 MASQUE \u6253\u5E95 + Proton WireGuard \u843D\u5730\uFF0C10 \u4E2A\u56FD\u5BB6\uFF08\u914D\u7F6E\u540E\u51FA\u73B0\uFF09\u3002<br>
        <b>Windscribe\u7EBF\u8DEF</b> \u2014 MASQUE \u6253\u5E95 + Windscribe \u843D\u5730\uFF0C13 \u4E2A\u5730\u533A\uFF0C\u6709\u9999\u6E2F\uFF08\u914D\u7F6E\u540E\u51FA\u73B0\uFF09\u3002<br>
        <b>\u{1F310} \u843D\u5730\u51FA\u53E3</b> \u2014 \u51FA\u53E3 IP \u654F\u611F\u7AD9\u70B9\uFF08Play / \u7EF4\u57FA / \u6210\u4EBA\u7AD9 / AI\uFF09\u7684\u4E13\u7528\u51FA\u53E3\uFF0C
        \u9ED8\u8BA4\u6309\u300C\u80FD\u6362\u51FA\u53E3\u7684\u843D\u5730 \u2192 \u56E2\u961F\u8FB9\u7F18 \u2192 \u514D\u8D39\u8FB9\u7F18\u300D\u6392\u4F18\u5148\u7EA7\u3002<br>
        <b>\u26A1 \u805A\u5408</b> \u2014 \u5E76\u53D1\u8FDE\u63A5\u5206\u6563\u5230\u591A\u6761\u96A7\u9053\uFF0C\u5355\u96A7\u9053\u8DD1\u4E0D\u5FEB\u65F6\u7528\u3002\u6DF7\u4E86\u4E24\u65CF\uFF0C
        \u51FA\u53E3 IP \u4F1A\u6709\u4E24\u4E2A\uFF1B\u8981\u4E25\u683C\u7EDF\u4E00\u5C31\u5207 <b>\u26A1 \u805A\u5408ZT</b> \u6216 <b>\u26A1 \u805A\u5408WARP</b>\u3002<br>
        <b>\u{1F3AC} \u6D41\u5A92\u4F53</b> \u2014 \u89C6\u9891/\u6D4B\u901F\u4E13\u7528\u51FA\u53E3\uFF0C\u548C\u5237\u7F51\u9875\u7684\u6D41\u5206\u5F00\u62E8\u4E0D\u540C\u63A5\u5165\u70B9\u3002<br>
        &nbsp;&nbsp;<b>YouTube \u6253\u4E0D\u5F00 / \u4E00\u76F4\u8F6C\u5708\u5C31\u5207\u8FD9\u4E2A\u7EC4</b>\uFF1A\u9ED8\u8BA4\u8D70\u300C\u{1F3AC} \u6D41\u5A92\u4F53\u81EA\u52A8\u300D\uFF0C
        \u8FD8\u4E0D\u884C\u5C31\u5F80\u4E0B\u5207\u6210 Proton\u7EBF\u8DEF / Windscribe\u7EBF\u8DEF \u6362\u4E2A\u51FA\u53E3 IP
        \uFF08CF \u7684 IP \u88AB Google \u5224\u6210\u673A\u623F\u65F6\u53EA\u6709\u6362\u51FA\u53E3\u80FD\u6551\uFF09\u3002<br>
        <b>\u{1F6AB} QUIC</b> \u2014 QUIC \u603B\u5F00\u5173\u3002\u56FD\u5185\u57DF\u540D\u7684 QUIC \u5DF2\u81EA\u52A8\u653E\u884C\u76F4\u8FDE\uFF0C\u4E0D\u7528\u7BA1\uFF1B
        \u53EA\u5269\u5883\u5916 QUIC \u5F52\u8FD9\u4E2A\u7EC4\uFF0C\u9ED8\u8BA4 REJECT\uFF08App \u4F1A\u7ACB\u523B\u56DE\u9000 TCP\uFF09\u3002<br>
        &nbsp;&nbsp;\u67D0\u4E2A\u5883\u5916 App \u4E00\u76F4\u8F6C\u5708\u3001\u522B\u7684\u90FD\u6B63\u5E38\uFF0C\u628A\u5B83\u5207\u6210 DIRECT \u8BD5\u4E00\u6B21 \u2014\u2014
        \u80FD\u597D\u5C31\u662F\u90A3\u4E2A App \u4E0D\u80AF\u653E\u5F03 QUIC\u3002<br>
        \u5957\u5A03\u7EBF\u8DEF\u8D85\u65F6\u6216\u843D\u5730\u6302\u4E86\uFF0C\u5207${s.zeroTrust ? "ZT\u56E2\u961F\u8FB9\u7F18\u6216" : ""}WARP\u76F4\u8FDE\u9876\u4E0A\u3002<br>
        <b>\u624B\u673A\u7AEF\u63D0\u793A</b>\uFF1A\u624B\u673A\u4E0A\u5E76\u53D1\u6D4B\u901F\u4F1A\u88AB\u7CFB\u7EDF\u9650\u5236\uFF0C\u6240\u4EE5\u300C\u267B\uFE0F \u81EA\u52A8\u9009\u62E9\u300D\u548C
        \u300C\u{1F3AC} \u6D41\u5A92\u4F53\u81EA\u52A8\u300D\u53EA\u6D4B\u7CBE\u9009\u7684 4 \u4E2A\u7AEF\u53E3\uFF08\u7EA6 20 \u4E2A\u63A5\u5165\u70B9\uFF09\uFF1B\u8981\u5168\u91CF 7 \u7AEF\u53E3\u7684
        \u5728\u300CWARP\u76F4\u8FDE\u300D\u91CC\u624B\u9009\uFF08\u90A3\u4E00\u7EC4\u662F\u6309\u9700\u6D4B\u901F\uFF0C\u5207\u8FC7\u53BB\u624D\u5F00\u6D4B\uFF09\u3002
      </div>
      <div id="msg"></div>
    </div>

    <div class="sec">
      <div class="sec-t">\u8282\u70B9</div>
      <div class="grid">
        <div class="cell"><div class="n">${stat.combos ?? "\u2014"}</div><div class="l">\u7EC4\u5408\u8282\u70B9</div></div>
        <div class="cell"><div class="n">${stat.entries ?? "\u2014"}</div><div class="l">MASQUE \u63A5\u5165\u70B9</div></div>
        <div class="cell"><div class="n">${stat.freeEdges || "\u2014"}</div><div class="l">WARP \u514D\u8D39\u8FB9\u7F18</div></div>
        <div class="cell"><div class="n">${s.zeroTrust ? stat.teamEdges || "\u2014" : "\u2014"}</div><div class="l">ZT \u56E2\u961F\u8FB9\u7F18</div></div>
        <div class="cell"><div class="n">${stat.landings ?? "\u2014"}</div><div class="l">Opera \u843D\u5730</div></div>
        <div class="cell"><div class="n">${stat.proton || "\u2014"}</div><div class="l">Proton \u843D\u5730</div></div>
        <div class="cell"><div class="n">${stat.wind || "\u2014"}</div><div class="l">Windscribe \u843D\u5730</div></div>
      </div>
      <div class="note">
        \u6BCF\u4E2A\u843D\u5730\u548C\u6BCF\u4E2A\u63A5\u5165\u70B9\u90FD\u7EC4\u5408\u4E00\u904D\uFF0C\u4EFB\u4E00\u73AF\u5931\u6548\u90FD\u8FD8\u6709\u522B\u7684\u8DEF\u8D70\u3002<br>
        \u8282\u70B9\u540D <b>\u6B27\u6D321@198.1-443</b> = \u6B27\u6D32\u7B2C 1 \u4E2A\u843D\u5730\uFF0C\u7ECF 162.159.198.1:443 \u63A5\u5165\u3002<br>
        <b>ZT-</b> \u5F00\u5934\u7684\u662F Zero Trust \u56E2\u961F\u8FB9\u7F18\uFF08162.159.197.x\uFF09\uFF0C\u7528\u56E2\u961F\u5BC6\u94A5\uFF1B
        \u5176\u4F59\u63A5\u5165\u70B9\u7528\u514D\u8D39 WARP \u5BC6\u94A5\u3002<b>\u4E24\u65CF\u5E76\u5B58</b>\uFF0C\u4E00\u65CF\u6574\u4F53\u8FDE\u4E0D\u4E0A\u65F6\u53E6\u4E00\u65CF\u7167\u5E38\u5DE5\u4F5C \u2014\u2014
        \u7528 \u26A1 \u805A\u5408WARP / \u26A1 \u805A\u5408ZT \u5207\u5F00\u6D4B\u4E00\u4E0B\u5EF6\u8FDF\uFF0C\u5C31\u77E5\u9053\u662F\u54EA\u4E00\u65CF\u7684\u95EE\u9898\u3002<br>
        <b>\u6570\u91CF\u5BF9\u4E0D\u4E0A\u5C31\u662F\u5BFC\u5165\u7684\u65E7\u914D\u7F6E</b>\uFF1A\u672C\u4EFD\u5E94\u6709\u514D\u8D39\u8FB9\u7F18 ${stat.freeEdges || 0} \u4E2A\u3001
        ZT \u56E2\u961F\u8FB9\u7F18 ${stat.teamEdges || 0} \u4E2A\u63A5\u5165\u70B9${stat.extraEdges ? `\u3001\u5907\u80CE ${stat.extraEdges} \u4E2A` : ""}\u3002
        \u5BA2\u6237\u7AEF\u91CC\u53EA\u770B\u5230 4 \u4E2A ZT \u8282\u70B9\uFF08\u6216\u514D\u8D39\u8282\u70B9\u660E\u663E\u5C11\u4E00\u622A\uFF09\uFF0C
        \u5C31\u662F\u914D\u7F6E\u6CA1\u66F4\u65B0 \u2014\u2014 \u56DE\u4E0A\u9762\u91CD\u65B0\u590D\u5236\u8BA2\u9605\u94FE\u63A5\u3001\u5BFC\u5165\u4E00\u6B21\u5373\u53EF\u3002
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">\u72B6\u6001</div>
      ${row(
    "\u4E0A\u6B21\u66F4\u65B0",
    updated ? `${fmt(updated)}\uFF08${ago} \u5206\u949F\u524D\uFF09` : "\u5C1A\u672A\u751F\u6210",
    updated ? ago > 250 ? "warn" : "ok" : "err"
  )}
      ${row("\u51ED\u636E\u5269\u4F59", leftTxt, left === null ? "" : left <= 0 ? "warn" : "ok")}
      ${row("\u5230\u671F\u65F6\u95F4", fmt(exp))}
      ${row("\u5BC6\u7801\u66F4\u65B0\u4E8E", cred && cred.updatedAt ? fmt(new Date(cred.updatedAt)) : "\u2014")}
      ${row(
    "\u514D\u8D39 WARP \u8BBE\u5907",
    warp.deviceId ? warp.deviceId.slice(0, 8) + "\u2026" : "\u672A\u6CE8\u518C\uFF08\u514D\u8D39\u8FB9\u7F18\u65CF\u4E0D\u53EF\u7528\uFF09",
    warp.deviceId ? "ok" : "warn"
  )}
      ${row(
    "\u514D\u8D39 WARP \u6CE8\u518C\u4E8E",
    warp.registeredAt ? fmt(new Date(warp.registeredAt)) : "\u2014"
  )}
      ${row("\u514D\u8D39 WARP \u5185\u7F51", warp.ipv4 || "\u2014")}
      ${ztDevice ? row("ZT \u56E2\u961F\u8BBE\u5907", ztDevice.deviceId ? ztDevice.deviceId.slice(0, 8) + "\u2026" : "\u2014", "ok") + row("ZT \u6CE8\u518C\u4E8E", ztDevice.registeredAt ? fmt(new Date(ztDevice.registeredAt)) : "\u2014") + row("ZT \u5185\u7F51", ztDevice.ipv4 || "\u2014") : row("ZT \u56E2\u961F\u8BBE\u5907", "\u672A\u6CE8\u518C\uFF08\u53EA\u6709\u514D\u8D39\u8FB9\u7F18\u90A3\u4E00\u65CF\uFF09", "warn")}
      ${s.warpErr ? row("\u514D\u8D39 WARP \u6CE8\u518C\u9519\u8BEF", s.warpErr, "err") : ""}
    </div>

    <div class="sec">
      <div class="sec-t">\u64CD\u4F5C</div>
      <div class="sub">
        <button onclick="go('/api/refresh')">\u5237\u65B0 Opera \u51ED\u636E</button>
        <button class="gh" onclick="go('/api/reset-warp')">\u91CD\u6CE8\u518C\u514D\u8D39 WARP</button>
      </div>
      <div class="note">
        Opera \u51ED\u636E 4 \u5C0F\u65F6\u5230\u671F\u3002<b>\u4E0D\u7528\u5B9A\u65F6\u4EFB\u52A1</b>\u2014\u2014\u8BA2\u9605\u88AB\u8BBF\u95EE\u65F6\u624D\u68C0\u67E5\uFF0C
        \u6CA1\u8FC7\u671F\u76F4\u63A5\u7ED9\u7F13\u5B58\uFF0C\u8FC7\u671F\u4E86\u624D\u91CD\u65B0\u6CE8\u518C\u3002<br>
        \u60F3\u63D0\u524D\u6362\u4E00\u4EFD\u5C31\u70B9\u5237\u65B0\u3002<br>
        \u4E24\u4EFD WARP \u8BBE\u5907\u90FD\u5B58\u5728 KV \u91CC\u590D\u7528\uFF0C<b>\u4E00\u822C\u4E0D\u7528\u91CD\u6CE8\u518C</b>\u3002\u514D\u8D39\u8FB9\u7F18\u90A3\u4E00\u65CF\u6574\u4F53
        \u8FDE\u4E0D\u4E0A\u65F6\u624D\u70B9\u300C\u91CD\u6CE8\u518C\u514D\u8D39 WARP\u300D\u2014\u2014\u5B83\u53EA\u6362\u514D\u8D39\u90A3\u4EFD\uFF0C<b>Zero Trust \u90A3\u4EFD\u4E0D\u52A8</b>\u3002<br>
        Zero Trust \u8981\u6362\u8BBE\u5907\u5F97\u70B9\u300C\u6E05\u9664 ZT\u300D\u518D\u7C98\u4E00\u4EFD\u65B0 JWT\uFF08JWT \u53EA\u6709 60 \u79D2\u5BFF\u547D\uFF0C\u4E0D\u80FD\u9759\u9ED8\u91CD\u6CE8\u518C\uFF09\u3002
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">\u8BBE\u5907\u5B58\u6D3B\u4F53\u68C0 \xB7 \u7ED9\u300C\u6574\u65CF\u8282\u70B9\u5168\u6B7B\u300D\u5B9A\u4F4D</div>
      ${devRows.map((r) => {
    const d = r.d, it = diagMap[r.role] || null;
    const id = d.deviceId ? " \xB7 " + d.deviceId.slice(0, 8) + "\u2026" : "";
    const ip = d.ipv4 ? " \xB7 " + d.ipv4 : "";
    return `<div class="row"><span class="k">${r.role}</span><span class="v" style="${tone(it ? it.ok : void 0)}">${word(it ? it.ok : void 0)}${id}${ip}</span></div>`;
  }).join("")}
      ${devRows.length ? "" : '<div class="row"><span class="k">\u8BBE\u5907</span><span class="v" style="color:var(--yellow)">KV \u91CC\u4E00\u53F0\u8BBE\u5907\u90FD\u6CA1\u6709\uFF0C\u56DE\u4E0A\u9762\u300C\u64CD\u4F5C\u300D\u70B9\u5237\u65B0\u751F\u6210</span></div>'}
      ${diagItems.length ? `
      <div class="note" style="margin-top:12px">
        <b>\u6700\u8FD1\u4E00\u6B21\u4F53\u68C0</b>\uFF08${diagAgo <= 0 ? "\u521A\u521A" : diagAgo + " \u5206\u949F\u524D"}\uFF09\uFF1A<br>
        ${diagItems.map((it) => `\xB7 ${it.role} \u2014 <b style="${tone(it.ok)};font-weight:400">${word(it.ok)}</b>` + (it.error ? `\uFF08${it.error}\uFF09` : "")).join("<br>")}
      </div>` : ""}
      <div class="sub" style="margin-top:12px">
        <button onclick="go('/api/diag')">\u8BBE\u5907\u4F53\u68C0</button>
        <button class="gh" onclick="go('/api/warp/repair')">\u4E00\u952E\u4FEE\u590D\u514D\u8D39\u65CF</button>
        <button class="gh" onclick="go('/api/warp/rekey')">\u91CD\u88C5\u514D\u8D39\u5BC6\u94A5</button>
        <button class="gh" onclick="go('/api/warp/add')">\uFF0B \u5907\u80CE</button>
        <button class="gh" onclick="go('/api/warp/remove')">\u2212 \u5907\u80CE</button>
      </div>
      <div class="note">
        <b>\u4E3A\u4EC0\u4E48\u6574\u65CF\u4F1A\u4E00\u8D77\u6B7B</b>\uFF1A\u514D\u8D39\u8FB9\u7F18\u90A3 ${stat.freeEdges || 0} \u4E2A\u8282\u70B9
        <b>\u5171\u7528\u540C\u4E00\u53F0\u8BBE\u5907\u7684\u4E00\u628A\u5BC6\u94A5</b>\u3002\u90A3\u53F0\u8BBE\u5907\u88AB CF \u5220\u9664\u6216\u540A\u9500\u65F6\uFF0C\u6574\u65CF\u77AC\u95F4\u5168\u6B7B \u2014\u2014
        \u5BA2\u6237\u7AEF\u53EA\u4F1A\u663E\u793A\u4E00\u7247\u8D85\u65F6\uFF0C\u770B\u8D77\u6765\u5C31\u662F\u300CWARP \u8282\u70B9\u5168\u6B7B\u4E86\u3001\u53EA\u5269 ZT \u80FD\u7528\u300D\u3002
        \u5907\u80CE\u5B58\u5728\u7684\u610F\u4E49\u5C31\u662F\u7ED9\u8FD9\u4E00\u65CF\u4E0A\u5197\u4F59\uFF1A\u4E3B\u529B\u6302\u4E86\uFF0C\u5907\u80CE\u7684\u8282\u70B9\u8FD8\u5728
        \u300C\u267B\uFE0F \u81EA\u52A8\u9009\u62E9\u300D\u7684\u6D4B\u901F\u6C60\u91CC\uFF0C\u4E0D\u4F1A\u6574\u65CF\u5168\u7EA2\u3002<br>
        <b>\u300C\u8BBE\u5907\u4F53\u68C0\u300D</b>\uFF1A\u62FF device token \u53BB CF \u95EE\u300C\u8FD9\u53F0\u8BBE\u5907\u8FD8\u5728\u5417\u300D\u3002
        <b>\u53EA\u80FD\u67E5\u51FA\u5BC6\u94A5\u4F5C\u4E0D\u4F5C\u6570\uFF0C\u67E5\u4E0D\u51FA\u67D0\u4E2A\u63A5\u5165\u70B9\u901A\u4E0D\u901A</b> \u2014\u2014
        Worker \u6CA1\u6709 UDP \u51FA\u7AD9\uFF0C\u8DD1\u4E0D\u4E86 QUIC\uFF0C\u66FF\u5BA2\u6237\u7AEF\u505A\u4E0D\u4E86\u771F\u5B9E\u63E1\u624B\u3002
        \u6240\u4EE5\u522B\u62FF\u4F53\u68C0\u7ED3\u679C\u5F53\u6D4B\u901F\u7ED3\u8BBA\u3002<br>
        <b>\u300C\u4E00\u952E\u4FEE\u590D\u514D\u8D39\u65CF\u300D</b>\uFF1A\u628A\u88AB CF \u5220\u6389\u7684\u514D\u8D39\u8BBE\u5907\uFF08\u4E3B\u529B + \u5907\u80CE\uFF09\u9759\u9ED8\u91CD\u6CE8\u518C\u6362\u65B0\uFF0C
        \u8FD8\u6D3B\u7740\u7684\u539F\u6837\u4E0D\u52A8\u3002Zero Trust \u90A3\u4EFD\u4FEE\u4E0D\u4E86 \u2014\u2014 \u91CD\u6CE8\u518C\u8981\u4E00\u4E2A\u65B0\u7684 60 \u79D2 JWT\uFF0C
        \u5F97\u56DE\u4E0B\u9762\u300CZero Trust\u300D\u533A\u5757\u7C98\u4E00\u4EFD\u3002<br>
        <b>\u300C\u91CD\u88C5\u514D\u8D39\u5BC6\u94A5\u300D</b>\uFF1A\u8BBE\u5907\u5728 CF \u90A3\u8FB9\u8FD8\u6D3B\u7740\u3001\u4F46\u672C\u5730\u8FD9\u628A\u5BC6\u94A5\u8BA4\u8BC1\u4E0D\u8FC7\u65F6\u7528\u3002
        \u4E0D\u6362 deviceId\uFF0C\u6BD4\u91CD\u65B0\u6CE8\u518C\u6E29\u548C\u3002\u5BA2\u6237\u7AEF\u62A5
        <code>CRYPTO_ERROR 0x131 (remote): tls: access denied</code> \u5C31\u662F\u8FD9\u79CD\u3002<br>
        <b>\u300C\uFF0B / \u2212 \u5907\u80CE\u300D</b>\uFF1A\u52A0\u51CF\u514D\u8D39\u5907\u80CE\uFF08\u53E6\u4E00\u4E2A\u8D26\u53F7\u3001\u53E6\u4E00\u628A\u5BC6\u94A5\uFF09\uFF0C\u6700\u591A ${MAX_EXTRA_DEVICES} \u53F0\u3002
        \u5F53\u524D ${stat.extraDevices || 0} \u53F0\u3001${stat.extraEdges || 0} \u4E2A\u63A5\u5165\u70B9\u3002
        \u5907\u80CE\u53EA\u51FA 443 / 8095 \u4E24\u4E2A\u7AEF\u53E3\uFF0C\u4E14\u53EA\u6709\u524D 2 \u53F0\u8FDB\u81EA\u52A8\u6D4B\u901F\u6C60 \u2014\u2014
        \u624B\u673A\u4E0A\u6BCF\u591A\u4E00\u4E2A\u6210\u5458\u5C31\u591A\u4E00\u6B21\u5E76\u53D1 QUIC \u63E1\u624B\uFF0C\u6C60\u5B50\u5FC5\u987B\u538B\u4F4F\u3002
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">Zero Trust \u56E2\u961F\u8FB9\u7F18\uFF08\u548C\u514D\u8D39 WARP \u5E76\u5B58\uFF09</div>
      ${ztDevice ? `
      <div class="row"><span class="k">\u72B6\u6001</span><span class="v ok">\u5DF2\u542F\u7528 ${ztDevice.accountType || "team"}</span></div>
      <div class="row"><span class="k">\u8BBE\u5907</span><span class="v">${ztDevice.deviceId ? ztDevice.deviceId.slice(0, 8) + "\u2026" : "\u2014"}</span></div>
      <div class="row"><span class="k">\u6CE8\u518C\u4E8E</span><span class="v">${ztDevice.registeredAt ? fmt(new Date(ztDevice.registeredAt)) : "\u2014"}</span></div>
      <div class="row"><span class="k">\u56E2\u961F\u8FB9\u7F18\u8282\u70B9</span><span class="v ok">${stat.teamEdges || 0} \u4E2A\uFF08162.159.197.x\uFF09</span></div>
      <div class="row"><span class="k">\u514D\u8D39\u8FB9\u7F18\u8282\u70B9</span><span class="v ok">${stat.freeEdges || 0} \u4E2A\uFF08198/199\uFF0C\u72EC\u7ACB\u5BC6\u94A5\uFF09</span></div>
      ` : `
      <div class="row"><span class="k">\u72B6\u6001</span><span class="v warn">\u672A\u542F\u7528\uFF08\u53EA\u6709\u514D\u8D39\u8FB9\u7F18\u90A3\u4E00\u65CF\uFF09</span></div>
      `}
      <div class="note" style="margin-bottom:10px">
        Zero Trust \u6CE8\u518C\u7684\u662F<b>\u53E6\u4E00\u53F0\u8BBE\u5907</b>\uFF0C\u8D70<b>\u56E2\u961F\u8FB9\u7F18 162.159.197.x</b>\uFF0C
        \u5B9E\u6D4B\u6BD4 198/199 \u90A3\u6279\u514D\u8D39\u8FB9\u7F18\u66F4\u7A33\uFF0C\u8FDE\u65AD\u90FD\u5C11\u3002\u514D\u8D39\u5957\u9910 50 \u4E2A\u5E2D\u4F4D\uFF0C\u4E0D\u9650\u901F\u3002<br>
        <b>\u5173\u952E\uFF1A\u4E24\u4EFD\u8BBE\u5907\u5E76\u5B58\uFF0C\u4E0D\u662F\u4E8C\u9009\u4E00\u3002</b>CF \u90A3\u8FB9\u4E24\u5957\u5BC6\u94A5\u5206\u5F00\u8BA4\u8BC1 \u2014\u2014
        \u56E2\u961F\u5BC6\u94A5\u5582\u4E0D\u8FDB\u514D\u8D39\u8FB9\u7F18\uFF0C\u514D\u8D39\u5BC6\u94A5\u4E5F\u8BA4\u8BC1\u4E0D\u8FC7\u56E2\u961F\u8FB9\u7F18\u3002\u6240\u4EE5
        Zero Trust \u542F\u7528\u540E\uFF0C\u514D\u8D39\u8FB9\u7F18\u90A3 57 \u4E2A\u8282\u70B9<b>\u7167\u6837\u5728\u3001\u7167\u6837\u80FD\u7528</b>\uFF0C
        Proton / Windscribe / Opera \u90A3\u4E9B\u843D\u5730\u7684\u9996\u8DF3\u4F1A\u6A2A\u8DE8\u4E24\u65CF\uFF0C
        \u54EA\u4E00\u65CF\u6574\u4F53\u6302\u6389\u90FD\u8FD8\u6709\u4E00\u534A\u843D\u5730\u80FD\u7528\u3002<br>
        <b>\u5173\u4E8E\u9009\u56FD\u5BB6\u8981\u8BF4\u6E05\u695A</b>\uFF1AZero Trust \u514D\u8D39\u7248<b>\u4E0D\u80FD</b>\u76F4\u63A5\u9009\u51FA\u53E3\u56FD\u5BB6\uFF0C
        \u51FA\u53E3\u4ECD\u7531 Cloudflare \u4EFB\u64AD\u5C31\u8FD1\u843D\uFF08\u591A\u534A\u662F\u65E7\u91D1\u5C71\uFF09\u3002\u8981\u9009\u56FD\u5BB6\u8D70\u7684\u662F\u4E0B\u9762
        Proton / Windscribe / Opera \u90A3\u51E0\u6761\u843D\u5730\uFF0CZero Trust \u662F\u628A\u5B83\u4EEC\u7684\u9AA8\u5E72
        \u6362\u5FEB\u6362\u7A33\u3002\u7EC4\u5408\u8D77\u6765\u5C31\u662F\u300C\u5FEB\u7684\u9AA8\u5E72 + \u80FD\u9009\u56FD\u5BB6\u300D\u3002
      </div>
      <div class="f" style="display:flex;flex-direction:column;gap:8px">
        <input id="zt" placeholder="\u7C98 Team Token (JWT) \u2014\u2014 \u53EA\u6709 60 \u79D2\u5BFF\u547D\uFF0C\u62FF\u5230\u7ACB\u523B\u7C98"
               spellcheck="false" autocomplete="off">
        <div class="sub" style="margin-top:0">
          <button onclick="enrollZt()">\u7ACB\u5373\u6CE8\u518C</button>
          ${ztDevice ? `<button class="gh" onclick="go('/api/zt/clear')">\u6E05\u9664 ZT\uFF08\u53EA\u6458\u56E2\u961F\u8FB9\u7F18\u90A3\u65CF\uFF09</button>` : ""}
        </div>
      </div>
      <div class="note">
        <b>\u600E\u4E48\u62FF JWT</b>\uFF1A\u6D4F\u89C8\u5668\u5F00 <code>https://&lt;\u4F60\u7684\u56E2\u961F\u540D&gt;.cloudflareaccess.com/warp</code>\uFF0C
        \u5B8C\u6210\u90AE\u7BB1\u9A8C\u8BC1\u7801\u767B\u5F55\uFF0C\u5728\u6210\u529F\u9875\u9762\u7684\u6E90\u7801\u91CC\u627E <code>meta http-equiv="refresh"</code>\uFF0C
        <code>token=</code> \u540E\u9762\u90A3\u4E32\u5C31\u662F\u3002\u6216\u8005\u63A7\u5236\u53F0\u8DD1
        <code>document.querySelector("meta[http-equiv='refresh']").content.split("=")[2]</code>\u3002<br>
        \u62FF\u5230<b>\u7ACB\u523B</b>\u7C98\u8FDB\u6765\u70B9\u6CE8\u518C\uFF0C\u8D85\u8FC7 60 \u79D2\u5C31\u5931\u6548\uFF0C\u4F1A\u62A5\u300C\u6CE8\u518C\u5230\u7684\u662F free \u8D26\u6237\u300D\u3002
        \u6CE8\u518C\u6210\u529F\u540E\u8BBE\u5907\u957F\u671F\u6709\u6548\uFF0C\u4E0D\u7528\u53CD\u590D\u7C98\u3002
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">Proton \u843D\u5730</div>
      ${protonCred ? `
      <div class="row"><span class="k">\u72B6\u6001</span><span class="v ok">\u5DF2\u914D\u7F6E ${protonCred.servers.length} \u53F0</span></div>
      <div class="row"><span class="k">\u8BC1\u4E66\u5269\u4F59</span><span class="v ${pLeft <= 1 ? "warn" : "ok"}">${pLeft} \u5929\uFF08${pExp.toISOString().slice(0, 10)} \u5230\u671F\uFF09</span></div>
      ` : `
      <div class="row"><span class="k">\u72B6\u6001</span><span class="v warn">\u672A\u914D\u7F6E</span></div>
      `}
      <div class="note" style="margin-bottom:10px">
        Proton \u8981\u8D26\u53F7\u767B\u5F55\uFF0CWorker \u91CC\u505A\u4F1A\u88AB\u98CE\u63A7\u62E6\uFF0C\u6240\u4EE5\u8D70 GitHub Actions \u53D6\u8BC1\u4E66\u518D\u63A8\u8FC7\u6765\u3002
        \u8BC1\u4E66<b>\u6700\u957F 7 \u5929</b>\uFF0C\u5230\u671F\u91CD\u8DD1\u4E00\u6B21\u6D41\u6C34\u7EBF\u5373\u53EF\u3002
      </div>
      <div class="sub">
        <input id="pu" value="${pushUrl || "\u70B9\u53F3\u8FB9\u751F\u6210"}" readonly>
        <button onclick="cp('pu')">\u590D\u5236</button>
        <button class="gh" onclick="go('/api/proton/token')">${pushToken ? "\u6362\u4E00\u4E2A" : "\u751F\u6210"}</button>
      </div>
      <div class="note">
        \u628A\u8FD9\u4E2A\u5730\u5740\u586B\u8FDB GitHub \u4ED3\u5E93 Secrets \u7684 <b>WORKER_PUSH_URL</b>\uFF0C\u5C31\u8FD9\u4E00\u4E2A\u3002<br>
        \u7136\u540E\u8DD1 <b>\u53D6 Proton \u51ED\u636E</b> \u6D41\u6C34\u7EBF\uFF0C\u4E4B\u540E\u6BCF 3 \u5929\u81EA\u52A8\u7EED\uFF0C\u4E0D\u7528\u518D\u7BA1\u3002<br>
        <b>\u53D6 Windscribe \u8D26\u53F7</b> \u90A3\u6761\u4E5F\u7528\u540C\u4E00\u4E2A\u5730\u5740\uFF0C\u5B83\u4F1A\u81EA\u5DF1\u5728\u672B\u5C3E\u52A0 <code>/wind</code>\u3002<br>
        \u5730\u5740\u91CC\u5E26\u4EE4\u724C\uFF0C\u53EA\u80FD\u5199 Proton \u51ED\u636E\u3001\u52A8\u4E0D\u4E86\u7BA1\u7406\u9875\uFF1B\u6CC4\u9732\u4E86\u70B9\u300C\u6362\u4E00\u4E2A\u300D\u3002
        ${protonCred ? `<br><a href="#" onclick="go('/api/proton/clear');return false" style="color:var(--red)">\u6E05\u9664 Proton \u51ED\u636E</a>` : ""}
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">Windscribe \u843D\u5730</div>
      ${windInfo ? `
      <div class="row"><span class="k">\u72B6\u6001</span><span class="v ok">\u5DF2\u6CE8\u518C ${windInfo.servers} \u53F0</span></div>
      <div class="row"><span class="k">\u8D26\u53F7</span><span class="v">${windInfo.userId}</span></div>
      ${windUsageTxt ? `<div class="row"><span class="k">\u672C\u6708\u6D41\u91CF</span><span class="v ${windPct > 90 ? "warn" : "ok"}">${windUsageTxt}</span></div>` : ""}
      ` : `
      <div class="row"><span class="k">\u72B6\u6001</span><span class="v warn">\u672A\u542F\u7528</span></div>
      `}
      <div class="note">
        \u514D\u8D39\u989D\u5EA6 <b>\u6BCF\u6708 2GB</b>\uFF0C\u843D\u5730\u662F\u673A\u623F IP\uFF08M247 \u4E3A\u4E3B\uFF09\uFF0C
        13 \u4E2A\u5730\u533A\u91CC<b>\u4E9A\u6D32\u53EA\u6709\u9999\u6E2F</b>\u3002<br>
        \u8D26\u53F7\u8D70 GitHub Actions \u5F00 \u2014\u2014 Worker \u81EA\u5DF1\u5F00\u4E0D\u51FA\u80FD\u7528\u7684\u53F7\uFF0C
        Cloudflare \u7684\u51FA\u53E3 IP \u662F\u5171\u4EAB\u7684\uFF0C\u65E9\u88AB\u4EBA\u7528\u8FC7\uFF0C
        Windscribe \u53EA\u4F1A\u53D1 1MB \u7684\u964D\u989D\u53F7\uFF0C\u90A3\u79CD\u53F7\u8FDE\u4EE3\u7406\u51ED\u636E\u90FD\u53D6\u4E0D\u5230\u3002<br>
        \u8DD1\u4E00\u6B21 <b>\u53D6 Windscribe \u8D26\u53F7</b> \u6D41\u6C34\u7EBF\u5C31\u884C\uFF0C\u7528\u7684\u662F\u4E0A\u9762\u90A3\u4E2A\u63A8\u9001\u5730\u5740\u3002
        \u989D\u5EA6\u7528\u5B8C\u4E86\u518D\u8DD1\u4E00\u6B21\u6362\u4E2A\u53F7\u3002
        ${windInfo ? `<br><a href="#" onclick="go('/api/wind/clear');return false" style="color:var(--red)">\u6E05\u9664 Windscribe \u8D26\u53F7</a>` : ""}
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">\u8BA2\u9605\u8DEF\u5F84</div>
      <div class="sub">
        <input id="sp" value="${sp.replace(/^\//, "")}" spellcheck="false"
               placeholder="\u5B57\u6BCD\u6570\u5B57\u548C - _">
        <button onclick="setPath('sp')">\u4FDD\u5B58</button>
      </div>
      <div class="note">
        \u6539\u6210\u96BE\u731C\u7684\u5B57\u7B26\u4E32\uFF0C\u7B49\u4E8E\u5728\u5BC6\u7801\u4E4B\u5916\u591A\u4E00\u5C42\u3002\u6539\u5B8C\u4E0A\u9762\u7684\u8BA2\u9605\u94FE\u63A5\u8981\u91CD\u65B0\u590D\u5236\u3002
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">\u4FEE\u6539\u5BC6\u7801</div>
      <div class="pw">
        <input type="password" id="c0" placeholder="\u5F53\u524D\u5BC6\u7801" autocomplete="current-password">
        <input type="password" id="c1" placeholder="\u65B0\u5BC6\u7801\uFF08>= 8\uFF09" autocomplete="new-password">
        <input type="password" id="c2" placeholder="\u786E\u8BA4\u65B0\u5BC6\u7801" autocomplete="new-password">
        <button onclick="setPw()">\u4FEE\u6539</button>
      </div>
      <div class="note">
        \u6539\u5B8C<b>\u6240\u6709\u65E7\u8BA2\u9605\u94FE\u63A5\u7ACB\u523B\u5931\u6548</b>\uFF0C\u56E0\u4E3A token \u662F\u7528\u5BC6\u7801\u54C8\u5E0C\u7B7E\u7684\u3002
        \u94FE\u63A5\u6CC4\u9732\u4E86\u5C31\u9760\u8FD9\u4E2A\u8865\u6551\u3002
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">\u987B\u77E5</div>
      <div class="note">
        \u5FC5\u987B\u7528 <b>mihomo Alpha</b> \u5185\u6838\uFF0Cmasque \u51FA\u7AD9\u548C dialer-proxy \u7A33\u5B9A\u7248\u90FD\u4E0D\u652F\u6301\u3002<br>
        \u53EF\u7528\u5BA2\u6237\u7AEF\uFF1AClash Verge Rev\uFF08\u5185\u6838\u5207 Alpha\uFF09\u3001ClashMi\u3001FlClash\u3002<br>
        Shadowrocket\u3001Stash \u4E0D\u8BA4 dialer-proxy\uFF0C\u5BFC\u8FDB\u53BB\u53EA\u6709 WARP\u76F4\u8FDE \u90A3\u7EC4\u80FD\u7528\u3002<br>
        \u8BA2\u9605\u94FE\u63A5\u91CC\u7684 token \u5C31\u662F\u8BBF\u95EE\u51ED\u8BC1\uFF0C<b>\u522B\u5916\u4F20</b>\uFF0C\u6CC4\u9732\u4E86\u6539\u5BC6\u7801\u5373\u53EF\u5168\u90E8\u5931\u6548\u3002<br>
        \u914D\u7F6E\u91CC\u7684 private-key \u7B49\u540C WARP \u8D26\u53F7\u51ED\u636E\u3002<br>
        \u514D\u8D39\u4EE3\u7406\u7684\u6D41\u91CF\u5BF9\u63D0\u4F9B\u65B9\u53EF\u89C1\uFF0C\u522B\u8D70\u652F\u4ED8\u548C\u654F\u611F\u6570\u636E\u3002
      </div>
    </div>

  </div></div>
  <div class="foot">
    Cloudflare Worker \u30FB
    <a href="https://github.com/byJoey/warp-masque-actions">GitHub</a> \u30FB
    <a href="https://joeyblog.net">Blog</a>
  </div>
</div>
<script>
function cp(id){
  const el=document.getElementById(id||'u');
  navigator.clipboard.writeText(el.value).then(
    ()=>say('\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F','var(--mint)'),
    ()=>{el.select();document.execCommand('copy');say('\u5DF2\u590D\u5236','var(--mint)')});
}
function say(t,c){
  const m=document.getElementById('msg');
  m.textContent='> '+t; m.style.color=c;
  setTimeout(()=>{m.textContent=''},4000);
}
async function post(url,body,okmsg){
  const bs=document.querySelectorAll('button');
  bs.forEach(b=>b.disabled=true);
  say('\u6267\u884C\u4E2D\u2026','var(--yellow)');
  try{
    const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
                            body:JSON.stringify(body)});
    const j=await r.json();
    if(j.ok){say((j.msg||okmsg)+'\uFF0C\u5373\u5C06\u5237\u65B0','var(--mint)');setTimeout(()=>location.reload(),1400);}
    else{say('\u5931\u8D25: '+j.error,'var(--red)');bs.forEach(b=>b.disabled=false);}
  }catch(e){say('\u5931\u8D25: '+e.message,'var(--red)');bs.forEach(b=>b.disabled=false);}
}
function setPath(id){
  const v=document.getElementById(id||'sp').value.trim();
  if(!v){say('\u8DEF\u5F84\u4E0D\u80FD\u4E3A\u7A7A','var(--red)');return;}
  post('/api/sub-path',{path:v},'\u5DF2\u4FDD\u5B58');
}
function setPw(){
  const c0=document.getElementById('c0').value;
  const c1=document.getElementById('c1').value;
  const c2=document.getElementById('c2').value;
  if(!c0||!c1){say('\u628A\u4E09\u4E2A\u6846\u90FD\u586B\u4E86','var(--red)');return;}
  if(c1!==c2){say('\u4E24\u6B21\u8F93\u5165\u4E0D\u4E00\u81F4','var(--red)');return;}
  if(c1.length<8){say('\u65B0\u5BC6\u7801\u81F3\u5C11 8 \u4F4D','var(--red)');return;}
  post('/api/password',{current:c0,password:c1,confirm:c2},'\u5DF2\u4FEE\u6539');
}
async function go(p){
  const bs=document.querySelectorAll('button');
  bs.forEach(b=>b.disabled=true);
  say('\u6267\u884C\u4E2D\u2026','var(--yellow)');
  try{
    const r=await fetch(p,{method:'POST'});
    const j=await r.json();
    if(j.ok){say(j.msg+'\uFF0C\u5373\u5C06\u5237\u65B0','var(--mint)');setTimeout(()=>location.reload(),1200);}
    else{say('\u5931\u8D25: '+j.error,'var(--red)');bs.forEach(b=>b.disabled=false);}
  }catch(e){say('\u5931\u8D25: '+e.message,'var(--red)');bs.forEach(b=>b.disabled=false);}
}
async function enrollZt(){
  const v=document.getElementById('zt').value.trim();
  if(!v){say('\u628A JWT \u7C98\u8FDB\u6765','var(--red)');return;}
  if(v.length<40){say('\u8FD9\u4E32\u592A\u77ED\uFF0C\u4E0D\u50CF JWT','var(--red)');return;}
  // JWT \u5BFF\u547D 60 \u79D2\uFF0C\u6CE8\u518C\u8981\u8D81\u65E9
  post('/api/zt/enroll',{jwt:v},'\u6CE8\u518C\u4E2D');
}
<\/script>
</body></html>`;
}

// src/auth.js
var enc = new TextEncoder();
var ITER = 1e5;
var b642 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
function safeEqual(a, b) {
  const x = enc.encode(a || "");
  const y = enc.encode(b || "");
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
async function pbkdf2(password, saltB64, iter = ITER) {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    key,
    256
  );
  return b642(bits);
}
async function makeCred(password) {
  const s = new Uint8Array(16);
  crypto.getRandomValues(s);
  const salt = b642(s);
  return {
    salt,
    iter: ITER,
    hash: await pbkdf2(password, salt, ITER),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function checkPassword(cred, password) {
  if (!cred || !cred.hash) return false;
  const h = await pbkdf2(password, cred.salt, cred.iter || ITER);
  return safeEqual(h, cred.hash);
}
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return b642(sig).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
var TTL = 7 * 24 * 3600 * 1e3;
async function signToken(cred) {
  const exp = Date.now() + TTL;
  return `${exp}.${await hmac(cred.hash, String(exp))}`;
}
async function verifyToken(cred, token) {
  if (!cred || !cred.hash || !token || !token.includes(".")) return false;
  const i = token.lastIndexOf(".");
  const exp = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(cred.hash, exp));
}
function readCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
async function rateLimit(env, ip) {
  const key = `rl:${ip}`;
  const n = Number(await env.KV.get(key) || 0);
  if (n >= 8) return false;
  await env.KV.put(key, String(n + 1), { expirationTtl: 900 });
  return true;
}
async function clearRateLimit(env, ip) {
  await env.KV.delete(`rl:${ip}`);
}
function normalizePath(p2) {
  const clean = String(p2 || "").trim().replace(/^\/+|\/+$/g, "");
  if (!clean) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(clean)) return null;
  const reserved = ["login", "logout", "api", "setup"];
  if (reserved.includes(clean.toLowerCase())) return null;
  return clean;
}

// src/index.js
var K_WARP = "warp:device";
var K_WARP_X = "warp:devices:extra";
var K_ZT = "zt:device";
var K_DIAG = "diag:report";
var K_CFG = "config:yaml";
var K_STATE = "state:meta";
var K_CRED = "auth:cred";
var K_SET = "settings";
var K_CLAIM = "auth:claim";
var K_PROTON = "proton:cred";
var K_PUSH = "proton:token";
var K_WIND = "wind:account";
var K_LOCK = "rebuild:lock";
var COOKIE = "om_session";
var DEFAULT_SUB = "sub";
var TTL_MS = 4 * 3600 * 1e3;
var SKEW_MS = 10 * 60 * 1e3;
var json = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s,
  headers: { "content-type": "application/json; charset=utf-8" }
});
var html = (body, s = 200) => new Response(body, {
  status: s,
  headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  }
});
var notFound = () => new Response("Not Found", { status: 404 });
async function getSettings(env) {
  const s = await env.KV.get(K_SET, "json") || {};
  return { subPath: s.subPath || DEFAULT_SUB };
}
async function getWarp(env, force = false) {
  if (!force) {
    const cached = await env.KV.get(K_WARP, "json");
    if (cached && cached.privateKey) return cached;
  }
  const w = await registerWarp("cf-worker");
  await env.KV.put(K_WARP, JSON.stringify(w));
  return w;
}
async function getWind(env) {
  const acc = await env.KV.get(K_WIND, "json");
  if (!acc || !acc.sessionAuthHash) return null;
  return await fetchWindscribe(acc);
}
async function getExtraWarps(env) {
  const arr = await env.KV.get(K_WARP_X, "json");
  if (!Array.isArray(arr)) return [];
  return arr.filter((d) => d && d.privateKey && d.ipv4 && !d.zeroTrust).slice(0, MAX_EXTRA_DEVICES);
}
async function rebuild(env, { forceWarp = false } = {}) {
  let ztDev = await env.KV.get(K_ZT, "json");
  if (ztDev && (!ztDev.privateKey || !ztDev.ipv4)) ztDev = null;
  let warp = null, warpErr = null;
  try {
    warp = await getWarp(env, forceWarp);
  } catch (e) {
    warpErr = e.message;
  }
  if (!warp && !ztDev) {
    throw new Error(`\u6CA1\u6709\u53EF\u7528\u7684 WARP \u8BBE\u5907\uFF1Aconsumer \u6CE8\u518C\u5931\u8D25\uFF08${warpErr || "\u672A\u77E5\u539F\u56E0"}\uFF09\uFF0CZero Trust \u4E5F\u6CA1\u914D`);
  }
  const opera = await fetchOpera();
  let proton = null;
  const pc = await env.KV.get(K_PROTON, "json");
  if (pc && (!pc.expiresAt || pc.expiresAt * 1e3 > Date.now())) proton = pc;
  let wind = null, windErr = null;
  try {
    wind = await getWind(env);
  } catch (e) {
    windErr = e.message;
  }
  const extras = await getExtraWarps(env);
  const {
    yaml,
    entries,
    landings,
    combos,
    proton: pn,
    wind: wn,
    zeroTrust: ztFlag,
    teamEdges,
    freeEdges,
    extraDevices,
    extraEdges
  } = buildConfig(warp, opera, proton, wind, ztDev, extras);
  const now = Date.now();
  const devInfo = (d) => d ? {
    deviceId: d.deviceId,
    ipv4: d.ipv4,
    ipv6: d.ipv6,
    registeredAt: d.registeredAt,
    zeroTrust: !!d.zeroTrust,
    accountType: d.accountType || ""
  } : null;
  const state = {
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
    stats: {
      entries,
      landings,
      combos,
      proton: pn || 0,
      wind: wn || 0,
      teamEdges: teamEdges || 0,
      freeEdges: freeEdges || 0,
      extraDevices: extraDevices || 0,
      extraEdges: extraEdges || 0
    },
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
    diag: await env.KV.get(K_DIAG, "json")
  };
  await env.KV.put(K_CFG, yaml);
  await env.KV.put(K_STATE, JSON.stringify(state));
  return state;
}
function isFresh(state) {
  if (!state || !state.expiresAt) return false;
  return Date.parse(state.expiresAt) - SKEW_MS > Date.now();
}
async function ensureConfig(env) {
  const state = await env.KV.get(K_STATE, "json");
  const yaml = await env.KV.get(K_CFG);
  if (yaml && isFresh(state)) return yaml;
  const lock = await env.KV.get(K_LOCK);
  if (lock && Date.now() - Number(lock) < 9e4) {
    if (yaml) return yaml;
  } else {
    await env.KV.put(K_LOCK, String(Date.now()), { expirationTtl: 120 });
    try {
      await rebuild(env);
    } finally {
      await env.KV.delete(K_LOCK);
    }
  }
  return await env.KV.get(K_CFG) || yaml;
}
var index_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const ip = req.headers.get("cf-connecting-ip") || "unknown";
    if (!env || !env.KV) return html(renderNoKV(), 500);
    const cred = await env.KV.get(K_CRED, "json");
    const authed = cred && await verifyToken(cred, readCookie(req, COOKIE));
    if (!cred) {
      if (path === "/api/setup" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const pw = String(body.password || "");
        if (pw.length < 8) return json({ ok: false, error: "\u5BC6\u7801\u81F3\u5C11 8 \u4F4D" }, 400);
        if (pw !== body.confirm) return json({ ok: false, error: "\u4E24\u6B21\u8F93\u5165\u4E0D\u4E00\u81F4" }, 400);
        const claim = crypto.randomUUID();
        if (await env.KV.get(K_CRED)) {
          return json({ ok: false, error: "\u5BC6\u7801\u5DF2\u88AB\u8BBE\u7F6E\uFF0C\u8BF7\u5237\u65B0\u9875\u9762" }, 409);
        }
        await env.KV.put(K_CLAIM, claim, { expirationTtl: 60 });
        if (await env.KV.get(K_CLAIM) !== claim) {
          return json({ ok: false, error: "\u5BC6\u7801\u5DF2\u88AB\u8BBE\u7F6E\uFF0C\u8BF7\u5237\u65B0\u9875\u9762" }, 409);
        }
        const c = await makeCred(pw);
        if (await env.KV.get(K_CRED)) {
          return json({ ok: false, error: "\u5BC6\u7801\u5DF2\u88AB\u8BBE\u7F6E\uFF0C\u8BF7\u5237\u65B0\u9875\u9762" }, 409);
        }
        await env.KV.put(K_CRED, JSON.stringify(c));
        await env.KV.delete(K_CLAIM);
        const token = await signToken(c);
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 3600}`
          }
        });
      }
      if (path === "/") return html(renderSetup());
      return notFound();
    }
    const settings = await getSettings(env);
    const subPath = "/" + settings.subPath;
    if (path === subPath) {
      const t = url.searchParams.get("token") || "";
      if (!await verifyToken(cred, t) && !authed) return notFound();
      const yaml = await ensureConfig(env);
      if (!yaml) {
        return new Response(
          "\u914D\u7F6E\u751F\u6210\u5931\u8D25\uFF0C\u7A0D\u540E\u91CD\u8BD5\u6216\u5230\u7BA1\u7406\u9875\u624B\u52A8\u5237\u65B0",
          { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }
        );
      }
      return new Response(yaml, {
        headers: {
          "content-type": "text/yaml; charset=utf-8",
          // 文件名不加引号：部分客户端不解析引号，会把 \"x\" 当成文件名的一部分
          "content-disposition": "attachment; filename=opera-masque.yaml",
          "profile-update-interval": "4",
          "cache-control": "no-store"
        }
      });
    }
    if (path.startsWith("/push/") && req.method === "POST") {
      const tk = await env.KV.get(K_PUSH);
      const rest = path.slice(6);
      const slash = rest.indexOf("/");
      const got = slash < 0 ? rest : rest.slice(0, slash);
      const kind = slash < 0 ? "proton" : rest.slice(slash + 1);
      if (!tk || !got || !safeEqual(got, tk)) return notFound();
      const body = await req.text();
      if (kind === "wind") {
        let acc;
        try {
          acc = JSON.parse(body);
        } catch {
          return json({ ok: false, error: "\u4E0D\u662F\u5408\u6CD5\u7684 JSON" }, 400);
        }
        if (!acc || !acc.sessionAuthHash || !acc.locHash) {
          return json({ ok: false, error: "\u7F3A sessionAuthHash \u6216 locHash" }, 400);
        }
        if (acc.status !== void 0 && acc.status !== 1) {
          return json({ ok: false, error: `\u8D26\u53F7 status=${acc.status}\uFF0C\u662F\u88AB\u964D\u989D\u7684\u53F7\uFF0C\u6CA1\u6CD5\u7528` }, 400);
        }
        await env.KV.put(K_WIND, JSON.stringify(acc));
        try {
          const st = await rebuild(env);
          return json({ ok: true, msg: `\u5DF2\u5199\u5165 Windscribe \u8D26\u53F7\uFF0C${st.stats.wind} \u53F0\u843D\u5730` });
        } catch (e) {
          return json({ ok: true, msg: "\u8D26\u53F7\u5DF2\u5199\u5165\uFF0C\u4F46\u91CD\u5EFA\u914D\u7F6E\u5931\u8D25\uFF1A" + e.message });
        }
      }
      if (kind === "zt") {
        let dev;
        try {
          dev = JSON.parse(atob(body.trim()));
        } catch {
          return json({ ok: false, error: "\u4E0D\u662F\u5408\u6CD5\u7684 base64 JSON" }, 400);
        }
        if (!dev || !dev.privateKey || !dev.ipv4) {
          return json({ ok: false, error: "\u7F3A privateKey \u6216 ipv4" }, 400);
        }
        if (dev.v !== 1) {
          return json({ ok: false, error: `\u4E0D\u8BA4\u8BC6\u7684\u7248\u672C v${dev.v}` }, 400);
        }
        dev.zeroTrust = true;
        if (!dev.accountType) dev.accountType = "team";
        await env.KV.put(K_ZT, JSON.stringify(dev));
        try {
          const st = await rebuild(env);
          return json({
            ok: true,
            msg: `\u5DF2\u5199\u5165 Zero Trust \u8BBE\u5907\uFF0C${st.stats.teamEdges} \u4E2A\u56E2\u961F\u8FB9\u7F18\u5DF2\u52A0\u5165`
          });
        } catch (e) {
          return json({ ok: true, msg: "\u8BBE\u5907\u5DF2\u5199\u5165\uFF0C\u4F46\u91CD\u5EFA\u914D\u7F6E\u5931\u8D25\uFF1A" + e.message });
        }
      }
      let parsed;
      try {
        parsed = parseBlob(body);
      } catch (e) {
        return json({ ok: false, error: e.message }, 400);
      }
      await env.KV.put(K_PROTON, JSON.stringify(parsed));
      try {
        const st = await rebuild(env);
        return json({
          ok: true,
          msg: `\u5DF2\u5199\u5165 ${parsed.servers.length} \u53F0 Proton \u843D\u5730`,
          combos: st.stats.combos,
          proton: st.stats.proton
        });
      } catch (e) {
        return json({ ok: true, msg: "\u51ED\u636E\u5DF2\u5199\u5165\uFF0C\u4F46\u91CD\u5EFA\u914D\u7F6E\u5931\u8D25\uFF1A" + e.message });
      }
    }
    if (path === "/login" && req.method === "POST") {
      if (!await rateLimit(env, ip)) {
        return json({ ok: false, error: "\u5C1D\u8BD5\u8FC7\u591A\uFF0C15 \u5206\u949F\u540E\u518D\u8BD5" }, 429);
      }
      const body = await req.json().catch(() => ({}));
      if (!await checkPassword(cred, String(body.password || ""))) {
        return json({ ok: false, error: "\u5BC6\u7801\u9519\u8BEF" }, 401);
      }
      await clearRateLimit(env, ip);
      const token = await signToken(cred);
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 3600}`
        }
      });
    }
    if (path === "/logout") {
      return new Response(null, {
        status: 302,
        headers: {
          location: "/",
          "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
        }
      });
    }
    if (path === "/") {
      if (!authed) return html(renderLogin());
      const state = await env.KV.get(K_STATE, "json");
      const token = await signToken(cred);
      const pushToken = await env.KV.get(K_PUSH);
      const protonCred = await env.KV.get(K_PROTON, "json");
      const ztDevice = await env.KV.get(K_ZT, "json");
      let windUsage = null;
      const wa = await env.KV.get(K_WIND, "json");
      if (wa && wa.sessionAuthHash) {
        try {
          windUsage = await fetchSession(wa);
        } catch {
          windUsage = null;
        }
      }
      return html(renderUI(
        state,
        url.host,
        subPath,
        token,
        cred,
        pushToken,
        protonCred,
        windUsage,
        ztDevice
      ));
    }
    if (!authed) return notFound();
    if (path === "/api/state") {
      return json(await env.KV.get(K_STATE, "json") || {});
    }
    if (path === "/api/proton/token" && req.method === "POST") {
      const t = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      await env.KV.put(K_PUSH, t);
      return json({ ok: true, token: t, msg: "\u4EE4\u724C\u5DF2\u66F4\u65B0\uFF0C\u65E7\u7684\u7ACB\u5373\u5931\u6548" });
    }
    if (path === "/api/proton/clear" && req.method === "POST") {
      await env.KV.delete(K_PROTON);
      try {
        await rebuild(env);
      } catch {
      }
      return json({ ok: true, msg: "Proton \u51ED\u636E\u5DF2\u6E05\u9664" });
    }
    if (path === "/api/sub-path" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const p2 = normalizePath(body.path);
      if (!p2) {
        return json({
          ok: false,
          error: "\u53EA\u80FD\u7528\u5B57\u6BCD\u6570\u5B57\u548C - _\uFF0C1-64 \u4F4D\uFF0C\u4E14\u4E0D\u80FD\u662F login/logout/api/setup"
        }, 400);
      }
      await env.KV.put(K_SET, JSON.stringify({ ...settings, subPath: p2 }));
      return json({ ok: true, msg: `\u8BA2\u9605\u8DEF\u5F84\u5DF2\u6539\u4E3A /${p2}` });
    }
    if (path === "/api/password" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (!await checkPassword(cred, String(body.current || ""))) {
        return json({ ok: false, error: "\u5F53\u524D\u5BC6\u7801\u4E0D\u5BF9" }, 401);
      }
      const pw = String(body.password || "");
      if (pw.length < 8) return json({ ok: false, error: "\u65B0\u5BC6\u7801\u81F3\u5C11 8 \u4F4D" }, 400);
      if (pw !== body.confirm) return json({ ok: false, error: "\u4E24\u6B21\u8F93\u5165\u4E0D\u4E00\u81F4" }, 400);
      const c = await makeCred(pw);
      await env.KV.put(K_CRED, JSON.stringify(c));
      const token = await signToken(c);
      return new Response(
        JSON.stringify({ ok: true, msg: "\u5BC6\u7801\u5DF2\u6539\uFF0C\u65E7\u7684\u8BA2\u9605\u94FE\u63A5\u5168\u90E8\u5931\u6548" }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 3600}`
          }
        }
      );
    }
    if (path === "/api/refresh" && req.method === "POST") {
      try {
        const s = await rebuild(env);
        return json({ ok: true, msg: `\u5DF2\u5237\u65B0\uFF0C${s.stats.combos} \u4E2A\u7EC4\u5408` });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (path === "/api/reset-warp" && req.method === "POST") {
      const ztDev = await env.KV.get(K_ZT, "json");
      try {
        const s = await rebuild(env, { forceWarp: true });
        return json({
          ok: true,
          msg: `\u514D\u8D39 WARP \u5DF2\u91CD\u6CE8\u518C\uFF0C\u514D\u8D39\u8FB9\u7F18 ${s.stats.freeEdges || 0} \u4E2A` + (ztDev ? "\uFF1BZero Trust \u90A3\u4EFD\u6CA1\u52A8" : "")
        });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (path === "/api/diag" && req.method === "POST") {
      const warp = await env.KV.get(K_WARP, "json");
      const ztDev = await env.KV.get(K_ZT, "json");
      const extras = await getExtraWarps(env);
      const roles = [
        warp ? { role: "\u514D\u8D39 WARP\uFF08\u4E3B\u529B\uFF09", dev: warp } : null,
        ...extras.map((d, i) => ({ role: `\u514D\u8D39 WARP\uFF08\u5907\u80CE ${i + 1}\uFF09`, dev: d })),
        ztDev ? { role: "Zero Trust \u56E2\u961F\u8BBE\u5907", dev: ztDev } : null
      ].filter(Boolean);
      if (!roles.length) {
        return json({ ok: false, error: "KV \u91CC\u4E00\u53F0\u8BBE\u5907\u90FD\u6CA1\u6709\uFF0C\u5148\u6CE8\u518C" }, 400);
      }
      const items = [];
      for (const r of roles) {
        const v = await verifyDevice(r.dev);
        items.push({
          role: r.role,
          deviceId: r.dev.deviceId || "",
          ipv4: r.dev.ipv4 || "",
          registeredAt: r.dev.registeredAt || "",
          accountType: v.accountType || r.dev.accountType || "",
          // ok: true 活着 / false 被删 / null 查不了（没有 token）
          ok: v.ok,
          error: v.error || ""
        });
      }
      const report = { at: (/* @__PURE__ */ new Date()).toISOString(), items };
      await env.KV.put(K_DIAG, JSON.stringify(report));
      const meta = await env.KV.get(K_STATE, "json") || {};
      meta.diag = report;
      await env.KV.put(K_STATE, JSON.stringify(meta));
      const dead = items.filter((x) => x.ok === false);
      const unknown = items.filter((x) => x.ok === null);
      return json({
        ok: true,
        report,
        msg: dead.length ? `${dead.map((d) => d.role).join("\u3001")} \u5DF2\u88AB CF \u5220\u9664\u6216\u540A\u9500 \u2014\u2014 \u8FD9\u5C31\u662F\u6574\u65CF\u8282\u70B9\u5168\u6B7B\u7684\u539F\u56E0\u3002\u514D\u8D39\u90A3\u51E0\u53F0\u53EF\u4EE5\u70B9\u300C\u4E00\u952E\u4FEE\u590D\u300D\u81EA\u52A8\u6362\u65B0\uFF1BZero Trust \u90A3\u4EFD\u8981\u56DE\u4E0B\u9762\u7C98\u4E00\u4EFD\u65B0 JWT\u3002` : `\u8BBE\u5907\u90FD\u6B63\u5E38${unknown.length ? `\uFF08${unknown.length} \u53F0\u6CA1\u6CD5\u6821\u9A8C\uFF0C\u89C1\u4E0B\u8868\uFF09` : ""}\u3002\u5982\u679C\u5BA2\u6237\u7AEF\u91CC\u8FD8\u662F\u6709\u8282\u70B9\u8FDE\u4E0D\u4E0A\uFF0C\u90A3\u5C31\u662F\u94FE\u8DEF/\u7AEF\u53E3\u5C42\u9762\u7684\u95EE\u9898\uFF0C\u4E0D\u662F\u8BBE\u5907\u51ED\u636E\uFF1A\u6362\u4E2A\u7AEF\u53E3\uFF084443 / 8443 / 8095\uFF09\u6216\u7528 ZT \u65CF\u8BD5\u3002`
      });
    }
    if (path === "/api/warp/repair" && req.method === "POST") {
      const out = [];
      let warp = await env.KV.get(K_WARP, "json");
      if (warp) {
        const v = await verifyDevice(warp);
        if (v.ok === false) {
          try {
            warp = await registerWarp("cf-worker");
            await env.KV.put(K_WARP, JSON.stringify(warp));
            out.push(`\u514D\u8D39\u4E3B\u529B\u5DF2\u6362\u65B0\uFF08\u539F\u6765\u90A3\u53F0\uFF1A${v.error}\uFF09`);
          } catch (e) {
            out.push(`\u514D\u8D39\u4E3B\u529B\u6362\u65B0\u5931\u8D25\uFF1A${e.message}`);
          }
        } else if (v.ok === true) {
          out.push("\u514D\u8D39\u4E3B\u529B\u8FD8\u6D3B\u7740\uFF0C\u6CA1\u52A8\u5B83");
        } else {
          out.push(`\u514D\u8D39\u4E3B\u529B\u6CA1\u6CD5\u6821\u9A8C\uFF1A${v.error}`);
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
              out.push(`\u5907\u80CE ${(d.deviceId || "").slice(0, 8)}\u2026 \u5DF2\u6362\u65B0`);
            } catch (e) {
              out.push(`\u5907\u80CE\u6362\u65B0\u5931\u8D25\uFF1A${e.message}`);
            }
          } else {
            kept.push(d);
          }
        }
        await env.KV.put(K_WARP_X, JSON.stringify(kept));
      }
      let st = null;
      try {
        st = await rebuild(env);
      } catch (e) {
        return json({ ok: false, msg: out.join("\uFF1B"), error: e.message }, 500);
      }
      return json({ ok: true, msg: out.join("\uFF1B") + `\u3002\u5DF2\u91CD\u5EFA\uFF1A\u514D\u8D39\u8FB9\u7F18 ${st.stats.freeEdges} \u4E2A` + (st.stats.extraEdges ? ` + \u5907\u80CE ${st.stats.extraEdges} \u4E2A` : "") });
    }
    if (path === "/api/warp/rekey" && req.method === "POST") {
      const warp = await env.KV.get(K_WARP, "json");
      if (!warp) return json({ ok: false, error: "\u8FD8\u6CA1\u6709\u514D\u8D39\u8BBE\u5907\uFF0C\u5148\u70B9\u5237\u65B0\u751F\u6210" }, 400);
      if (!warp.token) {
        return json({ ok: false, error: "\u8FD9\u53F0\u8BBE\u5907\u6CA1\u6709 device token\uFF0C\u6CA1\u6CD5\u91CD\u88C5\u5BC6\u94A5\uFF0C\u53EA\u80FD\u91CD\u65B0\u6CE8\u518C" }, 400);
      }
      try {
        const upd = await reenrollMasque(warp, "cf-worker");
        await env.KV.put(K_WARP, JSON.stringify(upd));
        const st = await rebuild(env);
        return json({
          ok: true,
          msg: `\u5DF2\u7ED9\u514D\u8D39\u4E3B\u529B\u91CD\u88C5 MASQUE \u5BC6\u94A5\u5E76\u91CD\u5EFA\uFF08\u514D\u8D39\u8FB9\u7F18 ${st.stats.freeEdges} \u4E2A\uFF09`
        });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (path === "/api/warp/add" && req.method === "POST") {
      const extras = await getExtraWarps(env);
      if (extras.length >= MAX_EXTRA_DEVICES) {
        return json({
          ok: false,
          error: `\u6700\u591A ${MAX_EXTRA_DEVICES} \u53F0\u5907\u80CE\u3002\u518D\u591A\u6536\u76CA\u5F88\u5C0F\uFF0C\u53EA\u4F1A\u628A\u8BA2\u9605\u6491\u5927\u3002`
        }, 400);
      }
      try {
        extras.push(await registerWarp(`cf-worker-backup${extras.length + 1}`));
        await env.KV.put(K_WARP_X, JSON.stringify(extras));
        const st = await rebuild(env);
        return json({
          ok: true,
          msg: `\u5907\u80CE +1\uFF08\u5171 ${extras.length} \u53F0\uFF0C${st.stats.extraEdges} \u4E2A\u63A5\u5165\u70B9\uFF09`
        });
      } catch (e) {
        return json({ ok: false, error: `\u6CE8\u518C\u5907\u80CE\u5931\u8D25\uFF1A${e.message}` }, 500);
      }
    }
    if (path === "/api/warp/remove" && req.method === "POST") {
      const extras = await getExtraWarps(env);
      if (!extras.length) return json({ ok: false, error: "\u73B0\u5728\u6CA1\u6709\u5907\u80CE" }, 400);
      extras.pop();
      await env.KV.put(K_WARP_X, JSON.stringify(extras));
      try {
        await rebuild(env);
      } catch {
      }
      return json({ ok: true, msg: `\u5907\u80CE -1\uFF0C\u5269 ${extras.length} \u53F0` });
    }
    if (path === "/api/zt/enroll" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const jwt = String(body.jwt || "").trim();
      if (!jwt) return json({ ok: false, error: "\u628A Team Token \u7C98\u8FDB\u6765" }, 400);
      if (jwt.length < 40) {
        return json({ ok: false, error: "\u8FD9\u4E2A\u4E0D\u50CF JWT\uFF0C\u592A\u77ED\u4E86\u3002\u56DE\u7BA1\u7406\u9875\u91CD\u65B0\u62FF\u4E00\u4E2A\u3002" }, 400);
      }
      try {
        const dev = await registerWarp("cf-worker-zt", jwt);
        await env.KV.put(K_ZT, JSON.stringify(dev));
        let st;
        try {
          st = await rebuild(env);
        } catch (e) {
          return json({ ok: true, msg: "\u8BBE\u5907\u5DF2\u6CE8\u518C\uFF0C\u4F46\u91CD\u5EFA\u914D\u7F6E\u5931\u8D25\uFF1A" + e.message });
        }
        return json({
          ok: true,
          msg: `\u5DF2\u6CE8\u518C Zero Trust \u8BBE\u5907\uFF1A\u56E2\u961F\u8FB9\u7F18 ${st.stats.teamEdges} \u4E2A + \u514D\u8D39\u8FB9\u7F18 ${st.stats.freeEdges || 0} \u4E2A\uFF0C\u4E24\u65CF\u5E76\u5B58`
        });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (path === "/api/zt/clear" && req.method === "POST") {
      await env.KV.delete(K_ZT);
      try {
        await rebuild(env);
      } catch {
      }
      return json({
        ok: true,
        msg: "\u5DF2\u6E05\u9664 Zero Trust\uFF08\u56E2\u961F\u8FB9\u7F18\u90A3\u4E00\u65CF\uFF09\uFF0C\u514D\u8D39 WARP \u548C\u843D\u5730\u65CF\u4E0D\u53D7\u5F71\u54CD"
      });
    }
    if (path === "/api/wind/clear" && req.method === "POST") {
      await env.KV.delete(K_WIND);
      try {
        await rebuild(env);
      } catch {
      }
      return json({ ok: true, msg: "\u5DF2\u6E05\u9664\uFF0C\u91CD\u8DD1\u4E00\u6B21\u6D41\u6C34\u7EBF\u62FF\u65B0\u8D26\u53F7" });
    }
    return notFound();
  }
};
export {
  index_default as default
};
