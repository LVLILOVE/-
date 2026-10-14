/**
 * UX-P03 · 注册页（模板 C）
 * -----------------------------------------------------------------------------
 * 依据：UI/UX §7.3；PRD FR-USR-01 ~ 04、NFR-SEC-08；技术文档 §5.4 API-01
 *
 * 交互要点
 *   1. 密码强度 4 段条 + 3 条实时规则（`UX-P03-02`）；
 *      分级：基础规则达标 1 分、字母+数字 1 分、长度 ≥12 1 分、含特殊字符 1 分（`UX-P03-03`）。
 *   2. 🔒 **72 字节上限必须在前端可见**（`JT-12`）
 *      后端 bcrypt 的上限是 72 **字节**而非字符：24 个中文字符就已触顶。
 *      只在提交后由后端拒绝，用户会看到「密码看起来很短却被拒」的困惑。
 *      `passwordByteLength` 与后端 `_enforce_bcrypt_bytes` 同源（`types/index.ts`）。
 *   3. 邮箱已注册（`40105`）→ `.alert-danger`（`UX-P03-05`），并高亮邮箱字段。
 *   4. 注册成功即自动登录进工作台（`UX-P03-07`）。
 *
 * 左栏的数据隐私说明块在 `AuthLayout`（`UX-P03-06`），本页只管表单。
 */
import { useMemo, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import { ERR, LIMITS, isPasswordWithinBcryptLimit, passwordByteLength } from '../types';

type Alert = { title: string; text: string } | null;

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-field)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: '0.875rem',
  outline: 'none',
};

/** 强度分级（`UX-P03-03`）：返回 0~4 段 */
function strengthScore(pw: string): number {
  if (!pw) return 0;
  const okLen = pw.length >= 8;
  const okAlpha = /[A-Za-z]/.test(pw);
  const okNum = /\d/.test(pw);
  let score = 0;
  if (okLen && okAlpha && okNum) score += 1;
  if (okAlpha && okNum) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  return Math.min(4, score);
}

const METER_COLORS = [
  'var(--border-strong)',
  'var(--danger)',
  'var(--warning)',
  'oklch(0.72 0.14 130)',
  'var(--success)',
];

