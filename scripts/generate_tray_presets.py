import os
import math
from PIL import Image, ImageDraw

PRESETS_DIR = "src-tauri/icons/presets"
ASSETS_DIR = "src/assets/tray-presets"

os.makedirs(PRESETS_DIR, exist_ok=True)
os.makedirs(ASSETS_DIR, exist_ok=True)

# 4x Supersampling canvas size = 1024x1024
SS = 1024
OUT_SIZE = 256

def render_icon(draw_func, state="common"):
    im = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    draw_func(draw, SS, state)
    final_im = im.resize((OUT_SIZE, OUT_SIZE), Image.Resampling.LANCZOS)
    return final_im

def add_state_badge(draw, s, state, color_fill=None):
    # Standard top-right badge for sysproxy and tun
    if state == "sysproxy":
        # Solid round badge with inner dot
        bx, by, br = s - 160, 160, 90
        fill = color_fill or (255, 150, 50, 255)
        draw.ellipse([bx - br, by - br, bx + br, by + br], fill=fill)
        draw.ellipse([bx - br * 0.4, by - br * 0.4, bx + br * 0.4, by + br * 0.4], fill=(0, 0, 0, 255))
    elif state == "tun":
        # Green / emerald double ring badge or shield badge
        bx, by, br = s - 160, 160, 96
        fill = color_fill or (52, 211, 153, 255)
        draw.ellipse([bx - br, by - br, bx + br, by + br], fill=fill)
        draw.ellipse([bx - br * 0.7, by - br * 0.7, bx + br * 0.7, by + br * 0.7], fill=(0, 0, 0, 255))
        draw.ellipse([bx - br * 0.4, by - br * 0.4, bx + br * 0.4, by + br * 0.4], fill=fill)

# Preset 1: Minimal Dot & Ring
def draw_minimal(draw, s, state):
    cx, cy = s // 2, s // 2
    c = (255, 255, 255, 255)
    if state == "common":
        draw.ellipse([cx - 320, cy - 320, cx + 320, cy + 320], outline=c, width=64)
        draw.ellipse([cx - 140, cy - 140, cx + 140, cy + 140], fill=c)
    elif state == "sysproxy":
        draw.ellipse([cx - 340, cy - 340, cx + 340, cy + 340], outline=(255, 160, 50, 255), width=72)
        draw.ellipse([cx - 180, cy - 180, cx + 180, cy + 180], fill=(255, 160, 50, 255))
        add_state_badge(draw, s, state, (255, 160, 50, 255))
    elif state == "tun":
        draw.ellipse([cx - 360, cy - 360, cx + 360, cy + 360], outline=(52, 211, 153, 255), width=50)
        draw.ellipse([cx - 240, cy - 240, cx + 240, cy + 240], outline=(52, 211, 153, 255), width=50)
        draw.ellipse([cx - 120, cy - 120, cx + 120, cy + 120], fill=(52, 211, 153, 255))
        add_state_badge(draw, s, state, (52, 211, 153, 255))

# Preset 2: Paper Plane
def draw_paper_plane(draw, s, state):
    col = (255, 255, 255, 255)
    if state == "sysproxy":
        col = (255, 170, 60, 255)
    elif state == "tun":
        col = (52, 211, 153, 255)
    
    # Plane tip at top-right
    tip = (s - 180, 180)
    tail_bottom = (200, s - 240)
    tail_top = (360, s - 380)
    center_fold = (s - 320, s - 320)
    left_wing = (160, s - 420)
    
    draw.polygon([tip, tail_bottom, center_fold], fill=col)
    draw.polygon([tip, center_fold, left_wing], fill=(col[0], col[1], col[2], 190))
    draw.polygon([center_fold, tail_bottom, tail_top], fill=(col[0], col[1], col[2], 130))
    if state in ("sysproxy", "tun"):
        add_state_badge(draw, s, state, col)

# Preset 3: Rocket
def draw_rocket(draw, s, state):
    cx, cy = s // 2, s // 2 + 30
    col = (255, 255, 255, 255)
    if state == "sysproxy":
        col = (255, 160, 60, 255)
    elif state == "tun":
        col = (52, 211, 153, 255)
    
    # Body
    body = [
        (cx, cy - 360),
        (cx + 140, cy - 120),
        (cx + 140, cy + 180),
        (cx, cy + 140),
        (cx - 140, cy + 180),
        (cx - 140, cy - 120),
    ]
    draw.polygon(body, fill=col)
    # Left fin
    draw.polygon([(cx - 140, cy + 60), (cx - 240, cy + 220), (cx - 140, cy + 180)], fill=col)
    # Right fin
    draw.polygon([(cx + 140, cy + 60), (cx + 240, cy + 220), (cx + 140, cy + 180)], fill=col)
    # Porthole
    draw.ellipse([cx - 55, cy - 80, cx + 55, cy + 30], fill=(0, 0, 0, 255))
    draw.ellipse([cx - 40, cy - 65, cx + 40, cy + 15], fill=col)
    # Flame for active states
    if state != "common":
        flame_col = (255, 100, 50, 255) if state == "sysproxy" else (16, 185, 129, 255)
        draw.polygon([(cx - 70, cy + 170), (cx, cy + 360), (cx + 70, cy + 170), (cx, cy + 210)], fill=flame_col)
    if state in ("sysproxy", "tun"):
        add_state_badge(draw, s, state, col)

