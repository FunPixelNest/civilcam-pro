"""Count accuracy on real rebar photos (evaluation only; these photos are never used for training).

python3 eval_real.py MODEL.onnx DATASET_DIR [sizes...] [--thr 0.3,0.4]
"""
import glob, os, sys
import numpy as np
import cv2
import onnxruntime as ort

model, root = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
thrs = [0.3, 0.4, 0.5]
if '--thr' in args:
    i = args.index('--thr'); thrs = [float(t) for t in args[i + 1].split(',')]; args = args[:i] + args[i + 2:]
sizes = [int(a) for a in args] or [640, 800]
limit = int(os.environ.get('LIMIT', 250))
sess = ort.InferenceSession(model)
imgs = sorted(glob.glob(os.path.join(root, 'images', '*.jpg')))[int(os.environ.get('OFFSET', 0)):][:limit]


def prep(img, long_side):
    h, w = img.shape[:2]
    s = long_side / max(h, w)
    nh, nw = int(round(h * s / 32)) * 32, int(round(w * s / 32)) * 32
    x = cv2.resize(img, (nw, nh))[:, :, ::-1].astype(np.float32) / 255
    return x.transpose(2, 0, 1)[None], nw / w, nh / h


MERGE = float(os.environ.get('MERGE', 0.7))


def suppress(pk, lr, thr, merge):
    """Keep peaks above thr; drop a peak that lies within merge x radius of a stronger one (same bar)."""
    ys, xs = np.where(pk > thr)
    if merge <= 0 or len(xs) == 0:
        return list(zip(xs, ys))
    sc = pk[ys, xs]
    order = np.argsort(-sc)
    rad = np.exp(lr[ys, xs])
    kept = []
    for i in order:
        x, y = xs[i], ys[i]
        ok = True
        for j in kept:
            if (xs[j] - x) ** 2 + (ys[j] - y) ** 2 < (merge * max(rad[i], rad[j])) ** 2:
                ok = False
                break
        if ok:
            kept.append(i)
    return [(xs[i], ys[i]) for i in kept]


res = {(s, t): [] for s in sizes for t in thrs}
for p in imgs:
    img = cv2.imread(p)
    lab = p.replace('images', 'labels').rsplit('.', 1)[0] + '.txt'
    gt = len(np.loadtxt(lab, ndmin=2)) if os.path.exists(lab) else 0
    for s in sizes:
        x, _, _ = prep(img, s)
        peaks, logr = sess.run(None, {'image': x})
        for t in thrs:
            n = len(suppress(peaks[0, 0], logr[0, 0], t, MERGE))
            res[(s, t)].append((gt, n))
print(f'{len(imgs)} real photos, {np.mean([g for g, _ in res[(sizes[0], thrs[0])]]):.0f} bars on average')
for (s, t), v in res.items():
    g = np.array([a for a, _ in v]); n = np.array([b for _, b in v])
    rel = np.abs(n - g) / np.maximum(g, 1)
    print(f'size {s} thr {t}: mean abs err {np.abs(n - g).mean():5.1f} bars | mean rel err {100 * rel.mean():5.1f}% | '
          f'within 5%: {100 * (rel <= 0.05).mean():4.0f}% | within 10%: {100 * (rel <= 0.10).mean():4.0f}% | exact: {100 * (n == g).mean():3.0f}% | bias {np.mean(n - g):+.1f}')
