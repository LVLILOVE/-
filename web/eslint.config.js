// ESLint 9 flat config（技术文档 §1.3 使用 eslint ^9.13.0 + @typescript-eslint ^8.10）
// 说明：ESLint 9 已移除 --ext 参数，故 package.json 的 lint 脚本改为 `eslint .`，
// 由这里的 files 通配符限定目标文件。仅启用 @typescript-eslint recommended 规则，
// 避免额外引入 @eslint/js / globals（二者不在依赖清单 §1.3 内）。
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    // 🔴 `.vite/**` 必须忽略（`D-07`）：那是 Vite 的依赖预打包缓存目录，
    //    里面的产物 JS 不是本项目的源码，但 `eslint .` 会把它扫进来，
    //    然后因为找不到它内联引用的第三方规则（react-internal/*、jsx-a11y/*）
    //    而报一堆「Definition for rule ... was not found」。
    //    症状很迷惑：dev server 一跑（生成 .vite/），`npm run lint` 就从全绿变全红，
    //    且报错文件全是 node_modules 里的包名 —— 门禁等于永久失效。
    ignores: ['dist/**', 'node_modules/**', '.vite/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // 本项目依赖 TS 编译器做未定义变量检查（tsc --noEmit 已开 strict），
      // 关闭 ESLint 侧冗余的 no-undef，避免误报浏览器全局。
      '@typescript-eslint/no-explicit-any': 'off',
      // 依赖数组完整性：EP-5 的「右栏内容必须 useMemo 包裹」就靠这条规则兜底。
      // 漏一个依赖 → AsideLayout 无限重渲染 → 页面白屏，而且 tsc 完全查不出来。
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
