import glob, json, math, os, random, sys, time
import numpy as np
import cv2
import torch
import torch.nn.functional as F
from model import RebarNet

torch.set_num_threads(2)
DATA = sys.argv[1]
OUT = sys.argv[2]
EPOCHS = int(sys.argv[3]) if len(sys.argv) > 3 else 8
CROP = int(os.environ.get('CROP', 384))
BS = int(os.environ.get('BS', 12))
STRIDE = 4

labels = {}
for f in glob.glob(os.path.join(DATA, 'labels_*.json')):
    labels.update(json.load(open(f)))
names = sorted(labels)
random.seed(0)
random.shuffle(names)
val_names = names[:150]
train_names = names[150:]
print('train', len(train_names), 'val', len(val_names), flush=True)


def gaussian_targets(pts, h, w):
    """CenterNet-style heatmap + radius map at stride 4."""
    H, W = h // STRIDE, w // STRIDE
    hm = np.zeros((H, W), np.float32)
    rad = np.zeros((H, W), np.float32)
    mask = np.zeros((H, W), np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    for x, y, r in pts:
        cx, cy, rr = x / STRIDE, y / STRIDE, max(r / STRIDE, 0.5)
        if not (0 <= cx < W and 0 <= cy < H):
            continue
        sig = max(0.6, rr * 0.35)
        x0, x1 = int(max(0, cx - 3 * sig - 1)), int(min(W, cx + 3 * sig + 2))
        y0, y1 = int(max(0, cy - 3 * sig - 1)), int(min(H, cy + 3 * sig + 2))
        g = np.exp(-((xx[y0:y1, x0:x1] - cx) ** 2 + (yy[y0:y1, x0:x1] - cy) ** 2) / (2 * sig * sig))
        hm[y0:y1, x0:x1] = np.maximum(hm[y0:y1, x0:x1], g)
        ix, iy = int(cx), int(cy)
        hm[iy, ix] = 1.0
        rad[iy, ix] = math.log(rr)
        mask[iy, ix] = 1
    return hm, rad, mask


def sample(name, train=True):
    img = cv2.imread(os.path.join(DATA, name))[:, :, ::-1]
    pts = np.array(labels[name], np.float32).reshape(-1, 3)
    h, w = img.shape[:2]
    if train:
        s = random.uniform(0.55, 1.5)
        ang = random.choice([0, 90, 180, 270]) + random.uniform(-15, 15)
        M = cv2.getRotationMatrix2D((w / 2, h / 2), ang, s)
        cx, cy = random.uniform(CROP / 2, max(CROP / 2, w - CROP / 2)), random.uniform(CROP / 2, max(CROP / 2, h - CROP / 2))
        c = M @ np.array([cx, cy, 1])
        M[:, 2] += np.array([CROP / 2, CROP / 2]) - c
        img = cv2.warpAffine(img, M, (CROP, CROP), borderMode=cv2.BORDER_REFLECT_101)
        if len(pts):
            p = pts[:, :2] @ M[:, :2].T + M[:, 2]
            pts = np.column_stack([p, pts[:, 2] * s])
        if random.random() < 0.5:
            img = img[:, ::-1]
            if len(pts):
                pts[:, 0] = CROP - 1 - pts[:, 0]
        img = img.astype(np.float32)
        img = img * random.uniform(0.7, 1.3) + random.uniform(-25, 25)
        if random.random() < 0.2:
            g = img.mean(2, keepdims=True)
            img = img * 0.3 + g * 0.7
        img = np.clip(img, 0, 255)
        size = CROP
    else:
        img = cv2.resize(img, (512, 512)).astype(np.float32)
        pts = pts.copy()
        if len(pts):
            pts[:, :2] *= 512 / w
            pts[:, 2] *= 512 / w
        size = 512
    hm, rad, mask = gaussian_targets(pts, size, size)
    x = torch.from_numpy(np.ascontiguousarray(img.transpose(2, 0, 1)) / 255.0).float()
    return x, torch.from_numpy(hm)[None], torch.from_numpy(rad)[None], torch.from_numpy(mask)[None], len(pts)


def focal(logits, gt):
    p = torch.sigmoid(logits).clamp(1e-4, 1 - 1e-4)
    pos = gt.eq(1).float()
    neg = 1 - pos
    pos_loss = torch.log(p) * (1 - p) ** 2 * pos
    neg_loss = torch.log(1 - p) * p ** 2 * (1 - gt) ** 4 * neg
    n = pos.sum().clamp(min=1)
    return -(pos_loss.sum() + neg_loss.sum()) / n


def peaks(logits, thr):
    p = torch.sigmoid(logits)
    m = F.max_pool2d(p, 3, 1, 1)
    return ((p == m) & (p > thr)).sum(dim=(1, 2, 3))


def main():
    net = RebarNet(pretrained=True)
    start = 0
    if os.path.exists(OUT + '.ckpt'):
        ck = torch.load(OUT + '.ckpt')
        net.load_state_dict(ck['net'])
        start = ck['epoch'] + 1
        print('resumed at epoch', start, flush=True)
    opt = torch.optim.AdamW(net.parameters(), lr=1.5e-3, weight_decay=1e-4)
    steps = EPOCHS * (len(train_names) // BS)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 1.5e-3, total_steps=steps, pct_start=0.08)
    for _ in range(start * (len(train_names) // BS)):
        sched.step()
    for ep in range(start, EPOCHS):
        net.train()
        random.shuffle(train_names)
        t0 = time.time()
        tot = 0
        nb = len(train_names) // BS
        for b in range(nb):
            batch = [sample(n) for n in train_names[b * BS:(b + 1) * BS]]
            x = torch.stack([s[0] for s in batch])
            hm = torch.stack([s[1] for s in batch])
            rad = torch.stack([s[2] for s in batch])
            mask = torch.stack([s[3] for s in batch])
            lh, lr = net(x)
            loss = focal(lh, hm) + 0.1 * (F.l1_loss(lr * mask, rad * mask, reduction='sum') / mask.sum().clamp(min=1))
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            tot += loss.item()
            if b % 50 == 0:
                print(f'ep {ep} {b}/{nb} loss {tot / (b + 1):.3f} {time.time() - t0:.0f}s', flush=True)
        # validation: counting error on held-out synthetic images
        net.eval()
        errs = {t: [] for t in (0.25, 0.35, 0.45)}
        with torch.no_grad():
            for i in range(0, len(val_names), 10):
                batch = [sample(n, False) for n in val_names[i:i + 10]]
                x = torch.stack([s[0] for s in batch])
                lh, _ = net(x)
                for t in errs:
                    c = peaks(lh, t)
                    errs[t] += [abs(int(c[k]) - batch[k][4]) / max(1, batch[k][4]) for k in range(len(batch))]
        msg = ' '.join(f'thr{t}: {100 * np.mean(v):.1f}%' for t, v in errs.items())
        print(f'== epoch {ep} done {time.time() - t0:.0f}s  val rel. count error {msg}', flush=True)
        torch.save({'net': net.state_dict(), 'epoch': ep}, OUT + '.ckpt')
    torch.save(net.state_dict(), OUT + '.pt')


if __name__ == '__main__':
    main()
