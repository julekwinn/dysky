# Writes the MSIX package's logos into packaging/msix/Assets from the app icon (src-tauri/icons/icon.png):
# the tile and Store logos at 100% and 200%, and the app icon at every taskbar and Start size, plated and
# unplated, so Windows shows the bare icon instead of one on a coloured square. Run it after changing the icon:
#   python packaging/msix/assets.py
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ICON = Image.open(HERE.parents[1] / 'src-tauri' / 'icons' / 'icon.png').convert('RGBA')
OUT = HERE / 'Assets'
OUT.mkdir(exist_ok=True)

def save(name, size):
    ICON.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)

for base, size in [('Square150x150Logo', 150), ('Square44x44Logo', 44), ('StoreLogo', 50)]:
    for scale in (100, 125, 150, 200):
        save(f'{base}.scale-{scale}.png', round(size * scale / 100))
for target in (16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256):
    for form in ('', '_altform-unplated', '_altform-lightunplated'):
        save(f'Square44x44Logo.targetsize-{target}{form}.png', target)
print(f'{len(list(OUT.glob("*.png")))} logos in {OUT}')
