import sys, torch
from model import RebarNet
src, dst = sys.argv[1], sys.argv[2]
net = RebarNet(pretrained=False)
if src != 'none':
    sd = torch.load(src, map_location='cpu'); sd = sd.get('net', sd)
    net.load_state_dict(sd)
net.eval()
class Wrap(torch.nn.Module):
    def __init__(s, n): super().__init__(); s.n = n
    def forward(s, x):
        h, r = s.n(x)
        p = torch.sigmoid(h)
        peak = (p == torch.nn.functional.max_pool2d(p, 3, 1, 1)).float() * p   # non-peaks -> 0
        return peak, r
x = torch.rand(1, 3, 640, 640)
torch.onnx.export(Wrap(net), x, dst, input_names=['image'], output_names=['peaks', 'logr'], opset_version=13,
                  dynamic_axes={'image': {2: 'h', 3: 'w'}, 'peaks': {2: 'h4', 3: 'w4'}, 'logr': {2: 'h4', 3: 'w4'}}, dynamo=False)
import onnx; m = onnx.load(dst); onnx.checker.check_model(m)
import onnxruntime as ort, numpy as np
s = ort.InferenceSession(dst); o = s.run(None, {'image': np.random.rand(1, 3, 512, 768).astype(np.float32)})
print('ok', [a.shape for a in o], round(__import__('os').path.getsize(dst)/1e6, 2), 'MB')
