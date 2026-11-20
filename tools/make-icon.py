#!/usr/bin/env python3
"""生成 96x96 应用图标。

尺寸很关键：手环启动器的图标格约 96px，图标按自身像素尺寸渲染 ——
之前用 192x192 就占了 2x2 = 四格。参考在售手环应用 miSmash、HyperSchedule-for-Band
用的都是 96x96。

设计：整块绿色圆底 + 白色 A（与启动器里其它应用的「彩色圆 + 白色字形」同一风格），
      圆外透明，避免被启动器的圆形蒙版二次裁切。
"""
import math
import struct
import zlib

S = 96          # 输出尺寸（决定启动器里占几格）
SS = 8          # 超采样倍数
GREEN = (52, 211, 153)   # #34d399
WHITE = (255, 255, 255)

CX = CY = S / 2.0
R_CIRCLE = S / 2.0       # 满幅圆

# A 的几何（96 坐标系）
APEX = (48.0, 23.0)
FOOT_L, BASE_Y, FOOT_R = 26.0, 72.0, 70.0
HALF_W = 6.6             # 笔画半宽
BAR_Y = 55.0
BAR_SCALE = 0.9


def dist_seg(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / L2))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


t_bar = (BAR_Y - APEX[1]) / (BASE_Y - APEX[1])
bar_l = APEX[0] - (APEX[0] - FOOT_L) * t_bar
bar_r = APEX[0] - (APEX[0] - FOOT_R) * t_bar

rows = []
for y in range(S):
    row = bytearray()
    for x in range(S):
        n = 0
        hits = 0
        for sy in range(SS):
            for sx in range(SS):
                px = x + (sx + 0.5) / SS
                py = y + (sy + 0.5) / SS
                if math.hypot(px - CX, py - CY) > R_CIRCLE:
                    continue
                n += 1
                if (
                    dist_seg(px, py, APEX[0], APEX[1], FOOT_L, BASE_Y) <= HALF_W
                    or dist_seg(px, py, APEX[0], APEX[1], FOOT_R, BASE_Y) <= HALF_W
                    or dist_seg(px, py, bar_l, BAR_Y, bar_r, BAR_Y) <= HALF_W * BAR_SCALE
                ):
                    hits += 1
        total = SS * SS
        if n == 0:
            row += bytes((0, 0, 0, 0))
            continue
        a_bg = n / total          # 圆边缘抗锯齿
        a_ink = hits / n          # 字形在圆内的覆盖率
        r = int(WHITE[0] * a_ink + GREEN[0] * (1 - a_ink))
        g = int(WHITE[1] * a_ink + GREEN[1] * (1 - a_ink))
        b = int(WHITE[2] * a_ink + GREEN[2] * (1 - a_ink))
        row += bytes((r, g, b, int(255 * a_bg)))
    rows.append(bytes(row))

raw = b"".join(b"\x00" + r for r in rows)


def chunk(tag, data):
    c = struct.pack(">I", len(data)) + tag + data
    return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(raw, 9))
png += chunk(b"IEND", b"")
open("src/common/logo.png", "wb").write(png)
print("wrote src/common/logo.png", S, "x", S, len(png), "bytes")
