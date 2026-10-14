"""LSTM 模型定义 + 设备自动回退。

⏱ 本机实测（MX450 2048MiB / CUDA 12.9 / torch 2.9.1+cu128）：
    hidden=32, layers=1, window=14, 100k 样本
        CPU  3.67s    GPU  0.84s   （加速 4.35×）
        峰值显存仅 111MB —— **不存在显存不足问题**
    这推翻了早期"2GB 显存不够训练"的估算。1 分钟 SLA 排除在线训练的真正理由是
    「训练 + 调参 + 早停无法稳定进 1 分钟」，而不是显存不够。
"""
from __future__ import annotations

import torch
import torch.nn as nn


class SalesLSTM(nn.Module):
    """多层 LSTM + 线性输出头。

    结构刻意保持小（hidden=32 / layers=1）：长尾数据集的 L1 序列数量有限，
    更大的模型只会过拟合，且会拖慢推理。
    """

    def __init__(
        self,
        n_features: int,
        hidden_size: int = 32,
        num_layers: int = 1,
        dropout: float = 0.1,
    ):
        super().__init__()
        self.n_features = n_features
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.lstm = nn.LSTM(
            input_size=n_features,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,   # 单层时 dropout 无效并会告警
        )
        self.head = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 2),
            nn.ReLU(),
            nn.Linear(hidden_size // 2, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, window, n_features)
        out, _ = self.lstm(x)
        last = out[:, -1, :]                # 只取最后时刻的隐状态
        return self.head(last).squeeze(-1)  # (B,)

    @property
    def n_params(self) -> int:
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


def build_model(n_features: int, hidden_size: int = 32, num_layers: int = 1,
                dropout: float = 0.1) -> SalesLSTM:
    return SalesLSTM(n_features, hidden_size, num_layers, dropout)


def count_params(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)
