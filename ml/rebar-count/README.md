# Rebar end counter (AI count for material receipts)

Small on-phone model that finds the cut ends of bars in a bundle photo. Used by
`app/src/main/assets/civilcam/js/materials.js`; the exported model is
`app/src/main/assets/civilcam/ai/rebar-count.onnx`.

## Licences
- Code: PyTorch / torchvision (BSD-3). No Ultralytics / YOLO (AGPL) code.
- Backbone starting weights: torchvision MobileNetV3-Large ImageNet weights.
- Training data: only synthetic images drawn by `synth.py` (owned by FunPixelNest).
- On the phone: onnxruntime-web 1.17.3 (MIT), see `assets/civilcam/lib/ort/LICENSE.txt`.
- Public rebar photo sets (DataFountain contest, RANGER) are non-commercial: never train on them.
  They may only be used to test accuracy.

## How it works
MobileNetV3 + small FPN gives two maps at 1/4 resolution: a bar-end heatmap and the
bar radius. Count = peaks above 0.25, merging peaks closer than 0.7 x radius.
The photo is resized to 640 px on the long side.

## Version 1 (22 Nov 2026)
- 4,400 synthetic images (`synth.py`, seeds 1 and 2, 2,200 each), 5 epochs, crop 320, batch 12, CPU, about 50 min.
- Test on 250 real bundle photos (124 bars on average, not used for training):
  mean error 7 bars (5.7%); 63% of photos within 5%; 87% within 10%.
  Held-out halves: 5.4% and 6.1% (settings picked on all 250).
- int8 version: 3.4 MB but slower in the browser runtime and 6.3% error, so fp32 is shipped.

## Retrain
```
pip install torch torchvision onnx onnxruntime opencv-python-headless
python3 synth.py data 2200 1 && python3 synth.py data 2200 2
CROP=320 BS=12 python3 train.py data rebar_v2 5
python3 export.py rebar_v2.pt rebar-count.onnx
python3 eval_real.py rebar-count.onnx <test photo folder with images/ and labels/> 640 --thr 0.2,0.25,0.3
```

## Real photos from users (opt-in, since version 1.5)
- After a signed-in user saves their first material receipt, the app asks once whether to share.
  The setting is in Backup > Help improve AI count.
- Shared: the unstamped bundle photo (960 px, no EXIF/GPS), the checked dots, counts, material and size.
  Not shared: project, location, supplier, challan, vehicle, names.
- Stored in Firestore at `aiTraining/{uid}/samples/{id}` (about 200-300 KB each; the free plan's 1 GB
  holds about 3,000-4,000). Rules: `firebase/firestore.rules`. "Delete account" deletes them.
- `python3 fetch_samples.py real_data` downloads them in the training format.

## Next version
1. Fetch the shared samples. Keep every 5th aside for testing.
2. Train on synthetic + real: put both folders' images and label files in one folder,
   then run `train.py` (start from rebar_v1.pt for a quicker fine-tune).
3. Compare with version 1 on the real photos kept aside, and ship only if it is better.
