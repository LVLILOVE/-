# -*- coding: utf-8 -*-
"""MX450 (2GB) vs CPU：LSTM 小模型训练/推理基准测试
用于判断在本机 GPU 上跑预训练是否划算。
"""
import time
import torch
import torch.nn as nn

torch.manual_seed(42)

# ---- 与项目一致的"小模型"配置 ----
HIDDEN = 32
LAYERS = 1
WINDOW = 14
FEAT = 5          # 星期/月份/滞后/滚动均值/节假日 等


class LSTMForecaster(nn.Module):
    def __init__(self, feat=FEAT, hidden=HIDDEN, layers=LAYERS, horizon=14):
        super().__init__()
        self.lstm = nn.LSTM(feat, hidden, layers, batch_first=True)
        self.head = nn.Linear(hidden, horizon)

    def forward(self, x):
        out, _ = self.lstm(x)
        return self.head(out[:, -1, :])


def make_data(n_samples, device):
    x = torch.randn(n_samples, WINDOW, FEAT, device=device)
    y = torch.randn(n_samples, 14, device=device)
    return x, y


def bench(device_name, n_samples=4096, epochs=3, batch=128):
    device = torch.device(device_name)
    if device_name == "cuda":
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()

    model = LSTMForecaster().to(device)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    lossf = nn.MSELoss()
    x, y = make_data(n_samples, device)

    n_params = sum(p.numel() for p in model.parameters())

    # warmup
    for _ in range(2):
        opt.zero_grad()
        loss = lossf(model(x[:batch]), y[:batch])
        loss.backward()
        opt.step()

    if device_name == "cuda":
        torch.cuda.synchronize()
    t0 = time.time()

    for _ in range(epochs):
        for i in range(0, n_samples, batch):
            xb, yb = x[i:i + batch], y[i:i + batch]
            opt.zero_grad()
            loss = lossf(model(xb), yb)
            loss.backward()
            opt.step()

    if device_name == "cuda":
        torch.cuda.synchronize()
    train_t = time.time() - t0

    # 推理
    model.eval()
    if device_name == "cuda":
        torch.cuda.synchronize()
    t1 = time.time()
    with torch.no_grad():
        for i in range(0, n_samples, 512):
            model(x[i:i + 512])
    if device_name == "cuda":
        torch.cuda.synchronize()
    infer_t = time.time() - t1

    peak = 0.0
    if device_name == "cuda":
        peak = torch.cuda.max_memory_allocated() / 1024**2

    return {
        "device": device_name,
        "params": n_params,
        "train_s": train_t,
        "infer_s": infer_t,
        "peak_mb": peak,
    }


if __name__ == "__main__":
    print("=" * 62)
    print(f"基准配置: hidden={HIDDEN}, layers={LAYERS}, window={WINDOW}, "
          f"feat={FEAT}, samples=4096, epochs=3")
    print("=" * 62)

    results = []
    try:
        results.append(bench("cpu"))
    except Exception as e:
        print("CPU 测试失败:", e)

    if torch.cuda.is_available():
        try:
            results.append(bench("cuda"))
        except Exception as e:
            print("GPU 测试失败:", e)
    else:
        print("CUDA 不可用")

    print()
    print(f"{'设备':<8}{'参数量':>10}{'训练(s)':>12}{'推理(s)':>12}{'峰值显存(MB)':>15}")
    for r in results:
        print(f"{r['device']:<8}{r['params']:>10,}{r['train_s']:>12.2f}"
              f"{r['infer_s']:>12.3f}{r['peak_mb']:>15.1f}")

    if len(results) == 2:
        sp = results[0]["train_s"] / results[1]["train_s"]
        print(f"\n>>> GPU 训练加速比: {sp:.2f}x")
