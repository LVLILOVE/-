/**
 * 校验 code/frontend/*.ts 的 TypeScript 语法正确性。
 *
 * 用法：
 *   NODE_PATH=<node workspace>/node_modules node scripts/verify_types.mjs
 *
 * 说明：采用 transpileModule 做「纯语法检查」——不解析 import 依赖，
 * 因此无需安装 axios / vite 即可验证。可抓住括号不匹配、泛型语法错误、
 * 非法修饰符等真实语法问题。同时统计导出的类型与接口数量。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TS_PATH =
  process.env.WB_TS_PATH ||
  'C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/typescript';
const ts = require(TS_PATH);

const ROOT = path.resolve(process.cwd());
const FILES = ['code/frontend/types.ts', 'code/frontend/api-client.ts'];

const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  strict: true,
  isolatedModules: true,
};

let totalErrors = 0;

console.log('='.repeat(62));
console.log('TypeScript 语法检查（transpileModule）');
console.log('='.repeat(62));
console.log(`typescript ${ts.version}`);
console.log('');

for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.log(`[FAIL] 找不到文件 ${rel}`);
    totalErrors += 1;
    continue;
  }

  const source = fs.readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(abs, source, ts.ScriptTarget.ES2022, true);

  // 1) 解析诊断：能抓住括号 / 引号 / 语法结构错误
  const parseDiags = sf.parseDiagnostics ?? [];
  // 2) 转译诊断：能抓住 isolatedModules 下的类型导出等约束
  const out = ts.transpileModule(source, {
    compilerOptions,
    fileName: abs,
    reportDiagnostics: true,
  });
  const transDiags = out.diagnostics ?? [];

  const diags = [...parseDiags, ...transDiags];
  const errs = diags.filter((d) => d.category === ts.DiagnosticCategory.Error);
  const warns = diags.filter((d) => d.category === ts.DiagnosticCategory.Warning);

  const lines = source.split('\n').length;

  // 统计导出项
  let types = 0;
  let interfaces = 0;
  let consts = 0;
  let functions = 0;
  sf.forEachChild((node) => {
    const exported = (node.modifiers ?? []).some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!exported) return;
    switch (node.kind) {
      case ts.SyntaxKind.TypeAliasDeclaration:
        types += 1;
        break;
      case ts.SyntaxKind.InterfaceDeclaration:
        interfaces += 1;
        break;
      case ts.SyntaxKind.VariableStatement:
        consts += 1;
        break;
      case ts.SyntaxKind.FunctionDeclaration:
        functions += 1;
        break;
      default:
        break;
    }
  });

  if (errs.length === 0) {
    console.log(
      `[ OK ] ${rel}  ${lines} 行 · 导出 类型${types} 接口${interfaces} 常量${consts} 函数${functions}` +
        (warns.length ? ` · 警告 ${warns.length}` : ''),
    );
  } else {
    totalErrors += errs.length;
    console.log(`[FAIL] ${rel}  发现 ${errs.length} 个错误：`);
    for (const d of errs.slice(0, 10)) {
      const pos = d.file && d.start != null ? sf.getLineAndCharacterOfPosition(d.start) : null;
      const where = pos ? ` (第 ${pos.line + 1} 行)` : '';
      console.log(`         - ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}${where}`);
    }
  }
}

console.log('='.repeat(62));
console.log(totalErrors === 0 ? '结论：全部通过' : `结论：共 ${totalErrors} 个语法错误`);
process.exit(totalErrors === 0 ? 0 : 1);
