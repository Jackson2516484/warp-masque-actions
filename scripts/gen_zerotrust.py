#!/usr/bin/env python3
"""
把 usque 的 Zero Trust 注册结果打包成 Worker 能消费的 base64 blob。

usque 注册命令（在 Actions 里跑）:
    ./usque register -a -n <设备名> --jwt <team-token>

config.json 里的 private_key / endpoint_pub_key 就是 MASQUE 用的密钥
（-a 顺带做了 MASQUE 公钥 enroll），跟纯 WireGuard 那套不通用。

这个脚本只做格式转换：读 config.json，挑 Worker 需要的字段，
base64 一下写到 dist/zt-blob.txt。Worker 那边 /push/<令牌>/zt
接过去存进 KV，rebuild 时当 Zero Trust 骨干用。

用法:
    python3 gen_zerotrust.py <usque-config.json> <输出目录>
"""
import base64
import json
import os
import sys
from datetime import datetime, timezone


def pem_to_b64der(s):
    """usque 的 private_key / endpoint_pub_key 可能是 PEM 也可能是裸 base64。
    PEM 就剥掉头尾换行，裸 base64 直接返回。"""
    s = s.strip()
    if s.startswith("-----"):
        return "".join(
            ln.strip() for ln in s.splitlines()
            if ln.strip() and not ln.startswith("-----")
        )
    return s


def main():
    if len(sys.argv) < 3:
        print("用法: gen_zerotrust.py <usque-config.json> <输出目录>", file=sys.stderr)
        sys.exit(1)
    src, outdir = sys.argv[1], sys.argv[2]
    with open(src) as f:
        cfg = json.load(f)

    # 跟 gen_masque.py 读的是同一批字段。-a enroll 过的 private_key
    # 就是 MASQUE 的 SEC1 私钥，endpoint_pub_key 是 peer 公钥。
    priv = pem_to_b64der(cfg.get("private_key", ""))
    pub = pem_to_b64der(cfg.get("endpoint_pub_key", ""))
    v4 = cfg.get("ipv4", "")
    v6 = cfg.get("ipv6", "")
    device_id = cfg.get("id", "")

    if not priv or not v4:
        print("config.json 里缺 private_key 或 ipv4，注册可能没成功", file=sys.stderr)
        sys.exit(1)

    blob = {
        "v": 1,
        "deviceId": device_id,
        # token 不往 Worker 推：enroll 完就用不上了，少传一份敏感凭据
        "privateKey": priv,
        "peerPublicKey": pub,
        "ipv4": v4,
        "ipv6": v6,
        # Zero Trust 标记。Worker 的 config.js 据此放团队边缘节点
        "zeroTrust": True,
        "accountType": "team",
        "registeredAt": datetime.now(timezone.utc).isoformat(),
    }

    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, "zt-blob.txt")
    with open(path, "w") as f:
        f.write(base64.b64encode(json.dumps(blob).encode()).decode())

    print(f"已生成 {path}")
    print(f"设备 ID {device_id[:8]}…  内网 {v4} / {v6}")
    print("推到 Worker 的 /push/<令牌>/zt，或粘进管理页 Zero Trust 区块")


if __name__ == "__main__":
    main()
