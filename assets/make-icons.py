"""
Draws Franki's app icon and splash logo: a cream flashcard over a second card, on flat gold, with
the sound "f" written in four scripts (Latin F, Cyrillic Ф, Thai ฟ, Japanese フ).

    python3 assets/make-icons.py        (needs Pillow)

Writes assets/icon.png (1024, opaque, as the App Store wants it; iOS rounds the corners),
assets/icon-tinted.png (the same in grayscale, for iOS's tinted icons) and assets/splash-icon.png
(the icon with rounded corners on transparent, for the launch screen). Flat colors, no gradients
or shadows, like dundundun's icon. The gold is a little warmer than the theme's accent
(src/ui/theme.ts) so it holds up as a full-bleed background. Everything is drawn at 3x and scaled
down, so the edges are smooth.

The glyphs come from the fonts the app bundles (assets/fonts). Thai is Noto Serif Thai because the
loopless Thai fonts draw ฟ without its loop, which makes it hard to recognize. Japanese has no
bundled font (the app downloads them), so フ is drawn as one thick rounded stroke.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent
FONTS = OUT / "fonts"
SIZE = 1024
SS = 3  # supersampling
B = SIZE * SS

GOLD = (240, 187, 66)
DEEP = (196, 138, 24)
CREAM = (255, 244, 214)
INK = (27, 20, 7)

LATIN = FONTS / "Inter_700Bold.ttf"  # has Latin and Cyrillic
THAI = FONTS / "NotoSerifThai_600SemiBold.ttf"


def text_glyph(layer, ch, cx, cy, size, font, weight):
    f = ImageFont.truetype(str(font), round(size))
    # A stroke in the ink color thickens the glyph (a thin one for Thai, or its loop fills in).
    ImageDraw.Draw(layer).text((cx, cy), ch, font=f, fill=INK, anchor="mm",
                               stroke_width=round(size * weight), stroke_fill=INK)


def katakana_fu(layer, cx, cy, s):
    """フ: a bar, then a stroke bending down and to the left, round at both ends."""
    d = ImageDraw.Draw(layer)
    w = s * 0.22
    pts = [(cx - s * .34, cy - s * .30), (cx + s * .32, cy - s * .30),
           (cx + s * .26, cy + s * .02), (cx - s * .14, cy + s * .38)]
    d.line(pts, fill=INK, width=round(w), joint="curve")
    for x, y in (pts[0], pts[-1]):
        d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=INK)


def four_scripts(layer, w, h):
    """The four glyphs in a 2x2 grid centered on a w x h card."""
    cx, cy, o, size = w / 2, h / 2, w * .25, w * .30
    text_glyph(layer, "F", cx - o, cy - o, size, LATIN, 0.035)
    text_glyph(layer, "Ф", cx + o, cy - o, size, LATIN, 0.035)
    text_glyph(layer, "ฟ", cx - o, cy + o, size * 1.15, THAI, 0.01)
    katakana_fu(layer, cx + o, cy + o, size)


def card(w, h, fill, glyphs=False):
    c = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(c).rounded_rectangle((0, 0, w - 1, h - 1), round(B * .075), fill=fill + (255,))
    if glyphs:
        four_scripts(c, w, h)
    return c


def place(base, layer, center, angle):
    r = layer.rotate(angle, resample=Image.BICUBIC, expand=True)
    base.alpha_composite(r, (round(center[0] - r.width / 2), round(center[1] - r.height / 2)))


def icon_square(ground=GOLD, back=DEEP, front=CREAM):
    img = Image.new("RGBA", (B, B), ground + (255,))
    w, h = round(B * .46), round(B * .60)
    place(img, card(w, h, back), (B * .55, B * .47), -13)
    place(img, card(w, h, front, glyphs=True), (B * .45, B * .53), 6)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    icon = icon_square()
    icon.convert("RGB").save(OUT / "icon.png", optimize=True)

    # The launch screen shows the icon with its corners rounded, since the screen behind it
    # is the app's own paper or dark color.
    mask = Image.new("L", (B, B), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, B - 1, B - 1), round(B * .2237), fill=255)
    splash = icon.copy()
    splash.putalpha(mask.resize((SIZE, SIZE), Image.LANCZOS))
    splash.save(OUT / "splash-icon.png", optimize=True)

    # The tinted home screen icon (iOS 18): iOS colors it by brightness, so a black ground, a
    # mid-gray back card and a near-white front card.
    tinted = icon_square(ground=(0, 0, 0), back=(110, 110, 110), front=(240, 240, 240))
    tinted.convert("RGB").save(OUT / "icon-tinted.png", optimize=True)


if __name__ == "__main__":
    main()
