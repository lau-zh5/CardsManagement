import struct
import zlib
import os

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'icons')


def in_round_rect(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    if x < x0 + r and y < y0 + r:
        return (x - x0 - r) ** 2 + (y - y0 - r) ** 2 <= r * r
    if x > x1 - r and y < y0 + r:
        return (x - x1 + r) ** 2 + (y - y0 + r) ** 2 <= r * r
    if x < x0 + r and y > y1 - r:
        return (x - x0 - r) ** 2 + (y - y1 + r) ** 2 <= r * r
    if x > x1 - r and y > y1 - r:
        return (x - x1 + r) ** 2 + (y - y1 + r) ** 2 <= r * r
    return True


def pixel(size):
    s = size / 512.0

    def fn(x, y):
        px, py = x / s, y / s
        color = (0, 113, 227, 255)

        if in_round_rect(px, py, 96, 150, 416, 354, 30):
            color = (255, 255, 255, 255)
            if py < 188:
                color = (196, 220, 250, 255)

        if in_round_rect(px, py, 118, 188, 410, 384, 30):
            color = (255, 255, 255, 255)
            if in_round_rect(px, py, 150, 228, 206, 270, 9):
                color = (240, 180, 41, 255)
            elif in_round_rect(px, py, 150, 300, 330, 316, 8):
                color = (214, 214, 219, 255)
            elif in_round_rect(px, py, 150, 330, 268, 346, 8):
                color = (232, 232, 237, 255)
            elif 332 <= px <= 394 and 310 <= py <= 350:
                dx1 = (px - 352) ** 2 + (py - 330) ** 2
                dx2 = (px - 374) ** 2 + (py - 330) ** 2
                if dx2 <= 400:
                    color = (150, 195, 243, 255)
                elif dx1 <= 400:
                    color = (214, 232, 253, 255)

        return bytes(color)

    return fn


def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)


def write_png(path, size):
    fn = pixel(size)
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(fn(x, y))
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    data = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(data)
    print('wrote', path, size)


for n in (180, 192, 512):
    write_png(os.path.join(OUT, 'icon-%d.png' % n), n)
