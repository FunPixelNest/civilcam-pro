"""Download the AI count samples users chose to share and turn them into training data.

Samples live in Firestore at aiTraining/{uid}/samples/{id} (opt-in in the app). Each has the
unstamped bundle photo (960 px JPEG as a data URL) and the dots the user checked.

Run on a computer signed in to Google Cloud with access to project civilcam-pro-fpn:
    pip install google-cloud-firestore opencv-python-headless numpy
    gcloud auth application-default login
    python3 fetch_samples.py real_data

Writes real_data/img_real_<id>.jpg and real_data/labels_real.json in the same format as synth.py,
so `python3 train.py <folder with synthetic + real images> ...` can mix both.
Keep a part of these real photos aside (for example every 5th) to measure accuracy.
"""
import base64, json, os, sys
import numpy as np
from google.cloud import firestore

out = sys.argv[1] if len(sys.argv) > 1 else 'real_data'
os.makedirs(out, exist_ok=True)
db = firestore.Client(project='civilcam-pro-fpn')
labels, n, skipped = {}, 0, 0
for doc in db.collection_group('samples').stream():
    if not doc.reference.path.startswith('aiTraining/'):
        continue
    d = doc.to_dict()
    pts = [tuple(map(float, t.split(',')[:2])) for t in str(d.get('pts', '')).split(';') if t]
    if not pts or not str(d.get('img', '')).startswith('data:image/jpeg;base64,'):
        skipped += 1
        continue
    w, h = int(d['w']), int(d['h'])
    xy = np.array([(x * w, y * h) for x, y in pts], np.float32)
    # bar radius from the spacing of neighbouring dots (bars in a bundle touch)
    if len(xy) > 1:
        dist = np.sqrt(((xy[:, None, :] - xy[None, :, :]) ** 2).sum(-1))
        np.fill_diagonal(dist, np.inf)
        r = float(np.median(dist.min(1)) / 2)
    else:
        r = min(w, h) * 0.03
    name = f'img_real_{doc.id}.jpg'
    with open(os.path.join(out, name), 'wb') as f:
        f.write(base64.b64decode(d['img'].split(',', 1)[1]))
    labels[name] = [[round(float(x), 1), round(float(y), 1), round(r, 1)] for x, y in xy]
    n += 1
json.dump(labels, open(os.path.join(out, 'labels_real.json'), 'w'))
print(f'{n} samples saved to {out}, {skipped} skipped')
