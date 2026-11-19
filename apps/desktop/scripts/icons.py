"""Rasterize Roost's existing pixel SVG without image-library dependencies."""

import pathlib
import struct
import sys
import xml.etree.ElementTree as ET
import zlib

source, destination = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
pixels = {}
for rect in ET.parse(source).getroot():
    if rect.tag.endswith("rect"):
        color = bytes.fromhex(rect.attrib["fill"].lstrip("#")) + b"\xff"
        pixels[(int(rect.attrib["x"]), int(rect.attrib["y"]))] = color


def png(size, monochrome=False):
    rows = []
    for y in range(size):
        row = bytearray(b"\0")
        for x in range(size):
            color = pixels.get((x * 16 // size, y * 16 // size), b"\0\0\0\0")
            if monochrome and color[3]:
                color = b"\0\0\0\xff" if color[:3] != b"\xfc\xfb\xf7" else b"\0\0\0\0"
            row.extend(color)
        rows.append(bytes(row))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"".join(rows))) + chunk(b"IEND", b"")


(destination / "tray.png").write_bytes(png(16, True))
iconset = destination / "Roost.iconset"
iconset.mkdir(exist_ok=True)
for size in (16, 32, 128, 256, 512):
    (iconset / f"icon_{size}x{size}.png").write_bytes(png(size))
    (iconset / f"icon_{size}x{size}@2x.png").write_bytes(png(size * 2))
