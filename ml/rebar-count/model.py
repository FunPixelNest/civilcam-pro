"""Rebar end counter: MobileNetV3 backbone + light FPN -> centre heatmap and radius at stride 4.

Each bar end is a peak in the heatmap; count = number of peaks above a threshold.
Licences: PyTorch/torchvision (BSD-3). No Ultralytics/AGPL code.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision


class CBR(nn.Sequential):
    def __init__(self, i, o, k=3):
        super().__init__(nn.Conv2d(i, o, k, padding=k // 2, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True))


class RebarNet(nn.Module):
    def __init__(self, pretrained=True, ch=64):
        super().__init__()
        w = torchvision.models.MobileNet_V3_Large_Weights.IMAGENET1K_V1 if pretrained else None
        feats = torchvision.models.mobilenet_v3_large(weights=w).features
        self.s4 = feats[:4]      # 24 ch, stride 4
        self.s8 = feats[4:7]     # 40 ch, stride 8
        self.s16 = feats[7:13]   # 112 ch, stride 16
        self.s32 = feats[13:16]  # 160 ch, stride 32
        self.l4, self.l8, self.l16, self.l32 = (nn.Conv2d(c, ch, 1) for c in (24, 40, 112, 160))
        self.smooth = nn.Sequential(CBR(ch, ch), CBR(ch, ch))
        self.hm = nn.Conv2d(ch, 1, 1)
        self.rad = nn.Conv2d(ch, 1, 1)
        nn.init.constant_(self.hm.bias, -2.19)   # prior 0.1
        self.register_buffer('mean', torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        self.register_buffer('std', torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))

    def forward(self, x):
        """x: float RGB in [0, 1], NCHW, H and W multiples of 32."""
        x = (x - self.mean) / self.std
        c4 = self.s4(x)
        c8 = self.s8(c4)
        c16 = self.s16(c8)
        c32 = self.s32(c16)
        p = self.l32(c32)
        p = F.interpolate(p, scale_factor=2.0, mode='nearest') + self.l16(c16)
        p = F.interpolate(p, scale_factor=2.0, mode='nearest') + self.l8(c8)
        p = F.interpolate(p, scale_factor=2.0, mode='nearest') + self.l4(c4)
        p = self.smooth(p)
        return self.hm(p), self.rad(p)   # logits; log-radius in stride-4 pixels
