/**
 * 全局错误边界（WS-3-04）
 * -----------------------------------------------------------------------------
 * 作用：任何页面组件抛错时，**不白屏**，而是给出一条可操作的兜底 UI。
 * 为什么必须有：`FR-SYS-06` 要求异常可理解、可处置；白屏是「不可理解」的极端。
 *
 * 注意：错误边界**捕获不到**事件处理函数与异步里的异常
 * （React 的既有约束），那两类由 api 层拦截器 + 组件内 try/catch 负责。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null; stack: string | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 控制台留痕：headless 校验会断言「正常路径下 consoleErrors 为 0」，
    // 所以这里只在真的出错时才打日志，不做无条件输出。
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.setState({ stack: info.componentStack ?? null });
  }

  private reset = (): void => {
    this.setState({ error: null, stack: null });
  };

  render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
        <div
          data-testid="error-boundary-fallback"
          className="w-full max-w-[560px] rounded-[var(--radius)] border p-6"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="mb-2 flex items-center gap-2">
            <span
              className="rounded-full px-2 py-[2px] text-[0.6875rem] font-semibold"
              style={{ background: 'var(--danger-soft)', color: 'var(--on-danger-soft)' }}
            >
              页面异常
            </span>
            <h2 className="text-[1.0625rem]">当前页面渲染失败</h2>
          </div>

          <p className="text-[0.8125rem] leading-[1.75]" style={{ color: 'var(--text-2)' }}>
            页面遇到了未预期的错误，你的数据与任务进度不受影响。
            可以尝试<strong style={{ color: 'var(--text)' }}>重新加载</strong>；
            若反复出现，请把下方错误信息反馈给管理员。
          </p>

          <pre
            className="mt-3 max-h-[160px] overflow-auto rounded-[var(--radius-sm)] border p-3 text-[0.6875rem] leading-[1.6]"
            style={{
              background: 'var(--surface-2)',
              borderColor: 'var(--border)',
              color: 'var(--text-2)',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {error.name}: {error.message}
            {stack ? `\n${stack}` : ''}
          </pre>

          <div className="mt-4 flex gap-2.5">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-[var(--radius-sm)] px-3.5 py-1.5 text-[0.8125rem] font-semibold"
              style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
            >
              重新加载
            </button>
            <button
              type="button"
              onClick={this.reset}
              className="rounded-[var(--radius-sm)] border px-3.5 py-1.5 text-[0.8125rem]"
              style={{ borderColor: 'var(--border-field)', color: 'var(--text)' }}
            >
              返回上一状态
            </button>
          </div>
        </div>
      </div>
    );
  }
}