export default function RegisterPage() {
  const navigate = useNavigate();
  const register = useAuthStore((s) => s.register);

  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [alert, setAlert] = useState<Alert>(null);
  const [emailTaken, setEmailTaken] = useState(false);

  const okLen = password.length >= 8;
  const okAlpha = /[A-Za-z]/.test(password);
  const okNum = /\d/.test(password);
  const withinBytes = isPasswordWithinBcryptLimit(password);
  const byteLen = passwordByteLength(password);
  const score = useMemo(() => strengthScore(password), [password]);
  const basicOk = okLen && okAlpha && okNum && withinBytes;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;

    setAlert(null);
    setEmailTaken(false);

    if (!email.trim()) {
      setAlert({ title: '请填写邮箱', text: '邮箱将作为你的登录账号，请填写后重试。' });
      return;
    }
    if (!basicOk) {
      // `UX-P03-04`：弱密码态给出可执行的修正说明
      setAlert({
        title: '密码强度不足',
        text: withinBytes
          ? '密码需至少 8 位，且同时包含字母与数字。'
          : `密码编码后不得超过 ${LIMITS.password_max_bytes} 字节（当前 ${byteLen} 字节）。中文等字符每个占 3 字节，请缩短密码或改用数字与字母。`,
      });
      return;
    }
    if (mismatch) {
      setAlert({ title: '两次输入的密码不一致', text: '请确认「确认密码」与上方密码完全相同。' });
      return;
    }
    if (!agree) {
      setAlert({ title: '请先同意用户协议', text: '需勾选《用户协议》与《数据用途说明》后才能创建账号。' });
      return;
    }

    setSubmitting(true);
    try {
      // authService.register 内部已包含「注册后自动登录」（UX-P03-07）
      await register({ email: email.trim(), password, nickname: nickname.trim() || undefined });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === ERR.EMAIL_TAKEN) {
        setEmailTaken(true);
        setAlert({
          title: '该邮箱已被注册',
          text: `${email.trim()} 已存在账号。可直接登录，或更换邮箱后重试。`,
        });
      } else if (err instanceof ApiError && err.code === ERR.WEAK_PASSWORD) {
        setAlert({ title: '密码不符合要求', text: err.message });
      } else if (err instanceof ApiError && err.code === ERR.BAD_PARAM) {
        setAlert({ title: '注册信息格式有误', text: err.message });
      } else {
        setAlert({
          title: '注册失败',
          text: err instanceof Error ? err.message : '请稍后重试。',
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const rules = [
    { key: 'len', text: '长度不少于 8 位', ok: okLen },
    { key: 'alpha', text: '至少包含 1 个字母', ok: okAlpha },
    { key: 'num', text: '至少包含 1 个数字', ok: okNum },
  ];

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-[1.25rem]">创建账号</h2>
        <p className="mt-1 text-[0.8125rem]" style={{ color: 'var(--text-3)' }}>
          已有账号？<Link to="/login" style={{ color: 'var(--primary)' }}>直接登录</Link>
        </p>
      </div>

      {alert && (
        <div
          className="alert-danger mb-4 flex gap-2.5 rounded-[var(--radius-sm)] px-3.5 py-3"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid color-mix(in oklab, var(--danger) 34%, transparent)',
          }}
          role="alert"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden className="mt-0.5 flex-none">
            <circle cx="12" cy="12" r="9" stroke="var(--danger)" strokeWidth="1.8" />
            <path d="M12 7.5v5.5M12 16.2v.1" stroke="var(--danger)" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <div className="text-[0.75rem] leading-[1.7]">
            <div className="font-bold" style={{ color: 'var(--danger)' }}>{alert.title}</div>
            <p style={{ color: 'var(--text-2)' }}>{alert.text}</p>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate>
        <div className="mb-3.5">
          <label htmlFor="reg-nickname" className="mb-1.5 block text-[0.8125rem] font-semibold">
            昵称
          </label>
          <input
            id="reg-nickname"
            placeholder="用于界面显示，如 王琳"
            value={nickname}
            maxLength={32}
            onChange={(e) => setNickname(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div className="mb-3.5">
          <label htmlFor="reg-email" className="mb-1.5 block text-[0.8125rem] font-semibold">
            邮箱 <span className="text-[0.6875rem] font-normal" style={{ color: 'var(--text-3)' }}>（将作为登录账号）</span>
          </label>
          <input
            id="reg-email"
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={emailTaken}
            style={inputStyle}
          />
          <div className="mt-1 text-[0.6875rem]" style={{ color: 'var(--text-3)' }}>
            邮箱全局唯一，注册后不可修改
          </div>
        </div>

        <div className="mb-3.5">
          <label htmlFor="reg-password" className="mb-1.5 block text-[0.8125rem] font-semibold">
            密码
          </label>
          <input
            id="reg-password"
            type="password"
            autoComplete="new-password"
            placeholder="至少 8 位，含字母与数字"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={password.length > 0 && !basicOk}
            style={inputStyle}
          />

          {/* 强度条（UX-P03-02）。
              ⚠️ 类名 `pw-meter` / `s1..s4` 沿用原型语义命名，**仅作结构与测试钩子**，
                 样式由 Tailwind + 内联令牌承担（原型里同名类由 app.css 提供配色）。
                 保留命名的价值：UI/UX §7.3 的验收项可以直接按类名定位，文档与代码可对账。 */}
          <div className={`pw-meter ${password ? `s${Math.max(1, score)}` : ''} mt-1.5 flex gap-[3px]`} aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="h-[3px] flex-1 rounded-full transition-colors"
                style={{ background: i < score ? METER_COLORS[score] : 'var(--border-strong)' }}
              />
            ))}
          </div>

          {/* 3 条实时规则 */}
          <div className="pw-rules mt-2 flex flex-col gap-[3px]">
            {rules.map((r) => (
              <div
                key={r.key}
                className={`pw-rule ${r.ok ? 'ok' : ''} flex items-center gap-1.5 text-[0.6875rem]`}
                style={{ color: r.ok ? 'oklch(0.62 0.15 155)' : 'var(--text-3)' }}
              >
                <span
                  className="flex h-3 w-3 flex-none items-center justify-center rounded-full"
                  style={{
                    background: r.ok ? 'var(--success)' : 'transparent',
                    border: r.ok ? '1px solid var(--success)' : '1px solid var(--border-strong)',
                  }}
                >
                  {r.ok && (
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                {r.text}
              </div>
            ))}
          </div>

          {/* 72 字节上限的实时提示（JT-12） */}
          <div
            className={withinBytes ? 'byte-hint' : 'byte-hint field-error'}
            data-over={withinBytes ? '0' : '1'}
            style={{
              marginTop: '0.375rem',
              fontSize: '0.6875rem',
              color: withinBytes ? 'var(--text-3)' : 'var(--danger)',
            }}
          >
            密码编码长度 {byteLen} / {LIMITS.password_max_bytes} 字节
            {!withinBytes && '（已超出 bcrypt 上限，请缩短或改用数字与字母）'}
          </div>
        </div>

        <div className="mb-3.5">
          <label htmlFor="reg-confirm" className="mb-1.5 block text-[0.8125rem] font-semibold">
            确认密码
          </label>
          <input
            id="reg-confirm"
            type="password"
            autoComplete="new-password"
            placeholder="再次输入密码"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch}
            style={inputStyle}
          />
          {mismatch && (
            <div className="mt-1 text-[0.6875rem]" style={{ color: 'var(--danger)' }}>
              两次输入的密码不一致
            </div>
          )}
        </div>

        <div className="mb-4">
          <label className="flex cursor-pointer items-start gap-2 text-[0.8125rem]" style={{ color: 'var(--text-2)' }}>
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              className="mt-1"
            />
            <span className="leading-[1.6]">我已阅读并同意《用户协议》与《数据用途说明》</span>
          </label>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-[var(--radius-sm)] py-2.5 text-[0.875rem] font-semibold text-white transition-opacity"
          style={{ background: 'var(--primary)', opacity: submitting ? 0.6 : 1, cursor: submitting ? 'not-allowed' : 'pointer' }}
        >
          {submitting ? '创建中…' : '创建账号'}
        </button>
      </form>

      <div
        className="mt-5 border-t pt-4 text-center text-[0.75rem]"
        style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}
      >
        注册后自动登录，可直接进入工作台
      </div>
    </div>
  );
}
