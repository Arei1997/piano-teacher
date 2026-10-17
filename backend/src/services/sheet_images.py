"""Prepare photos of sheet music so the vision model can read small note heads.

Phone photos and screenshots are often low resolution (staff lines a few pixels
apart). The model reads detail better when each staff covers more of the image,
so every page is sent whole (for layout and bar order) followed by enlarged
horizontal slices cut through the white space between systems.
"""

import io

from PIL import Image, ImageOps

# The API scales images down past this long edge, so there's no gain beyond it.
MAX_EDGE = 1568
INK_THRESHOLD = 160  # grey level counted as ink
BLANK_ROW_INK = 0.004  # a row with less ink than this fraction of its width is white space
MIN_GAP_ROWS = 4


def prepare_page(data: bytes) -> list[bytes]:
    """PNG images to send for one page: the whole page, then enlarged slices."""
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    pages = [_png(_fit(image))]
    width, height = image.size
    if height < 0.8 * width:
        return pages  # already a strip (e.g. a screenshot of one line)
    for top, bottom in _slices(image):
        pages.append(_png(_fit(image.crop((0, top, width, bottom)))))
    return pages


def _slices(image: Image.Image, parts: int = 3) -> list[tuple[int, int]]:
    """Cut the page into about `parts` slices, only through blank rows."""
    gray = image.convert("L")
    width, height = gray.size
    pixels = gray.load()
    blank = [
        sum(1 for x in range(0, width, 2) if pixels[x, y] < INK_THRESHOLD) < BLANK_ROW_INK * width / 2
        for y in range(height)
    ]

    # Middle of every run of blank rows is a candidate cut.
    cuts, start = [], None
    for y, is_blank in enumerate(blank + [False]):
        if is_blank and start is None:
            start = y
        elif not is_blank and start is not None:
            if y - start >= MIN_GAP_ROWS:
                cuts.append((start + y) // 2)
            start = None
    if not cuts:
        return []

    edges = [0]
    for i in range(1, parts):
        target = height * i // parts
        best = min(cuts, key=lambda c: abs(c - target))
        if best - edges[-1] > height * 0.15:
            edges.append(best)
    edges.append(height)
    return [(a, b) for a, b in zip(edges, edges[1:]) if b - a > 20]


def _fit(image: Image.Image) -> Image.Image:
    """Scale so the long edge is MAX_EDGE: enlarges small images, shrinks huge ones."""
    scale = MAX_EDGE / max(image.size)
    if abs(scale - 1) < 0.05:
        return image
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.LANCZOS)


def _png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()
