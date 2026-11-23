"""Synthetic rebar-bundle photos (v2): bars drawn as 3-D-looking cylinders that recede
toward a vanishing point, with ribbed bodies, sheared irregular end faces, staggered
ends and piles of loose rebar around them. Everything is drawn from scratch.

Usage: python3 synth.py OUT_DIR COUNT SEED
Writes OUT_DIR/img_SS_NNNNN.jpg and OUT_DIR/labels_SS.json  {name: [[x, y, r], ...]}.
"""
import json, math, os, sys
import numpy as np
import cv2

R = np.random.default_rng(0)
SIZE = 640


def rnd(a, b):
    return float(R.uniform(a, b))


def col(c):
    return tuple(float(x) for x in np.clip(c, 0, 255))


def noise(h, w, scale, octaves=4):
    acc = np.zeros((h, w), np.float32)
    amp, tot, s = 1.0, 0.0, scale
    for _ in range(octaves):
        g = R.random((max(2, int(h / s) + 2), max(2, int(w / s) + 2))).astype(np.float32)
        acc += amp * cv2.resize(g, (w, h), interpolation=cv2.INTER_CUBIC)
        tot += amp
        amp *= 0.5
        s = max(1.5, s / 2)
    return np.clip(acc / tot, 0, 1)


def steel_colour():
    k = R.random()
    if k < 0.45:   # blue-grey mill scale (BGR)
        g = rnd(70, 150)
        return np.array([g + rnd(5, 30), g + rnd(0, 15), g - rnd(0, 15)], np.float32)
    if k < 0.75:   # dark grey
        g = rnd(35, 90)
        return np.array([g + rnd(0, 15), g, g - rnd(0, 10)], np.float32)
    return np.array([rnd(30, 70), rnd(60, 110), rnd(110, 170)], np.float32)  # rusty


def draw_body(img, p, q, r0, r1, base, ribs=True):
    """Ribbed cylinder from p (near end) to q (far end), radii r0 -> r1."""
    d = q - p
    L = float(np.hypot(*d))
    if L < 2:
        return
    u = d / L
    n = np.array([-u[1], u[0]], np.float32)
    poly = np.float32([p + n * r0, q + n * r1, q - n * r1, p - n * r0])
    cv2.fillConvexPoly(img, poly.astype(np.int32), col(base * rnd(0.55, 0.85)))
    # lit strip and dark edge give a round look
    cv2.line(img, tuple((p + n * r0 * 0.45).astype(int)), tuple((q + n * r1 * 0.45).astype(int)),
             col(base * rnd(1.1, 1.6)), max(1, int(r0 * 0.35)))
    cv2.line(img, tuple((p - n * r0 * 0.85).astype(int)), tuple((q - n * r1 * 0.85).astype(int)),
             col(base * 0.3), max(1, int(r0 * 0.25)))
    if ribs and r0 > 3:
        step = max(3.0, r0 * rnd(0.55, 0.9))
        lean = rnd(-0.6, 0.6)
        t = rnd(0, step)
        while t < L:
            f = t / L
            rr = r0 + (r1 - r0) * f
            c = p + u * t
            a = c + n * rr * 0.95 + u * rr * lean
            b = c - n * rr * 0.95 - u * rr * lean
            cv2.line(img, tuple(a.astype(int)), tuple(b.astype(int)),
                     col(base * (rnd(1.2, 1.7) if R.random() < 0.6 else 0.35)), max(1, int(rr * 0.18)))
            t += step * (1 + f * 0.0)


def loose_rebar_layer(img, count, area=None):
    """Lots of bars lying side-on (seen along their length): must NOT be counted."""
    h, w = img.shape[:2]
    ang = rnd(0, math.pi)
    for _ in range(count):
        a = ang + rnd(-0.25, 0.25)
        u = np.array([math.cos(a), math.sin(a)], np.float32)
        c = np.array([rnd(0, w), rnd(0, h)], np.float32) if area is None else \
            np.array([rnd(area[0], area[2]), rnd(area[1], area[3])], np.float32)
        L = rnd(w * 0.3, w * 1.5)
        r = rnd(3, 14)
        draw_body(img, c - u * L / 2, c + u * L / 2, r, r * rnd(0.7, 1.0), steel_colour())


