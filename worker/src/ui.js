import { MAX_EXTRA_DEVICES, CC_PRESETS, DEFAULT_CC } from "./config.js";

// 界面沿用 cfnew 的赛博朋克终端风：青/品红霓虹、等宽字体、扫描线。
const CSS = `
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

/** KV 没绑时的指引页。报错要能自己解决，别只丢个栈。 */
export function renderNoKV() {
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
      还没绑 KV，配置和密码都没地方存。<br><br>
      <b>1.</b> Cloudflare 后台 → 存储和数据库 → KV → 创建实例<br>
      <b>2.</b> 回到这个 Worker → 设置 → 绑定 → 添加 → KV 命名空间<br>
      <b>3.</b> 变量名填 <code>KV</code>（两个字母，大写），命名空间选刚建的<br>
      <b>4.</b> 部署，刷新本页
    </div>
  </div>
</div></div></body></html>`;
}

/** 首次访问的初始化页，设管理密码。 */
export function renderSetup() {
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
    <div class="lead">第一次打开，先设一个管理密码。<br>之后订阅路径、改密码都在界面里做。</div>
    <form class="f" onsubmit="return go(event)">
      <input type="password" id="p" placeholder="PASSWORD (>= 8)" autofocus autocomplete="new-password">
      <input type="password" id="c" placeholder="CONFIRM" autocomplete="new-password">
      <button type="submit">设置</button>
    </form>
    <div id="msg"></div>
    <div class="hint">
      密码只存哈希（PBKDF2 + 随机盐），KV 里看不到明文。<br>
      <b>忘了只能删掉 KV 里的 auth:cred 重来</b>，没有找回。
    </div>
  </div>
</div></div>
<script>
async function go(e){
  e.preventDefault();
  const b=document.querySelector('button'), m=document.getElementById('msg');
  b.disabled=true; m.textContent='> 设置中…'; m.style.color='var(--yellow)';
  try{
    const r=await fetch('/api/setup',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({password:document.getElementById('p').value,
                           confirm:document.getElementById('c').value})});
    const j=await r.json();
    if(j.ok){m.textContent='> 完成';m.style.color='var(--mint)';location.reload();}
    else{m.textContent='> '+j.error;m.style.color='var(--red)';b.disabled=false;}
  }catch(err){m.textContent='> '+err.message;m.style.color='var(--red)';b.disabled=false;}
  return false;
}
</script>
</body></html>`;
}

/** 登录页。密码错时不提示"用户名错误"这类可枚举信息。 */
export function renderLogin(err) {
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
      <button type="submit">进入</button>
    </form>
    <div id="msg"></div>
    <div class="hint">连续失败 8 次会锁定 15 分钟。</div>
  </div>
</div></div>
<script>
async function go(e){
  e.preventDefault();
  const b=document.querySelector('button'), m=document.getElementById('msg');
  b.disabled=true; m.textContent='> 验证中…'; m.style.color='var(--yellow)';
  try{
    const r=await fetch('/login',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({password:document.getElementById('p').value})});
    const j=await r.json();
    if(j.ok){m.textContent='> 通过';m.style.color='var(--mint)';location.reload();}
    else{m.textContent='> '+j.error;m.style.color='var(--red)';b.disabled=false;}
  }catch(err){m.textContent='> '+err.message;m.style.color='var(--red)';b.disabled=false;}
  return false;
}
</script>
</body></html>`;
}

