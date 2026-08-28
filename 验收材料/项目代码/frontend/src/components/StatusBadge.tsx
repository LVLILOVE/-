// ============================================================
// 代码段功能：预约状态徽章组件（对齐 UIUX §5 预约流程 UI）
// - 将预约 7 状态映射为不同颜色的胶囊徽章（文字+颜色双重指示，无障碍）
// - 状态色：待办琥珀 / 成功绿 / 失败红 / 信息蓝 / 中性灰
// ============================================================

// 状态 → 样式映射表：徽章样式类 + 中文文案
const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  pending_payment: { cls: 'bg-warn-bg text-warn', label: '待支付押金' },
  payment_verify:  { cls: 'bg-warn-bg text-warn', label: '押金待核验' },
  verify_rejected: { cls: 'bg-danger-bg text-danger', label: '核验未通过' },
  confirmed:       { cls: 'bg-success-bg text-success', label: '已确认' },
  completed:       { cls: 'bg-success-bg text-success', label: '已完成' },
  cancelled:       { cls: 'bg-bg-soft text-ink-faint', label: '已取消' },
  no_show:         { cls: 'bg-bg-soft text-ink-faint', label: '爽约' },
}

export default function StatusBadge({ status }: { status: string }) {
  // 未知状态兜底为灰色「未知」
  const s = STATUS_MAP[status] || { cls: 'bg-bg-soft text-ink-faint', label: status }
  return (
    <span className={`inline-block px-3 py-0.5 rounded-full text-[11.5px] font-medium ${s.cls}`}>
      {s.label}
    </span>
  )
}
