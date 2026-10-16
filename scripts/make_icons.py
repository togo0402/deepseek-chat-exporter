#!/usr/bin/env python3
"""生成扩展图标：圆角方底 + 白色下载箭头。

只用 Python 标准库——手写 PNG 容器、zlib 压缩、纯数学光栅化，
不需要 Pillow，也不需要 npm 那一套原生二进制依赖。
生成结果已经提交进仓库，所以普通用户 clone 下来就能直接加载扩展，不必跑这个脚本。
只有改动了 icons/icon.svg 的设计时才需要重新执行：

    python scripts/make_icons.py
"""

import struct
import zlib
from pathlib import Path

BG = (77, 107, 254)  # #4D6BFE
FG = (255, 255, 255)
SS = 4  # 每个像素的超采样倍数（SS x SS），用来做抗锯齿


def icon_geometry(size):
    """按尺寸算出各部件的位置，单位是像素。

    小尺寸下细节会被抹掉，所以 16px 单独用更粗的杆、更小的箭头，不做等比缩放。
    """
    if size <= 20:
        return {
            "radius": size * 0.22,
            "stem_half": size * 0.085,
            "stem_top": size * 0.20,
            "stem_bottom": size * 0.56,
            "head_half": size * 0.235,
            "head_top": size * 0.38,
            "head_tip": size * 0.66,
            "bar_half": size * 0.30,
            "bar_top": size * 0.74,
            "bar_bottom": size * 0.85,
        }

    return {
        "radius": size * 0.22,
        "stem_half": size * 0.062,
        "stem_top": size * 0.20,
        "stem_bottom": size * 0.58,
        "head_half": size * 0.185,
        "head_top": size * 0.42,
        "head_tip": size * 0.70,
        "bar_half": size * 0.26,
        "bar_top": size * 0.78,
        "bar_bottom": size * 0.855,
    }


def inside_round_rect(x, y, size, radius):
    """圆角矩形判定：把采样点夹进内矩形，再看它离内矩形角的距离。"""
    if not (0.0 <= x <= size and 0.0 <= y <= size):
        return False
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= radius * radius


def inside_arrow(x, y, geometry, size):
    """箭头由「竖杆 + 三角头 + 底线」三块拼成，命中任一块即算前景。"""
    center = size / 2.0

    if geometry["stem_top"] <= y <= geometry["stem_bottom"] and abs(x - center) <= geometry["stem_half"]:
        return True

    if geometry["head_top"] <= y <= geometry["head_tip"]:
        span = geometry["head_tip"] - geometry["head_top"]
        ratio = (geometry["head_tip"] - y) / span if span else 0.0
        if abs(x - center) <= geometry["head_half"] * ratio:
            return True

    if geometry["bar_top"] <= y <= geometry["bar_bottom"] and abs(x - center) <= geometry["bar_half"]:
        return True

    return False


def render(size):
    """返回逐行的 RGBA 字节，每行 size 个像素。"""
    geometry = icon_geometry(size)
    step = 1.0 / SS
    total = SS * SS
    rows = []

    for py in range(size):
        row = bytearray()
        for px in range(size):
            covered = 0
            foreground = 0

            for sy in range(SS):
                y = py + (sy + 0.5) * step
                for sx in range(SS):
                    x = px + (sx + 0.5) * step
                    if not inside_round_rect(x, y, size, geometry["radius"]):
                        continue
                    covered += 1
                    if inside_arrow(x, y, geometry, size):
                        foreground += 1

            if covered == 0:
                row += bytes((0, 0, 0, 0))
                continue

            alpha = round(255 * covered / total)
            # 边缘像素按前景占比混色，避免箭头轮廓发虚
            ratio = foreground / covered if covered else 0.0
            red = round(BG[0] + (FG[0] - BG[0]) * ratio)
            green = round(BG[1] + (FG[1] - BG[1]) * ratio)
            blue = round(BG[2] + (FG[2] - BG[2]) * ratio)
            row += bytes((red, green, blue, alpha))

        rows.append(bytes(row))

    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + row for row in rows)  # 每行前面一个 filter 字节 0

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))  # 8bit RGBA
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")

    path.write_bytes(png)


def main():
    root = Path(__file__).resolve().parent.parent
    out = root / "icons"
    out.mkdir(parents=True, exist_ok=True)

    for size in (16, 48, 128):
        path = out / f"icon{size}.png"
        write_png(path, size, render(size))
        print(f"已生成 icons/icon{size}.png（{path.stat().st_size} 字节）")


if __name__ == "__main__":
    main()
