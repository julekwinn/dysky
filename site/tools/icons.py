# Builds site/assets/fluent-icons.woff2: the few icons the app uses, taken from Microsoft's Fluent UI System
# Icons (MIT) and placed at the same code points as Segoe Fluent Icons. The web demo lists it after the
# Windows icon fonts, so Windows keeps its own icons and other systems get these instead of empty boxes.
#
#   npm pack @fluentui/svg-icons && tar xzf fluentui-svg-icons-*.tgz
#   python site/tools/icons.py package/icons
import sys
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import SVGPath

# Segoe Fluent Icons code point -> Fluent UI System Icons name
GLYPHS = {
    0xE70D: 'chevron_down', 0xE710: 'add', 0xE712: 'more_horizontal', 0xE713: 'settings', 0xE721: 'search',
    0xE72B: 'arrow_left', 0xE72C: 'arrow_clockwise', 0xE72E: 'lock_closed', 0xE73E: 'checkmark', 0xE74A: 'arrow_up',
    0xE76C: 'chevron_right', 0xE771: 'data_pie', 0xE790: 'color', 0xE838: 'folder_open', 0xE890: 'eye',
    0xE8A5: 'document', 0xE8B7: 'folder', 0xE8BB: 'dismiss', 0xE8C8: 'copy', 0xE8DA: 'open', 0xE8EF: 'calculator',
    0xE921: 'subtract', 0xE922: 'maximize', 0xE923: 'square_multiple', 0xE945: 'flash', 0xE946: 'info',
}
EM = 2048

def main(icons: Path, out: Path):
    names, glyphs, cmap = ['.notdef'], {'.notdef': TTGlyphPen(None).glyph()}, {}
    for code, name in GLYPHS.items():
        svg = icons / f'{name}_16_regular.svg'
        pen = TTGlyphPen(None)
        # 16 px SVG, y down -> 2048 units, y up; curves become quadratic for TrueType
        SVGPath(str(svg)).draw(TransformPen(Cu2QuPen(pen, max_err=1, reverse_direction=True), (EM / 16, 0, 0, -EM / 16, 0, EM)))
        names.append(name)
        glyphs[name] = pen.glyph()
        cmap[code] = name
    fb = FontBuilder(EM, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({n: (EM, 0) for n in names})
    fb.setupHorizontalHeader(ascent=EM, descent=0)
    fb.setupNameTable({'familyName': 'Dysky Fluent Icons', 'styleName': 'Regular',
                       'copyright': 'Fluent UI System Icons, (c) Microsoft Corporation, MIT License'})
    fb.setupOS2(sTypoAscender=EM, sTypoDescender=0, usWinAscent=EM, usWinDescent=0)
    fb.setupPost()
    fb.font.flavor = 'woff2'
    fb.save(str(out))
    print(f'{out}: {len(cmap)} icons, {out.stat().st_size} bytes')

if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(__file__).resolve().parents[1] / 'assets' / 'fluent-icons.woff2')
