"""Static int8 quantization (QDQ) of the counting model, calibrated on synthetic images only.
python3 quantize.py in.onnx out.onnx SYNTH_DIR
"""
import glob, os, sys, random
import numpy as np
import cv2
from onnxruntime.quantization import quantize_static, CalibrationDataReader, QuantFormat, QuantType
from onnxruntime.quantization.shape_inference import quant_pre_process

src, dst, synth = sys.argv[1], sys.argv[2], sys.argv[3]
files = sorted(glob.glob(os.path.join(synth, '*.jpg')))
random.seed(1)
files = random.sample(files, 60)


class Reader(CalibrationDataReader):
    def __init__(self):
        self.it = iter(files)

    def get_next(self):
        f = next(self.it, None)
        if f is None:
            return None
        img = cv2.imread(f)
        s = random.choice([512, 640, 800])
        img = cv2.resize(img, (s, s))[:, :, ::-1].astype(np.float32) / 255
        return {'image': img.transpose(2, 0, 1)[None]}


pre = dst + '.pre.onnx'
quant_pre_process(src, pre, skip_symbolic_shape=True)
quantize_static(pre, dst, Reader(), quant_format=QuantFormat.QDQ, activation_type=QuantType.QUInt8,
                weight_type=QuantType.QInt8, per_channel=True,
                nodes_to_exclude=[], extra_options={'ActivationSymmetric': False})
os.remove(pre)
print('quantized', round(os.path.getsize(dst) / 1e6, 2), 'MB')
