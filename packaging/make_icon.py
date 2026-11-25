"""Generate the Agentsii Codex Manager icon (PNG + multi-size ICO) with Pillow."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent / "assets"


def render(size: int = 1024) -> Image.Image:
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    # diagonal violet -> cyan gradient
    grad = Image.new("RGBA", (s, s))
    px = grad.load()
    c1, c2 = (124, 108, 255), (34, 211, 238)
    for y in range(s):
        for x in range(s):
            t = (x + y) / (2 * s)
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([s * 0.04, s * 0.04, s * 0.96, s * 0.96], radius=s * 0.22, fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    # stylised "A": two strokes + crossbar
    w = s * 0.085
    top, left, right, base = (s * 0.5, s * 0.22), (s * 0.24, s * 0.78), (s * 0.76, s * 0.78), s * 0.60
    white = (255, 255, 255, 255)
    d.line([left, top], fill=white, width=int(w), joint="curve")
    d.line([top, right], fill=white, width=int(w), joint="curve")
    for p in (left, right, top):
        r = w / 2
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=white)
    d.line([(s * 0.355, base), (s * 0.645, base)], fill=white, width=int(w * 0.8))
    # "connection" node
    r = s * 0.075
    cx, cy = s * 0.5, base
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(11, 13, 18, 255), outline=white, width=int(s * 0.03))
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    big = render(1024)
    big.resize((512, 512), Image.LANCZOS).save(OUT / "icon-512.png")
    big.resize((256, 256), Image.LANCZOS).save(OUT / "icon-256.png")
    big.save(OUT / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
