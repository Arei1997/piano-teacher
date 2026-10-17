import io

from PIL import Image, ImageDraw

from src.services.sheet_images import MAX_EDGE, prepare_page


def page_with_systems(width=900, height=1060, systems=3) -> bytes:
    """A white page with `systems` blocks of five staff lines, separated by white space."""
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    block = height // systems
    for s in range(systems):
        top = s * block + block // 3
        for line in range(5):
            y = top + line * 7
            draw.line([(40, y), (width - 40, y)], fill="black")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def sizes(pngs):
    return [Image.open(io.BytesIO(p)).size for p in pngs]


def test_page_is_sent_whole_then_as_enlarged_slices():
    pngs = prepare_page(page_with_systems())
    whole, *slices = sizes(pngs)
    assert max(whole) == MAX_EDGE  # small page enlarged to the API's limit
    assert len(slices) == 3
    assert all(w == MAX_EDGE for w, _ in slices)


def test_slices_never_cut_through_a_staff():
    # Each slice must contain exactly one complete staff: all five of its lines.
    for png in prepare_page(page_with_systems())[1:]:
        image = Image.open(io.BytesIO(png)).convert("L")
        dark_rows = [y for y in range(image.height) if image.getpixel((image.width // 2, y)) < 128]
        lines = [y for i, y in enumerate(dark_rows) if i == 0 or y - dark_rows[i - 1] > 3]
        assert len(lines) == 5


def test_wide_strip_is_not_sliced():
    pngs = prepare_page(page_with_systems(width=1200, height=300, systems=1))
    assert len(pngs) == 1
