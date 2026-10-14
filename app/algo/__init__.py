"""算法层 · 无 Web 依赖（架构红线 1）

本层**禁止** import fastapi / sqlalchemy / pydantic。
在线推理与离线训练共用同一份代码，保证「离线评估达标 = 在线结果一致」。

模块职责：
    preprocess  数据校验、插值、异常截断
    features    滑动窗口 + 时间/滞后/滚动特征
    classify    序列分级 L1/L2/L3（后续所有环节的分流依据）
    model       LSTM 定义 + 设备自动回退
    train       仅离线调用：训练 + 早停 + 网格搜索
    infer       在线主路径：加载已注册权重 + 批量推理
    fallback    L2/L3 规则兜底
    metrics     加权 MAE/RMSE/MAPE + 移动平均基线 + 达标序列占比
"""

__all__ = [
    "preprocess",
    "features",
    "classify",
    "model",
    "train",
    "infer",
    "fallback",
    "metrics",
]
