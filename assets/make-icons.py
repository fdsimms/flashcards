"""
Draws Franki's app icon and splash logo: a gold flashcard with an F, over a second card.

    python3 assets/make-icons.py        (needs Pillow)

Writes assets/icon.png (1024, opaque, as the App Store wants it; iOS rounds the corners) and
assets/splash-icon.png (the same mark on transparent, for the launch screen). The colors are the
theme's (src/ui/theme.ts): the dark background, and the accent's gold. Everything is drawn at 4x and
scaled down, so the edges are smooth.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent
SIZE = 1024
SS = 4  # supersampling

BG_TOP, BG_BOTTOM = (27, 30, 38), (14, 16, 20)
GOLD_TOP, GOLD_BOTTOM = (240, 214, 144), (200, 160, 74)
GOLD_BACK = (138, 109, 31)
INK = (27, 20, 7)


def vertical_gradient(w, h, top, bottom):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        row = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = row
    return img


def rounded_mask(w, h, r):
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w - 1, h - 1), r, fill=255)
    return m


def card(w, h, r, top, bottom, with_f):
    """A card: a gradient with a soft highlight along its top edge, and an F cut in dark ink."""
    face = vertical_gradient(w, h, top, bottom).convert("RGBA")
    d = ImageDraw.Draw(face)
    if with_f:
        u = w / 470  # the F is drawn for a 470-wide card
        stroke = 66 * u
        x0, y0 = 138 * u, 150 * u
        for box in (
            (x0, y0, x0 + stroke, y0 + 340 * u),                      # stem
            (x0, y0, x0 + 215 * u, y0 + stroke),                      # top bar
            (x0, y0 + 138 * u, x0 + 160 * u, y0 + 138 * u + stroke),  # middle bar
        ):
            d.rounded_rectangle(box, stroke * 0.36, fill=INK)
    face.putalpha(rounded_mask(w, h, r))
    return face


def place(base, layer, center, angle, shadow=0):
    rotated = layer.rotate(angle, resample=Image.BICUBIC, expand=True)
    x, y = center[0] - rotated.width // 2, center[1] - rotated.height // 2
    if shadow:
        sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
        sh.paste((0, 0, 0, 120), (x, y + shadow), rotated.getchannel("A"))
        base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(shadow * 0.9)))
    base.alpha_composite(rotated, (x, y))


def mark(size):
    """The two cards on a transparent canvas of `size`."""
    s = size
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    cw, ch, r = round(s * 0.46), round(s * 0.60), round(s * 0.07)
    back = card(cw, ch, r, GOLD_BACK, tuple(int(c * 0.8) for c in GOLD_BACK), False)
    front = card(cw, ch, r, GOLD_TOP, GOLD_BOTTOM, True)
    place(canvas, back, (round(s * 0.532), round(s * 0.475)), -14, shadow=round(s * 0.012))
    place(canvas, front, (round(s * 0.442), round(s * 0.535)), 7, shadow=round(s * 0.022))
    return canvas


def main():
    big = SIZE * SS
    icon = vertical_gradient(big, big, BG_TOP, BG_BOTTOM).convert("RGBA")
    icon.alpha_composite(mark(big))
    icon.convert("RGB").resize((SIZE, SIZE), Image.LANCZOS).save(OUT / "icon.png", optimize=True)

    splash = mark(big).resize((SIZE, SIZE), Image.LANCZOS)
    splash.save(OUT / "splash-icon.png", optimize=True)


if __name__ == "__main__":
    main()