export function renderUI(state, host, sp, token, cred, pushToken, protonCred, windUsage, ztDevice) {
  const s = state || {};
  const warp = s.warp || {};
  const stat = s.stats || {};
  const updated = s.updatedAt ? new Date(s.updatedAt) : null;
  const ago = updated ? Math.floor((Date.now() - updated.getTime()) / 60000) : null;
  const exp = s.expiresAt ? new Date(s.expiresAt) : null;
  const left = exp ? Math.floor((exp.getTime() - Date.now()) / 60000) : null;
  const leftTxt = left === null ? "—"
    : left <= 0 ? "已过期，下次访问订阅时自动重建"
    : `${Math.floor(left / 60)} 小时 ${left % 60} 分后过期`;
  const fmt = (d) => d ? d.toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—";
  const sub = `https://${host}${sp}?token=${token}`;
  const pushUrl = pushToken ? `https://${host}/push/${pushToken}` : "";
  const pExp = protonCred && protonCred.expiresAt
    ? new Date(protonCred.expiresAt * 1000) : null;
  const windInfo = s.wind || null;
  const windPct = windUsage && windUsage.max
    ? Math.round((windUsage.used / windUsage.max) * 100) : 0;
  const gb = (n) => (n / 1073741824).toFixed(2) + " GB";
  const windUsageTxt = windUsage && windUsage.max
    ? `${gb(windUsage.used)} / ${gb(windUsage.max)}（${windPct}%）` : null;
  const pLeft = pExp ? Math.floor((pExp.getTime() - Date.now()) / 86400000) : null;

  // ---- 设备存活体检：把「哪台设备还活着」摊开给用户看 ----
  // 免费边缘那几十个节点全挂在一台设备的一把密钥上，那台被 CF 删掉整族
  // 就一起死。界面必须能直接把这台指出来，而不是让用户对着一片超时猜。
  // ok 是三态：true 活着 / false 被 CF 删除 / null 没法校验。
  const diagItems = (s.diag && Array.isArray(s.diag.items)) ? s.diag.items : [];
  const diagAt = (s.diag && s.diag.at) ? new Date(s.diag.at) : null;
  const diagAgo = diagAt ? Math.floor((Date.now() - diagAt.getTime()) / 60000) : null;
  const diagMap = {};
  diagItems.forEach((it) => { diagMap[it.role] = it; });
  const tone = (ok) => ok === true ? "color:var(--mint)"
    : ok === false ? "color:var(--red)"
    : ok === null ? "color:var(--yellow)" : "color:var(--dim)";
  const word = (ok) => ok === true ? "✓ 活着"
    : ok === false ? "✗ 已被 CF 删除"
    : ok === null ? "? 没法校验"
    : "未体检";
  const devRows = [];
  if (warp.deviceId) devRows.push({ role: "免费 WARP（主力）", d: warp });
  (s.warpExtras || []).forEach((d, i) =>
    devRows.push({ role: "免费 WARP（备胎 " + (i + 1) + "）", d: d || {} }));
  if (ztDevice && ztDevice.deviceId) {
    devRows.push({ role: "Zero Trust 团队设备", d: ztDevice });
  }

  // ---- 拥塞控制档位 / WARP+ ----
  // 这两个是「网速」上的两个开关，所以要显示当前状态，不能只给按钮。
  const ccNow = CC_PRESETS[(stat.cc || DEFAULT_CC)] ? (stat.cc || DEFAULT_CC) : DEFAULT_CC;
  const ccNowP = CC_PRESETS[ccNow];
  const lic = s.license || null;
  const licPlus = lic && lic.warpPlus === true;
  const gb2 = (b) => b ? (b / 1073741824).toFixed(2) + " GB" : "";
  const licLeft = lic && lic.premiumData ? ` · 剩余 ${gb2(lic.premiumData)}` : "";

  const row = (k, v, cls = "") =>
    `<div class="row"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;

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
.sec-t::before{content:"▍";color:var(--cyan);margin-right:6px}
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
    <a class="out" href="/logout">退出</a>
  </div>
  <div class="body">

    <div class="sec">
      <div class="sec-t">订阅</div>
      <div class="sub">
        <input id="u" value="${sub}" readonly>
        <button onclick="cp('u')">复制</button>
        <button class="gh" onclick="location.href=document.getElementById('u').value">下载</button>
      </div>
      <div class="note">
        一份聚合，导进去有三族节点可切，<b>各用各的密钥、互不顶替</b>：<br>
        <b>WARP直连</b> — 走免费边缘（198/199），出口是 Cloudflare 的 IP，快但选不了国家。<br>
        ${s.zeroTrust ? '<b>ZT团队边缘</b> — 走 197.x 团队边缘（Zero Trust 独立密钥），更稳。<br>' : ""}
        <b>亚洲/欧洲/美洲线路</b> — MASQUE 打底再落 Opera，能换出口国家，多一跳会慢些。<br>
        <b>Proton线路</b> — MASQUE 打底 + Proton WireGuard 落地，10 个国家（配置后出现）。<br>
        <b>Windscribe线路</b> — MASQUE 打底 + Windscribe 落地，13 个地区，有香港（配置后出现）。<br>
        <b>🌐 落地出口</b> — 出口 IP 敏感站点（Play / 维基 / 成人站 / AI）的专用出口，
        默认按「能换出口的落地 → 团队边缘 → 免费边缘」排优先级。<br>
        <b>⚡ 聚合</b> — 并发连接分散到多条隧道，单隧道跑不快时用。混了两族，
        出口 IP 会有两个；要严格统一就切 <b>⚡ 聚合ZT</b> 或 <b>⚡ 聚合WARP</b>。<br>
        <b>🎬 流媒体</b> — 视频/测速专用出口，和刷网页的流分开拨不同接入点。<br>
        &nbsp;&nbsp;<b>YouTube 打不开 / 一直转圈就切这个组</b>：默认走「🎬 流媒体自动」，
        还不行就往下切成 Proton线路 / Windscribe线路 换个出口 IP
        （CF 的 IP 被 Google 判成机房时只有换出口能救）。<br>
        <b>🚫 QUIC</b> — QUIC 总开关。国内域名的 QUIC 已自动放行直连，不用管；
        只剩境外 QUIC 归这个组，默认 REJECT（App 会立刻回退 TCP）。<br>
        &nbsp;&nbsp;某个境外 App 一直转圈、别的都正常，把它切成 DIRECT 试一次 ——
        能好就是那个 App 不肯放弃 QUIC。<br>
        套娃线路超时或落地挂了，切${s.zeroTrust ? "ZT团队边缘或" : ""}WARP直连顶上。<br>
        <b>手机端提示</b>：手机上并发测速会被系统限制，所以「♻️ 自动选择」和
        「🎬 流媒体自动」只测精选的 4 个端口（约 20 个接入点）；要全量 7 端口的
        在「WARP直连」里手选（那一组是按需测速，切过去才开测）。
      </div>
      <div id="msg"></div>
    </div>

    <div class="sec">
      <div class="sec-t">节点</div>
      <div class="grid">
        <div class="cell"><div class="n">${stat.combos ?? "—"}</div><div class="l">组合节点</div></div>
        <div class="cell"><div class="n">${stat.entries ?? "—"}</div><div class="l">MASQUE 接入点</div></div>
        <div class="cell"><div class="n">${stat.freeEdges || "—"}</div><div class="l">WARP 免费边缘</div></div>
        <div class="cell"><div class="n">${s.zeroTrust ? (stat.teamEdges || "—") : "—"}</div><div class="l">ZT 团队边缘</div></div>
        <div class="cell"><div class="n">${stat.landings ?? "—"}</div><div class="l">Opera 落地</div></div>
        <div class="cell"><div class="n">${stat.proton || "—"}</div><div class="l">Proton 落地</div></div>
        <div class="cell"><div class="n">${stat.wind || "—"}</div><div class="l">Windscribe 落地</div></div>
      </div>
      <div class="note">
        每个落地和每个接入点都组合一遍，任一环失效都还有别的路走。<br>
        节点名 <b>欧洲1@198.1-443</b> = 欧洲第 1 个落地，经 162.159.198.1:443 接入。<br>
        <b>ZT-</b> 开头的是 Zero Trust 团队边缘（162.159.197.x），用团队密钥；
        其余接入点用免费 WARP 密钥。<b>两族并存</b>，一族整体连不上时另一族照常工作 ——
        用 ⚡ 聚合WARP / ⚡ 聚合ZT 切开测一下延迟，就知道是哪一族的问题。<br>
        <b>数量对不上就是导入的旧配置</b>：本份应有免费边缘 ${stat.freeEdges || 0} 个、
        ZT 团队边缘 ${stat.teamEdges || 0} 个接入点${stat.extraEdges ? `、备胎 ${stat.extraEdges} 个` : ""}。
        客户端里只看到 4 个 ZT 节点（或免费节点明显少一截），
        就是配置没更新 —— 回上面重新复制订阅链接、导入一次即可。<br>
        <b>想一直跑在最快的接入点上，就别手动钉死某一个具体节点。</b>
        钉死 = 关掉自动优选，那条链路一慢你就只能干等。用
        <b>♻️ 自动选择</b>（每 60 秒重测一轮，新节点快出 10ms 以上就换手）；
        要「绝不自动换、只求一直连得上」就用 <b>🔄 故障转移</b>。
        想看全部 57 个接入点、手动挑，用 <b>WARP直连</b>。
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">拥塞控制 · 单流速度的第一杠杆</div>
      ${row("当前档位", `${ccNowP.label}（${ccNow}）`,
             ccNow === "extreme" ? "ok" : ccNow === "standard" ? "ok" : "warn")}
      ${row("下发参数", ccNowP.cc
        ? [ccNowP.cc,
           ccNowP.cwnd ? "cwnd " + ccNowP.cwnd : "",
           ccNowP.profile || ""].filter(Boolean).join(" · ")
        : "不下发，用内核默认 Cubic（最保守，也最慢）")}
      <div class="sub" style="margin-top:12px">
        ${Object.entries(CC_PRESETS).map(([k, v]) =>
          `<button class="${k === ccNow ? "" : "gh"}" onclick="setCC('${k}')">` +
          `${v.label}${k === ccNow ? " ✓" : ""}</button>`).join("")}
      </div>
      <div class="note">
        <b>为什么这个开关比换节点更管用</b>：mihomo 的 masque 出站认
        <code>congestion-controller</code> / <code>cwnd</code> /
        <code>bbr-profile</code>（见 <code>adapter/outbound/masque.go</code>）。
        不写这三个键时用的是内核默认 <b>Cubic</b> —— Cubic 把<b>丢包直接当成拥塞</b>，
        手机上（尤其跨境 + 晚高峰）一丢包就把窗口砍半，4K 立刻降码率。
        <b>BBR</b> 改成拿带宽和 RTT 建模，丢包不砍窗口，单流吞吐高一个档。
        <code>cwnd</code> 是初始窗口（单位是<b>包</b>，内核默认 32），
        加大 = 开局就把窗口铺满，不用慢慢爬。<br>
        <b>极速</b>：BBR + cwnd 128 + aggressive，单流吞吐最大，
        丢包也硬冲（小区网络特别拥堵时可能多打些重传）。<br>
        <b>标准</b>：BBR + cwnd 64 + standard，默认档，抗丢包又不霸占链路。<br>
        <b>回退</b>：不下发，回到内核默认 Cubic。<b>换档无效、或者觉得线路被
        我们拖慢了</b>，切到这个档再试 —— 它等于完全恢复原状。<br>
        ⚠️ 这是<b>生成期</b>开关，改完必须<b>重新导入一次订阅</b>才生效。
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">WARP+ 极速通道 · 授权码绑到账号上</div>
      ${row("账号状态", lic === null
             ? "未查询（点上面「设备体检」或下面按钮）"
             : licPlus
               ? `WARP+ 已启用${licLeft}`
               : `免费版${lic.at ? "（" + fmt(new Date(lic.at)) + " 查的）" : ""}`,
             lic === null ? "" : licPlus ? "ok" : "warn")}
      ${licPlus ? "" : `
      <div class="sub" style="margin-top:12px">
        <input id="lic" placeholder="粘 WARP+ 授权码：XXXXXXXX-XXXXXXXXX-XXXXXXXXXX"
               spellcheck="false" autocomplete="off">
        <button onclick="bindLic(false)">绑定到当前设备</button>
        <button class="gh" onclick="bindLic(true)">换新设备再绑定</button>
      </div>`}
      <div class="note">
        <b>这是单流速度上最大的一根杠杆。</b>免费版走的是 CF 共享的普通出口，
        容易被出口拥塞和链路 QoS 拖住；绑上授权码后账号变成 <b>WARP+</b>，
        流量改走 Cloudflare 的 <b>Argo 智能选路</b>（CF 自己的优质骨干），
        速度明显更高、也更稳。WARP 的免费边缘和 ZT 团队边缘都吃这个账号，
        所以绑一次全族受益。<br>
        授权码在官方 <b>1.1.1.1 App</b> 里：Account &gt; Key。
        <b>只认官方买的</b>，靠推荐 / 活动拿到的码 CF 会直接拒。<br>
        <b>两个按钮的区别</b>：「绑定到当前设备」最温和，不动设备号；
        如果绑完 <code>warp_plus</code> 还是 <code>false</code>，就用
        <b>「换新设备再绑定」</b> —— CF 侧有个老问题：<b>已经连过 WARP 的账号</b>
        绑了也可能不生效，正解是注册一台干净设备、在它连任何一次之前把码绑上。<br>
        一个授权码同一时间只能绑一个账号。CF 说「已被占用」的话，
        先在 1.1.1.1 App 里把其他设备解绑。
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">状态</div>
      ${row("上次更新", updated ? `${fmt(updated)}（${ago} 分钟前）` : "尚未生成",
             updated ? (ago > 250 ? "warn" : "ok") : "err")}
      ${row("凭据剩余", leftTxt, left === null ? "" : left <= 0 ? "warn" : "ok")}
      ${row("到期时间", fmt(exp))}
      ${row("密码更新于", cred && cred.updatedAt ? fmt(new Date(cred.updatedAt)) : "—")}
      ${row("免费 WARP 设备",
             warp.deviceId ? warp.deviceId.slice(0, 8) + "…" : "未注册（免费边缘族不可用）",
             warp.deviceId ? "ok" : "warn")}
      ${row("免费 WARP 注册于",
             warp.registeredAt ? fmt(new Date(warp.registeredAt)) : "—")}
      ${row("免费 WARP 内网", warp.ipv4 || "—")}
      ${ztDevice
        ? row("ZT 团队设备", ztDevice.deviceId ? ztDevice.deviceId.slice(0, 8) + "…" : "—", "ok")
          + row("ZT 注册于", ztDevice.registeredAt ? fmt(new Date(ztDevice.registeredAt)) : "—")
          + row("ZT 内网", ztDevice.ipv4 || "—")
        : row("ZT 团队设备", "未注册（只有免费边缘那一族）", "warn")}
      ${s.warpErr ? row("免费 WARP 注册错误", s.warpErr, "err") : ""}
    </div>

    <div class="sec">
      <div class="sec-t">操作</div>
      <div class="sub">
        <button onclick="go('/api/refresh')">刷新 Opera 凭据</button>
        <button class="gh" onclick="go('/api/reset-warp')">重注册免费 WARP</button>
      </div>
      <div class="note">
        Opera 凭据 4 小时到期。<b>不用定时任务</b>——订阅被访问时才检查，
        没过期直接给缓存，过期了才重新注册。<br>
        想提前换一份就点刷新。<br>
        两份 WARP 设备都存在 KV 里复用，<b>一般不用重注册</b>。免费边缘那一族整体
        连不上时才点「重注册免费 WARP」——它只换免费那份，<b>Zero Trust 那份不动</b>。<br>
        Zero Trust 要换设备得点「清除 ZT」再粘一份新 JWT（JWT 只有 60 秒寿命，不能静默重注册）。
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">设备存活体检 · 给「整族节点全死」定位</div>
      ${devRows.map((r) => {
        const d = r.d, it = diagMap[r.role] || null;
        const id = d.deviceId ? " · " + d.deviceId.slice(0, 8) + "…" : "";
        const ip = d.ipv4 ? " · " + d.ipv4 : "";
        return `<div class="row"><span class="k">${r.role}</span>` +
          `<span class="v" style="${tone(it ? it.ok : undefined)}">` +
          `${word(it ? it.ok : undefined)}${id}${ip}</span></div>`;
      }).join("")}
      ${devRows.length ? "" :
        '<div class="row"><span class="k">设备</span>' +
        '<span class="v" style="color:var(--yellow)">KV 里一台设备都没有，' +
        '回上面「操作」点刷新生成</span></div>'}
      ${diagItems.length ? `
      <div class="note" style="margin-top:12px">
        <b>最近一次体检</b>（${diagAgo <= 0 ? "刚刚" : diagAgo + " 分钟前"}）：<br>
        ${diagItems.map((it) =>
          `· ${it.role} — <b style="${tone(it.ok)};font-weight:400">${word(it.ok)}</b>` +
          (it.error ? `（${it.error}）` : "")).join("<br>")}
      </div>` : ""}
      <div class="sub" style="margin-top:12px">
        <button onclick="go('/api/diag')">设备体检</button>
        <button class="gh" onclick="go('/api/warp/repair')">一键修复免费族</button>
        <button class="gh" onclick="go('/api/warp/rekey')">重装免费密钥</button>
        <button class="gh" onclick="go('/api/warp/add')">＋ 备胎</button>
        <button class="gh" onclick="go('/api/warp/remove')">− 备胎</button>
      </div>
      <div class="note">
        <b>为什么整族会一起死</b>：免费边缘那 ${stat.freeEdges || 0} 个节点
        <b>共用同一台设备的一把密钥</b>。那台设备被 CF 删除或吊销时，整族瞬间全死 ——
        客户端只会显示一片超时，看起来就是「WARP 节点全死了、只剩 ZT 能用」。
        备胎存在的意义就是给这一族上冗余：主力挂了，备胎的节点还在
        「♻️ 自动选择」的测速池里，不会整族全红。<br>
        <b>「设备体检」</b>：拿 device token 去 CF 问「这台设备还在吗」。
        <b>只能查出密钥作不作数，查不出某个接入点通不通</b> ——
        Worker 没有 UDP 出站，跑不了 QUIC，替客户端做不了真实握手。
        所以别拿体检结果当测速结论。<br>
        <b>「一键修复免费族」</b>：把被 CF 删掉的免费设备（主力 + 备胎）静默重注册换新，
        还活着的原样不动。Zero Trust 那份修不了 —— 重注册要一个新的 60 秒 JWT，
        得回下面「Zero Trust」区块粘一份。<br>
        <b>「重装免费密钥」</b>：设备在 CF 那边还活着、但本地这把密钥认证不过时用。
        不换 deviceId，比重新注册温和。客户端报
        <code>CRYPTO_ERROR 0x131 (remote): tls: access denied</code> 就是这种。<br>
        <b>「＋ / − 备胎」</b>：加减免费备胎（另一个账号、另一把密钥），最多 ${MAX_EXTRA_DEVICES} 台。
        当前 ${stat.extraDevices || 0} 台、${stat.extraEdges || 0} 个接入点。
        备胎只出 443 / 8095 两个端口，且只有前 2 台进自动测速池 ——
        手机上每多一个成员就多一次并发 QUIC 握手，池子必须压住。
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">Zero Trust 团队边缘（和免费 WARP 并存）</div>
      ${ztDevice ? `
      <div class="row"><span class="k">状态</span><span class="v ok">已启用 ${
        ztDevice.accountType || "team"}</span></div>
      <div class="row"><span class="k">设备</span><span class="v">${
        ztDevice.deviceId ? ztDevice.deviceId.slice(0, 8) + "…" : "—"}</span></div>
      <div class="row"><span class="k">注册于</span><span class="v">${
        ztDevice.registeredAt ? fmt(new Date(ztDevice.registeredAt)) : "—"}</span></div>
      <div class="row"><span class="k">团队边缘节点</span><span class="v ok">${
        stat.teamEdges || 0} 个（162.159.197.x）</span></div>
      <div class="row"><span class="k">免费边缘节点</span><span class="v ok">${
        stat.freeEdges || 0} 个（198/199，独立密钥）</span></div>
      ` : `
      <div class="row"><span class="k">状态</span><span class="v warn">未启用（只有免费边缘那一族）</span></div>
      `}
      <div class="note" style="margin-bottom:10px">
        Zero Trust 注册的是<b>另一台设备</b>，走<b>团队边缘 162.159.197.x</b>，
        实测比 198/199 那批免费边缘更稳，连断都少。免费套餐 50 个席位，不限速。<br>
        <b>关键：两份设备并存，不是二选一。</b>CF 那边两套密钥分开认证 ——
        团队密钥喂不进免费边缘，免费密钥也认证不过团队边缘。所以
        Zero Trust 启用后，免费边缘那 57 个节点<b>照样在、照样能用</b>，
        Proton / Windscribe / Opera 那些落地的首跳会横跨两族，
        哪一族整体挂掉都还有一半落地能用。<br>
        <b>关于选国家要说清楚</b>：Zero Trust 免费版<b>不能</b>直接选出口国家，
        出口仍由 Cloudflare 任播就近落（多半是旧金山）。要选国家走的是下面
        Proton / Windscribe / Opera 那几条落地，Zero Trust 是把它们的骨干
        换快换稳。组合起来就是「快的骨干 + 能选国家」。
      </div>
      <div class="f" style="display:flex;flex-direction:column;gap:8px">
        <input id="zt" placeholder="粘 Team Token (JWT) —— 只有 60 秒寿命，拿到立刻粘"
               spellcheck="false" autocomplete="off">
        <div class="sub" style="margin-top:0">
          <button onclick="enrollZt()">立即注册</button>
          ${ztDevice ? '<button class="gh" onclick="go(\'/api/zt/clear\')">清除 ZT（只摘团队边缘那族）</button>' : ""}
        </div>
      </div>
      <div class="note">
        <b>怎么拿 JWT</b>：浏览器开 <code>https://&lt;你的团队名&gt;.cloudflareaccess.com/warp</code>，
        完成邮箱验证码登录，在成功页面的源码里找 <code>meta http-equiv="refresh"</code>，
        <code>token=</code> 后面那串就是。或者控制台跑
        <code>document.querySelector("meta[http-equiv='refresh']").content.split("=")[2]</code>。<br>
        拿到<b>立刻</b>粘进来点注册，超过 60 秒就失效，会报「注册到的是 free 账户」。
        注册成功后设备长期有效，不用反复粘。
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">Proton 落地</div>
      ${protonCred ? `
      <div class="row"><span class="k">状态</span><span class="v ok">已配置 ${
        protonCred.servers.length} 台</span></div>
      <div class="row"><span class="k">证书剩余</span><span class="v ${
        pLeft <= 1 ? "warn" : "ok"}">${pLeft} 天（${
        pExp.toISOString().slice(0, 10)} 到期）</span></div>
      ` : `
      <div class="row"><span class="k">状态</span><span class="v warn">未配置</span></div>
      `}
      <div class="note" style="margin-bottom:10px">
        Proton 要账号登录，Worker 里做会被风控拦，所以走 GitHub Actions 取证书再推过来。
        证书<b>最长 7 天</b>，到期重跑一次流水线即可。
      </div>
      <div class="sub">
        <input id="pu" value="${pushUrl || "点右边生成"}" readonly>
        <button onclick="cp('pu')">复制</button>
        <button class="gh" onclick="go('/api/proton/token')">${
          pushToken ? "换一个" : "生成"}</button>
      </div>
      <div class="note">
        把这个地址填进 GitHub 仓库 Secrets 的 <b>WORKER_PUSH_URL</b>，就这一个。<br>
        然后跑 <b>取 Proton 凭据</b> 流水线，之后每 3 天自动续，不用再管。<br>
        <b>取 Windscribe 账号</b> 那条也用同一个地址，它会自己在末尾加 <code>/wind</code>。<br>
        地址里带令牌，只能写 Proton 凭据、动不了管理页；泄露了点「换一个」。
        ${protonCred ? '<br><a href="#" onclick="go(\'/api/proton/clear\');return false" ' +
          'style="color:var(--red)">清除 Proton 凭据</a>' : ""}
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">Windscribe 落地</div>
      ${windInfo ? `
      <div class="row"><span class="k">状态</span><span class="v ok">已注册 ${
        windInfo.servers} 台</span></div>
      <div class="row"><span class="k">账号</span><span class="v">${windInfo.userId}</span></div>
      ${windUsageTxt ? `<div class="row"><span class="k">本月流量</span><span class="v ${
        windPct > 90 ? "warn" : "ok"}">${windUsageTxt}</span></div>` : ""}
      ` : `
      <div class="row"><span class="k">状态</span><span class="v warn">未启用</span></div>
      `}
      <div class="note">
        免费额度 <b>每月 2GB</b>，落地是机房 IP（M247 为主），
        13 个地区里<b>亚洲只有香港</b>。<br>
        账号走 GitHub Actions 开 —— Worker 自己开不出能用的号，
        Cloudflare 的出口 IP 是共享的，早被人用过，
        Windscribe 只会发 1MB 的降额号，那种号连代理凭据都取不到。<br>
        跑一次 <b>取 Windscribe 账号</b> 流水线就行，用的是上面那个推送地址。
        额度用完了再跑一次换个号。
        ${windInfo ? '<br><a href="#" onclick="go(\'/api/wind/clear\');return false" ' +
          'style="color:var(--red)">清除 Windscribe 账号</a>' : ""}
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">订阅路径</div>
      <div class="sub">
        <input id="sp" value="${sp.replace(/^\//, "")}" spellcheck="false"
               placeholder="字母数字和 - _">
        <button onclick="setPath('sp')">保存</button>
      </div>
      <div class="note">
        改成难猜的字符串，等于在密码之外多一层。改完上面的订阅链接要重新复制。
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">修改密码</div>
      <div class="pw">
        <input type="password" id="c0" placeholder="当前密码" autocomplete="current-password">
        <input type="password" id="c1" placeholder="新密码（>= 8）" autocomplete="new-password">
        <input type="password" id="c2" placeholder="确认新密码" autocomplete="new-password">
        <button onclick="setPw()">修改</button>
      </div>
      <div class="note">
        改完<b>所有旧订阅链接立刻失效</b>，因为 token 是用密码哈希签的。
        链接泄露了就靠这个补救。
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">须知</div>
      <div class="note">
        必须用 <b>mihomo Alpha</b> 内核，masque 出站和 dialer-proxy 稳定版都不支持。<br>
        可用客户端：Clash Verge Rev（内核切 Alpha）、ClashMi、FlClash。<br>
        Shadowrocket、Stash 不认 dialer-proxy，导进去只有 WARP直连 那组能用。<br>
        订阅链接里的 token 就是访问凭证，<b>别外传</b>，泄露了改密码即可全部失效。<br>
        配置里的 private-key 等同 WARP 账号凭据。<br>
        免费代理的流量对提供方可见，别走支付和敏感数据。
      </div>
    </div>

  </div></div>
  <div class="foot">
    Cloudflare Worker ・
    <a href="https://github.com/byJoey/warp-masque-actions">GitHub</a> ・
    <a href="https://joeyblog.net">Blog</a>
  </div>
</div>
<script>
function cp(id){
  const el=document.getElementById(id||'u');
  navigator.clipboard.writeText(el.value).then(
    ()=>say('已复制到剪贴板','var(--mint)'),
    ()=>{el.select();document.execCommand('copy');say('已复制','var(--mint)')});
}
function say(t,c){
  const m=document.getElementById('msg');
  m.textContent='> '+t; m.style.color=c;
  setTimeout(()=>{m.textContent=''},4000);
}
async function post(url,body,okmsg){
  const bs=document.querySelectorAll('button');
  bs.forEach(b=>b.disabled=true);
  say('执行中…','var(--yellow)');
  try{
    const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
                            body:JSON.stringify(body)});
    const j=await r.json();
    if(j.ok){say((j.msg||okmsg)+'，即将刷新','var(--mint)');setTimeout(()=>location.reload(),1400);}
    else{say('失败: '+j.error,'var(--red)');bs.forEach(b=>b.disabled=false);}
  }catch(e){say('失败: '+e.message,'var(--red)');bs.forEach(b=>b.disabled=false);}
}
function setPath(id){
  const v=document.getElementById(id||'sp').value.trim();
  if(!v){say('路径不能为空','var(--red)');return;}
  post('/api/sub-path',{path:v},'已保存');
}
function setPw(){
  const c0=document.getElementById('c0').value;
  const c1=document.getElementById('c1').value;
  const c2=document.getElementById('c2').value;
  if(!c0||!c1){say('把三个框都填了','var(--red)');return;}
  if(c1!==c2){say('两次输入不一致','var(--red)');return;}
  if(c1.length<8){say('新密码至少 8 位','var(--red)');return;}
  post('/api/password',{current:c0,password:c1,confirm:c2},'已修改');
}
async function go(p){
  const bs=document.querySelectorAll('button');
  bs.forEach(b=>b.disabled=true);
  say('执行中…','var(--yellow)');
  try{
    const r=await fetch(p,{method:'POST'});
    const j=await r.json();
    if(j.ok){say(j.msg+'，即将刷新','var(--mint)');setTimeout(()=>location.reload(),1200);}
    else{say('失败: '+j.error,'var(--red)');bs.forEach(b=>b.disabled=false);}
  }catch(e){say('失败: '+e.message,'var(--red)');bs.forEach(b=>b.disabled=false);}
}
async function setCC(k){
  post('/api/cc',{cc:k},'已切换');
}
// 授权码不能复用 post()：绑定「被接受但 warp_plus 仍是 false」是常见结果，
// 那种情况要留在页面上把原因读完，不能自动刷新跑掉。
async function bindLic(fresh){
  const el=document.getElementById('lic');
  const k=el?el.value.trim():'';
  if(!k){say('先把授权码粘进来','var(--red)');return;}
  const bs=document.querySelectorAll('button');
  bs.forEach(b=>b.disabled=true);
  say('正在向 Cloudflare 提交…','var(--yellow)');
  try{
    const r=await fetch('/api/warp/license',{method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({key:k,fresh:!!fresh})});
    const j=await r.json();
    if(!j.ok){say('失败: '+j.error,'var(--red)');bs.forEach(b=>b.disabled=false);return;}
    if(j.warpPlus){
      say(j.msg,'var(--mint)');
      setTimeout(()=>location.reload(),2200);
    }else{
      // 不刷新：这句话用户必须读完才知道下一步点哪个按钮
      say(j.msg,'var(--yellow)');
      bs.forEach(b=>b.disabled=false);
    }
  }catch(e){say('失败: '+e.message,'var(--red)');bs.forEach(b=>b.disabled=false);}
}
async function enrollZt(){
  const v=document.getElementById('zt').value.trim();
  if(!v){say('把 JWT 粘进来','var(--red)');return;}
  if(v.length<40){say('这串太短，不像 JWT','var(--red)');return;}
  // JWT 寿命 60 秒，注册要趁早
  post('/api/zt/enroll',{jwt:v},'注册中');
}
</script>
</body></html>`;
}