def background(h, w):
    k = R.integers(0, 4)
    if k == 0:
        g = rnd(90, 200)
        base = np.array([g - rnd(0, 20), g, g + rnd(0, 15)], np.float32)   # ground / concrete
    elif k == 1:
        base = np.array([rnd(40, 90), rnd(70, 120), rnd(100, 160)], np.float32)  # soil
    elif k == 2:
        base = np.array([rnd(190, 250), rnd(180, 240), rnd(160, 230)], np.float32)  # sky / bright shed
    else:
        base = np.array([rnd(15, 60)] * 3, np.float32)   # dark shed
    img = base[None, None, :] * (0.6 + 0.8 * noise(h, w, rnd(10, 150))[..., None])
    for _ in range(R.integers(0, 6)):   # tarpaulin, tags, timber, buildings
        c = R.uniform(20, 240, 3)
        x, y = int(rnd(0, w)), int(rnd(0, h))
        cv2.rectangle(img, (x, y), (x + int(rnd(15, w / 3)), y + int(rnd(15, h / 3))), col(c), -1)
    if R.random() < 0.85:
        loose_rebar_layer(img, int(R.integers(10, 120)))
    return img


def pack(shape_kind, n_target, step):
    a, b = 1.0, rnd(0.6, 1.0)
    if shape_kind == 2:
        b = rnd(0.3, 0.6)
    rad = math.sqrt(n_target / (math.pi * a * b)) * step * 0.53
    rows = int(math.sqrt(n_target) * 1.8) + 4
    pts = []
    for i in range(-rows, rows + 1):
        for j in range(-rows, rows + 1):
            x = (j + (0.5 if i % 2 else 0)) * step
            y = i * step * 0.866
            if shape_kind in (0, 2):
                inside = (x / (rad * a)) ** 2 + (y / (rad * b)) ** 2 <= 1
            elif shape_kind == 1:
                inside = abs(x) <= rad * a * 0.9 and abs(y) <= rad * b * 0.9
            else:
                ang = math.atan2(y, x)
                rr = rad * (1 + 0.22 * math.sin(3 * ang + 1.3) + 0.12 * math.cos(5 * ang))
                inside = math.hypot(x, y / b) <= rr
            if inside and R.random() > 0.04:
                j_ = step * rnd(0.05, 0.16)
                pts.append([x + rnd(-j_, j_), y + rnd(-j_, j_)])
    return np.array(pts, np.float32)


def cap_polygon(c, r, squash, squash_dir):
    """Irregular sheared end: 5-9 corners, flattened along the viewing tilt."""
    k = int(R.integers(5, 10))
    angs = np.sort(R.uniform(0, 2 * math.pi, k)) if R.random() < 0.5 else \
        np.linspace(0, 2 * math.pi, k, endpoint=False) + rnd(0, 6.3)
    rr = r * R.uniform(0.82, 1.12, k)
    pts = np.stack([np.cos(angs) * rr, np.sin(angs) * rr], 1).astype(np.float32)
    if R.random() < 0.3:   # shear flattening (crushed end)
        f = rnd(0.65, 0.9)
        th = rnd(0, math.pi)
        Rm = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]], np.float32)
        pts = pts @ Rm.T
        pts[:, 1] *= f
        pts = pts @ Rm
    # foreshortening from the camera tilt
    u = squash_dir
    n = np.array([-u[1], u[0]], np.float32)
    a = pts @ u
    b = pts @ n
    pts = np.outer(a * squash, u) + np.outer(b, n)
    return pts + c