# Preset 4: Shield
def draw_shield(draw, s, state):
    cx, cy = s // 2, s // 2
    col = (255, 255, 255, 255)
    if state == "sysproxy":
        col = (255, 170, 60, 255)
    elif state == "tun":
        col = (52, 211, 153, 255)
        
    pts = [
        (cx - 280, cy - 300),
        (cx + 280, cy - 300),
        (cx + 280, cy + 40),
        (cx, cy + 340),
        (cx - 280, cy + 40),
    ]
    draw.polygon(pts, fill=col)
    # Cutout
    inner_pts = [
        (cx - 210, cy - 240),
        (cx + 210, cy - 240),
        (cx + 210, cy + 25),
        (cx, cy + 265),
        (cx - 210, cy + 25),
    ]
    draw.polygon(inner_pts, fill=(0, 0, 0, 255))
    if state == "common":
        # Simple lock or checkmark inside
        draw.rectangle([cx - 50, cy - 50, cx + 50, cy + 90], fill=col)
        draw.arc([cx - 40, cy - 120, cx + 40, cy - 20], start=180, end=360, fill=col, width=28)
    else:
        # Solid core
        core_pts = [
            (cx - 120, cy - 140),
            (cx + 120, cy - 140),
            (cx + 120, cy),
            (cx, cy + 150),
            (cx - 120, cy),
        ]
        draw.polygon(core_pts, fill=col)
        add_state_badge(draw, s, state, col)

# Preset 5: Lightning
def draw_lightning(draw, s, state):
    cx, cy = s // 2, s // 2
    col = (255, 255, 255, 255)
    if state == "sysproxy":
        col = (255, 185, 30, 255)
    elif state == "tun":
        col = (52, 211, 153, 255)
        
    pts = [
        (cx + 90, cy - 360),
        (cx - 180, cy - 30),
        (cx - 30, cy - 30),
        (cx - 100, cy + 360),
        (cx + 180, cy + 20),
        (cx + 30, cy + 20),
    ]
    draw.polygon(pts, fill=col)
    if state in ("sysproxy", "tun"):
        add_state_badge(draw, s, state, col)

# Preset 6: Globe
def draw_globe(draw, s, state):
    cx, cy = s // 2, s // 2
    r = 310
    col = (255, 255, 255, 255)
    if state == "sysproxy":
        col = (255, 165, 50, 255)
    elif state == "tun":
        col = (52, 211, 153, 255)
        
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=50)
    # Latitude
    draw.line([(cx - r + 15, cy), (cx + r - 15, cy)], fill=col, width=46)
    # Longitudes
    draw.ellipse([cx - r * 0.55, cy - r, cx + r * 0.55, cy + r], outline=col, width=46)
    draw.line([(cx, cy - r + 15), (cx, cy + r - 15)], fill=col, width=46)
    if state in ("sysproxy", "tun"):
        add_state_badge(draw, s, state, col)

# Preset 7: Radar
def draw_radar(draw, s, state):
    cx, cy = s // 2, s // 2
    col = (255, 255, 255, 255)
    if state == "sysproxy":
        col = (255, 160, 50, 255)
    elif state == "tun":
        col = (52, 211, 153, 255)
        
    for r in [120, 230, 340]:
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=42)
    draw.line([(cx - 340, cy), (cx + 340, cy)], fill=col, width=36)
    draw.line([(cx, cy - 340), (cx, cy + 340)], fill=col, width=36)
    # Radar sweep arm
    draw.line([(cx, cy), (cx + 240, cy - 240)], fill=col, width=54)
    draw.ellipse([cx - 40, cy - 40, cx + 40, cy + 40], fill=col)
    if state in ("sysproxy", "tun"):
        add_state_badge(draw, s, state, col)

# Preset 8: Ghost
def draw_ghost(draw, s, state):
    cx, cy = s // 2, s // 2 - 20
    col = (255, 255, 255, 255)
    if state == "sysproxy":
        col = (255, 160, 50, 255)
    elif state == "tun":
        col = (52, 211, 153, 255)
        
    # Top dome + skirt
    draw.pieslice([cx - 240, cy - 260, cx + 240, cy + 220], 180, 360, fill=col)
    draw.rectangle([cx - 240, cy - 20, cx + 240, cy + 240], fill=col)
    # Waves bottom
    w = 480 / 4
    for i in range(4):
        bx = cx - 240 + i * w
        draw.chord([bx, cy + 180, bx + w, cy + 290], 0, 180, fill=col)
    # Eyes
    draw.ellipse([cx - 150, cy - 70, cx - 50, cy + 50], fill=(0, 0, 0, 255))
    draw.ellipse([cx + 50, cy - 70, cx + 150, cy + 50], fill=(0, 0, 0, 255))
    draw.ellipse([cx - 120, cy - 50, cx - 70, cy], fill=col)
    draw.ellipse([cx + 80, cy - 50, cx + 130, cy], fill=col)
    if state in ("sysproxy", "tun"):
        add_state_badge(draw, s, state, col)

