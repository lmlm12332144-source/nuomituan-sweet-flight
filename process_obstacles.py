# -*- coding: utf-8 -*-
"""任务E：处理三张障碍物素材 → assets/obstacles/
- 风暴云：三帧切分(724×724) → 各裁 bbox → 统一缩放系数 → 居中贴 256² → 重组 768×256 sheet
- 冰晶：清 alpha≤4 噪点 → 裁 bbox → 归一 256²
- 泡泡：裁 bbox → 归一 256²
不改画风，只做几何归一与近零 alpha 清理
"""
from PIL import Image
import os
import json

SRC = r"C:\Users\马金琪\Desktop\新建文件夹 (2)\gkd"
DST = r"d:\无双\Python\飞机大战\assets\obstacles"
os.makedirs(DST, exist_ok=True)

CANVAS = 256
CONTENT = 232  # 内容长边（与收集物管线一致）

def crop_alpha(img, thresh=8):
    a = img.split()[3]
    mask = a.point(lambda v: 255 if v > thresh else 0)
    bbox = mask.getbbox()
    return img.crop(bbox) if bbox else img

def fit_content(content):
    w, h = content.size
    s = CONTENT / max(w, h)
    if s < 1:
        content = content.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    return content

def on_canvas(content):
    c = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    content = fit_content(content)
    px = (CANVAS - content.size[0]) // 2
    py = (CANVAS - content.size[1]) // 2
    c.paste(content, (px, py), content)
    return c

# ---------- 1. 糖果风暴云：三帧切分重组 ----------
storm = Image.open(os.path.join(SRC, "糖果风暴云.png")).convert("RGBA")
fw = storm.size[0] // 3  # 2172/3 = 724 整除
frames = [crop_alpha(storm.crop((i * fw, 0, (i + 1) * fw, storm.size[1]))) for i in range(3)]
max_dim = max(max(f.size) for f in frames)
scale = CONTENT / max_dim
resized = []
for f in frames:
    nw, nh = max(1, round(f.size[0] * scale)), max(1, round(f.size[1] * scale))
    resized.append(f.resize((nw, nh), Image.LANCZOS))
sheet2 = Image.new("RGBA", (CANVAS * 3, CANVAS), (0, 0, 0, 0))
for i, f in enumerate(resized):
    px = i * CANVAS + (CANVAS - f.size[0]) // 2
    py = (CANVAS - f.size[1]) // 2
    sheet2.paste(f, (px, py), f)
sheet2.save(os.path.join(DST, "storm_cloud_sheet.png"))
print("storm_cloud_sheet.png", sheet2.size, "frames:", [f.size for f in resized])

# ---------- 2. 漂浮冰晶 ----------
ice = Image.open(os.path.join(SRC, "漂浮冰晶.png")).convert("RGBA")
r, g, b, a = ice.split()
a = a.point(lambda v: 0 if v <= 4 else v)  # 清近零 alpha 噪点（不可见，不改画风）
ice = Image.merge("RGBA", (r, g, b, a))
ice_n = on_canvas(crop_alpha(ice))
ice_n.save(os.path.join(DST, "ice_crystal.png"))
print("ice_crystal.png", ice_n.size, "content:", crop_alpha(ice).size)

# ---------- 3. 糖果泡泡 ----------
bub = Image.open(os.path.join(SRC, "糖果泡泡.png")).convert("RGBA")
bub_n = on_canvas(crop_alpha(bub))
bub_n.save(os.path.join(DST, "candy_bubble.png"))
print("candy_bubble.png", bub_n.size, "content:", crop_alpha(bub).size)

# ---------- manifest.json：游戏端自动扫描 assets/obstacles 的依据 ----------
# 往本目录加新 PNG 后重跑本脚本，清单即更新，游戏无需改代码
names = [os.path.splitext(f)[0] for f in sorted(os.listdir(DST)) if f.lower().endswith(".png")]
with open(os.path.join(DST, "manifest.json"), "w", encoding="utf-8") as fp:
    json.dump(names, fp, ensure_ascii=False, indent=2)
print("manifest.json", names)
print("done")