def draw_cap(img, c, r, squash, sdir, face, rim, recess):
    poly = cap_polygon(c, r, squash, sdir)
    cv2.fillPoly(img, [np.round(poly).astype(np.int32)], col(rim * recess))
    inner = c + (poly - c) * rnd(0.6, 0.85)
    cv2.fillPoly(img, [np.round(inner).astype(np.int32)], col(face * recess))
    # tint patches: blue/purple heat tint, rust, paint
    k = R.random()
    if k < 0.35:
        tint = np.array(R.choice([[200, 90, 90], [190, 80, 150], [90, 140, 220], [40, 110, 200], [60, 60, 210]]), np.float32)
        cc = c + R.uniform(-0.4, 0.4, 2).astype(np.float32) * r
        cv2.circle(img, tuple(cc.astype(int)), max(1, int(r * rnd(0.2, 0.6))), col(tint * recess), -1)
    # rib notches on two sides
    if R.random() < 0.7 and r > 4:
        for s in (-1, 1):
            th = rnd(0, 6.3)
            p = c + s * np.array([math.cos(th), math.sin(th)], np.float32) * r
            cv2.circle(img, tuple(p.astype(int)), max(1, int(r * 0.2)), col(rim * 0.4 * recess), -1)
    # thin dark outline between neighbours
    cv2.polylines(img, [np.round(poly).astype(np.int32)], True, col(rim * 0.25), max(1, int(r * 0.08)))
    return poly


def bundle(size=SIZE):
    W = H = int(size * 1.6)
    img = background(H, W)
    n_target = int(R.choice([R.integers(6, 40), R.integers(40, 130), R.integers(130, 280)], p=[0.25, 0.45, 0.30]))
    r = rnd(10, 30) if n_target < 130 else rnd(7, 17)
    step = 2 * r * rnd(0.98, 1.15)
    pts = pack(int(R.integers(0, 4)), n_target, step)
    if len(pts) < 3:
        return None
    centre = np.array([W / 2, H / 2], np.float32)
    pts += centre
    # bars recede toward a vanishing point behind the bundle
    va = rnd(0, 2 * math.pi)
    vdist = rnd(1.5, 6.0) * W
    vp = centre + np.array([math.cos(va), math.sin(va)], np.float32) * vdist
    depth = rnd(0.15, 0.55)              # how far along toward vp the visible bodies run
    sdir = (vp - centre) / np.linalg.norm(vp - centre)
    squash = rnd(0.55, 1.0)              # end faces seen at an angle look flattened
    base = steel_colour()
    face_kind = R.random()
    if face_kind < 0.5:
        g = rnd(150, 245)
        face = np.array([g * rnd(0.95, 1.05), g, g * rnd(0.9, 1.0)], np.float32)  # bright cut
    elif face_kind < 0.8:
        face = np.array([rnd(40, 90), rnd(90, 150), rnd(150, 220)], np.float32)   # rusty cut
    else:
        face = base * rnd(1.2, 1.8)
    rim = base * rnd(0.8, 1.3)
    # staggered ends: some bars stop short (further along toward vp)
    stagger = rnd(0, 0.5) if R.random() < 0.7 else 0.0
    recess_t = np.where(R.random(len(pts)) < stagger, R.uniform(0.01, 0.06, len(pts)), 0.0).astype(np.float32)
    ends = pts + (vp - pts) * recess_t[:, None]
    scale = 1 - recess_t * 2.5
    # bodies first (far ones first)
    dist = np.linalg.norm(vp - ends, axis=1)
    hull = cv2.convexHull(ends.astype(np.int32))
    cv2.fillConvexPoly(img, hull, col(base * 0.15))
    order = np.argsort(-dist)
    for i in order:
        p = ends[i]
        q = p + (vp - p) * depth
        draw_body(img, p, q, r * scale[i] * 0.95, r * scale[i] * 0.95 * (1 - depth), base * rnd(0.8, 1.2), ribs=R.random() < 0.6)
    # end caps: recessed first so front caps overlap them
    labels = []
    for i in np.argsort(-recess_t):
        rr = r * scale[i] * rnd(0.92, 1.06)
        shade = 1.0 if recess_t[i] == 0 else rnd(0.55, 0.9)
        shade *= rnd(0.75, 1.15)
        f = face * rnd(0.8, 1.15) if R.random() < 0.8 else rim * rnd(0.9, 1.4)
        draw_cap(img, ends[i], rr, squash, sdir, f, rim * rnd(0.8, 1.2), shade)
        labels.append([float(ends[i][0]), float(ends[i][1]), float(rr)])
    labels = np.array(labels, np.float32)
    if R.random() < 0.5:   # binding wire across the face
        a, b = R.choice(len(labels), 2)
        cv2.line(img, tuple(labels[a, :2].astype(int)), tuple(labels[b, :2].astype(int)), (60, 60, 60), max(1, int(r * 0.15)))
    if R.random() < 0.4:   # loose bars lying in front at the bottom
        loose_rebar_layer(img, int(R.integers(3, 25)), (0, H * 0.75, W, H))
    # in-plane rotation, zoom and crop
    ang = rnd(-25, 25) if R.random() < 0.8 else rnd(-180, 180)
    xmin, ymin = labels[:, :2].min(0)
    xmax, ymax = labels[:, :2].max(0)
    span = max(xmax - xmin, ymax - ymin) + 2 * r
    crop = span / rnd(0.5, 1.0)
    cx = (xmin + xmax) / 2 + rnd(-0.12, 0.12) * crop
    cy = (ymin + ymax) / 2 + rnd(-0.12, 0.12) * crop
    S = size / crop
    M = cv2.getRotationMatrix2D((float(cx), float(cy)), ang, S)
    M[:, 2] += np.float32([size / 2 - cx, size / 2 - cy])
    img = cv2.warpAffine(img, M, (size, size), borderMode=cv2.BORDER_REFLECT)
    labels[:, :2] = labels[:, :2] @ M[:, :2].T + M[:, 2]
    labels[:, 2] *= S
    keep = (labels[:, 0] >= 0) & (labels[:, 1] >= 0) & (labels[:, 0] < size) & (labels[:, 1] < size)
    return finish(img, labels[keep])