# Preset 9: Cloud
def draw_cloud(draw, s, state):
    cx, cy = s // 2, s // 2 + 30
    col = (255, 255, 255, 255)
    if state == "sysproxy":
        col = (255, 160, 50, 255)
    elif state == "tun":
        col = (52, 211, 153, 255)
        
    # Cloud circles
    draw.ellipse([cx - 310, cy - 60, cx - 110, cy + 140], fill=col)
    draw.ellipse([cx - 170, cy - 200, cx + 120, cy + 90], fill=col)
    draw.ellipse([cx + 20, cy - 130, cx + 290, cy + 140], fill=col)
    draw.rectangle([cx - 210, cy - 20, cx + 210, cy + 140], fill=col)
    if state != "common":
        # Draw small inner download / pulse icon
        draw.line([(cx, cy - 30), (cx, cy + 60)], fill=(0, 0, 0, 255), width=24)
        draw.polygon([(cx - 30, cy + 50), (cx + 30, cy + 50), (cx, cy + 95)], fill=(0, 0, 0, 255))
    if state in ("sysproxy", "tun"):
        add_state_badge(draw, s, state, col)

# Preset 10: Compass
def draw_compass(draw, s, state):
    cx, cy = s // 2, s // 2
    r = 320
    col = (255, 255, 255, 255)
    if state == "sysproxy":
        col = (255, 160, 50, 255)
    elif state == "tun":
        col = (52, 211, 153, 255)
        
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=46)
    # Needle
    draw.polygon([(cx, cy - 260), (cx + 60, cy), (cx - 60, cy)], fill=col)
    draw.polygon([(cx, cy + 260), (cx + 60, cy), (cx - 60, cy)], fill=(col[0], col[1], col[2], 120))
    draw.ellipse([cx - 36, cy - 36, cx + 36, cy + 36], fill=(0, 0, 0, 255))
    if state in ("sysproxy", "tun"):
        add_state_badge(draw, s, state, col)

# Preset 11: Terminal
def draw_terminal(draw, s, state):
    cx, cy = s // 2, s // 2
    col = (255, 255, 255, 255)
    if state == "sysproxy":
        col = (255, 160, 50, 255)
    elif state == "tun":
        col = (52, 211, 153, 255)
        
    w, h = 330, 240
    draw.rounded_rectangle([cx - w, cy - h, cx + w, cy + h], radius=44, outline=col, width=48)
    draw.line([(cx - w, cy - h + 90), (cx + w, cy - h + 90)], fill=col, width=32)
    # 3 dots on top
    for i, dx in enumerate([-60, 0, 60]):
        draw.ellipse([cx - w + 80 + dx - 16, cy - h + 45 - 16, cx - w + 80 + dx + 16, cy - h + 45 + 16], fill=col)
    # Command prompt > _
    px, py = cx - 180, cy + 40
    draw.line([(px, py - 40), (px + 45, py), (px, py + 40)], fill=col, width=36)
    draw.line([(px + 90, py + 40), (px + 170, py + 40)], fill=col, width=36)
    if state in ("sysproxy", "tun"):
        add_state_badge(draw, s, state, col)

PRESETS = {
    "minimal": draw_minimal,
    "paper-plane": draw_paper_plane,
    "rocket": draw_rocket,
    "shield": draw_shield,
    "lightning": draw_lightning,
    "globe": draw_globe,
    "radar": draw_radar,
    "ghost": draw_ghost,
    "cloud": draw_cloud,
    "compass": draw_compass,
    "terminal": draw_terminal,
}

for name, draw_fn in PRESETS.items():
    preset_dir = os.path.join(PRESETS_DIR, name)
    os.makedirs(preset_dir, exist_ok=True)
    
    for state in ["common", "sysproxy", "tun"]:
        img = render_icon(draw_fn, state)
        ico_path = os.path.join(preset_dir, f"{state}.ico")
        img.save(ico_path, format="ICO", sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256)])
        if state == "common":
            # Save PNG preview for frontend
            png_path = os.path.join(ASSETS_DIR, f"{name}.png")
            img.save(png_path, format="PNG")

# For default preset, extract a preview from tray-icon.ico
try:
    default_img = Image.open("src-tauri/icons/tray-icon.ico")
    default_img.save(os.path.join(ASSETS_DIR, "default.png"), format="PNG")
    print("Default preset preview extracted")
except Exception as e:
    print("Default preview extraction failed:", e)

print(f"Generated {len(PRESETS)} presets successfully!")