def finish(img, labels, size=SIZE):
    img = img.astype(np.float32) * rnd(0.55, 1.45) + rnd(-35, 35)
    img = img * R.uniform(0.85, 1.15, 3)[None, None, :]
    if R.random() < 0.5:
        yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
        g = 1 - rnd(0, 0.6) * (((xx - rnd(0, size)) ** 2 + (yy - rnd(0, size)) ** 2) / size ** 2)
        img = img * g[..., None]
    if R.random() < 0.3:
        poly = np.int32([[rnd(0, size), 0], [rnd(0, size), 0], [rnd(0, size), size], [rnd(0, size), size]])
        m = np.zeros((size, size), np.float32)
        cv2.fillPoly(m, [poly], 1)
        img = img * (1 - rnd(0.2, 0.6) * cv2.GaussianBlur(m, (0, 0), 3))[..., None]
    if R.random() < 0.12:   # blacked-out regions (privacy masks in some photo sets)
        m = np.zeros((size, size), np.uint8)
        for _ in range(R.integers(1, 4)):
            cv2.circle(m, (int(rnd(0, size)), int(rnd(0, size))), int(rnd(40, 200)), 1, -1)
        img[m > 0] = 0
        if len(labels):
            xi = np.clip(labels[:, 0].astype(int), 0, size - 1)
            yi = np.clip(labels[:, 1].astype(int), 0, size - 1)
            labels = labels[m[yi, xi] == 0]
    if R.random() < 0.7:
        img = cv2.GaussianBlur(img, (0, 0), rnd(0.3, 1.5))
    img = img + R.normal(0, rnd(0, 8), img.shape)
    img = np.clip(img, 0, 255).astype(np.uint8)
    img = cv2.imdecode(cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, int(rnd(45, 95))])[1], cv2.IMREAD_COLOR)
    return img, labels


def negative(size=SIZE):
    img = background(size, size)
    if R.random() < 0.7:
        loose_rebar_layer(img, int(R.integers(20, 150)))
    for _ in range(R.integers(0, 4)):
        cv2.circle(img, (int(rnd(0, size)), int(rnd(0, size))), int(rnd(60, 220)), col(R.uniform(20, 230, 3)), int(rnd(-1, 25)))
    return finish(img, np.zeros((0, 3), np.float32))


if __name__ == '__main__':
    out, n, seed = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    R = np.random.default_rng(seed)
    os.makedirs(out, exist_ok=True)
    labels = {}
    i = 0
    while i < n:
        res = negative() if R.random() < 0.07 else bundle()
        if res is None:
            continue
        img, lab = res
        name = f'img_{seed:02d}_{i:05d}.jpg'
        cv2.imwrite(os.path.join(out, name), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        labels[name] = np.round(lab, 1).tolist()
        i += 1
    json.dump(labels, open(os.path.join(out, f'labels_{seed:02d}.json'), 'w'))
    print('wrote', n)
