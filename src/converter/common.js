export const TYPE_MAP = new Map([
  ['byte', 'i8'], ['Byte', 'i8'],
  ['short', 'i16'], ['Short', 'i16'],
  ['int', 'i32'], ['Int', 'i32'], ['Integer', 'i32'],
  ['long', 'i64'], ['Long', 'i64'],
  ['float', 'f32'], ['Float', 'f32'],
  ['double', 'f64'], ['Double', 'f64'],
  ['boolean', 'bool'], ['Boolean', 'bool'],
  ['char', 'char'], ['Char', 'char'],
  ['String', 'String'], ['string', 'String'],
  ['void', '()'], ['Unit', '()'], ['Any', 'Box<dyn std::any::Any>'],
]);

export function snakeCase(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase();
}

export function rustIdent(name) {
  const keywords = new Set(['as','break','const','continue','crate','else','enum','extern','false','fn','for','if','impl','in','let','loop','match','mod','move','mut','pub','ref','return','self','Self','static','struct','super','trait','true','type','unsafe','use','where','while','async','await','dyn','abstract','become','box','do','final','macro','override','priv','typeof','unsized','virtual','yield','try']);
  const safe = snakeCase(name || 'unnamed') || 'unnamed';
  return keywords.has(safe) ? `r#${safe}` : safe;
}

function splitGenericArgs(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

export function mapType(rawType, { nullable = false } = {}) {
  if (!rawType) return '()';
  let t = rawType.trim().replace(/\bfinal\b/g, '').trim();
  let isNullable = nullable;
  if (t.endsWith('?')) {
    isNullable = true;
    t = t.slice(0, -1).trim();
  }
  if (t.endsWith('[]')) {
    const inner = mapType(t.slice(0, -2));
    const v = `Vec<${inner}>`;
    return isNullable ? `Option<${v}>` : v;
  }
  const generic = t.match(/^([\w.]+)\s*<(.+)>$/);
  if (generic) {
    const base = generic[1].split('.').pop();
    const args = splitGenericArgs(generic[2]).map(x => mapType(x));
    let mapped;
    if (['List','ArrayList','MutableList','Collection','Iterable','Set','HashSet','MutableSet'].includes(base)) mapped = `Vec<${args[0] || '()'}>`;
    else if (['Map','HashMap','MutableMap'].includes(base)) mapped = `std::collections::HashMap<${args[0] || 'String'}, ${args[1] || '()'}>`;
    else if (base === 'Optional') mapped = `Option<${args[0] || '()'}>`;
    else mapped = `${base}<${args.join(', ')}>`;
    return isNullable && !mapped.startsWith('Option<') ? `Option<${mapped}>` : mapped;
  }
  const simple = t.split('.').pop();
  const mapped = TYPE_MAP.get(simple) || simple || '()';
  return isNullable && mapped !== '()' ? `Option<${mapped}>` : mapped;
}

export function splitParams(raw, lang = 'java') {
  if (!raw.trim()) return [];
  const parts = [];
  let angle = 0, paren = 0, bracket = 0, start = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '<') angle++;
    else if (c === '>') angle--;
    else if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === '[') bracket++;
    else if (c === ']') bracket--;
    else if (c === ',' && angle === 0 && paren === 0 && bracket === 0) {
      parts.push(raw.slice(start, i).trim()); start = i + 1;
    }
  }
  parts.push(raw.slice(start).trim());
  return parts.filter(Boolean).map((p) => {
    if (lang === 'kotlin') {
      const m = p.match(/^(?:val|var)?\s*(\w+)\s*:\s*(.+?)(?:\s*=.*)?$/);
      if (m) return { name: rustIdent(m[1]), type: mapType(m[2]) };
    }
    const clean = p.replace(/\bfinal\b/g, '').replace(/@[\w.]+(?:\([^)]*\))?\s*/g, '').trim();
    const m = clean.match(/^(.+?)\s+(\w+)$/);
    if (m) return { name: rustIdent(m[2]), type: mapType(m[1]) };
    return { name: rustIdent(clean), type: '()' };
  });
}

export function extractBalanced(text, openIndex) {
  let depth = 0;
  let quote = null;
  let escape = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { body: text.slice(openIndex + 1, i), end: i };
    }
  }
  return null;
}

export function findTopLevelMembers(body) {
  const members = [];
  let start = 0, depth = 0, quote = null, escape = false, lineComment = false, blockComment = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i], n = body[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (depth === 0 && c === ';') {
      const text = body.slice(start, i + 1).trim();
      if (text) members.push({ kind: 'statement', text });
      start = i + 1;
    } else if (depth === 0 && c === '}') {
      const text = body.slice(start, i + 1).trim();
      if (text) members.push({ kind: 'block', text });
      start = i + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail) members.push({ kind: tail.includes('{') ? 'block' : 'statement', text: tail });
  return members;
}

function splitTopLevelPlus(expr) {
  const parts = [];
  let start = 0, paren = 0, bracket = 0, quote = null, escape = false;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (quote) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(') paren++; else if (c === ')') paren--;
    else if (c === '[') bracket++; else if (c === ']') bracket--;
    else if (c === '+' && paren === 0 && bracket === 0) { parts.push(expr.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(expr.slice(start).trim());
  return parts;
}

function maybeStringConcat(expr) {
  const parts = splitTopLevelPlus(expr);
  if (parts.length < 2 || !parts.some(p => /^".*"$/.test(p) || /^'.*'$/.test(p))) return expr;
  const fmt = parts.map(() => '{}').join('');
  return `format!("${fmt}", ${parts.join(', ')})`;
}

export function convertExpr(expr) {
  let e = expr.trim();
  e = e.replace(/\bthis\./g, 'self.');
  e = e.replace(/\bnull\b/g, 'None');
  e = e.replace(/\.length\b/g, '.len()');
  e = e.replace(/\.size\(\)/g, '.len()');
  e = e.replace(/\.isEmpty\(\)/g, '.is_empty()');
  e = e.replace(/\.equals\(([^)]+)\)/g, ' == $1');
  e = e.replace(/\bnew\s+ArrayList(?:<[^>]*>)?\s*\(\s*\)/g, 'Vec::new()');
  e = e.replace(/\b(?:mutableListOf|arrayListOf)\s*\(([^)]*)\)/g, 'vec![$1]');
  e = e.replace(/\blistOf\s*\(([^)]*)\)/g, 'vec![$1]');
  e = e.replace(/\bnew\s+(\w+)\s*\(/g, '$1::new(');
  e = e.replace(/\bMath\./g, 'f64::');
  e = e.replace(/\bInteger\.parseInt\(([^)]+)\)/g, '$1.parse::<i32>().unwrap()');
  e = maybeStringConcat(e);
  return e;
}

function indentLines(text, count = 1) {
  const p = '    '.repeat(count);
  return text.split('\n').map(line => line ? p + line : line).join('\n');
}

export function convertBlockBody(body, lang = 'java', warnings = [], { fieldNames = [], paramNames = [] } = {}) {
  const lines = body.replace(/\r/g, '').split('\n');
  const out = [];
  const locals = new Set(paramNames);
  const qualifyFields = (text) => {
    let result = text;
    for (const field of fieldNames) {
      if (locals.has(field)) continue;
      const re = new RegExp(`(?<![\w.])${field}\\b`, 'g');
      result = result.replace(re, `self.${field}`);
    }
    return result;
  };
  for (let raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
      out.push(line); continue;
    }
    line = line.replace(/\bthis\./g, 'self.');
    line = line.replace(/System\.out\.println\s*\((.*)\)\s*;/, 'println!("{}", $1);');
    line = line.replace(/System\.out\.print\s*\((.*)\)\s*;/, 'print!("{}", $1);');
    line = line.replace(/println\s*\((.*)\)\s*;?$/, 'println!("{}", $1);');
    line = line.replace(/print\s*\((.*)\)\s*;?$/, 'print!("{}", $1);');

    const javaDecl = line.match(/^(?:final\s+)?([\w.<>, ?\[\]]+)\s+(\w+)\s*=\s*(.+);$/);
    if (lang === 'java' && javaDecl && !/^(return|throw)\b/.test(line)) {
      const [, t, n, expr] = javaDecl;
      let rhs = convertExpr(expr);
      if (mapType(t) === 'String' && /^".*"$/.test(rhs)) rhs += '.to_string()';
      rhs = qualifyFields(rhs);
      const localName = rustIdent(n);
      locals.add(localName);
      out.push(`let mut ${localName}: ${mapType(t)} = ${rhs};`);
      continue;
    }
    const kotlinDecl = line.match(/^(val|var)\s+(\w+)(?:\s*:\s*([^=]+?))?\s*=\s*(.+)$/);
    if (lang === 'kotlin' && kotlinDecl) {
      const [, mut, n, t, expr] = kotlinDecl;
      let rhs = convertExpr(expr.replace(/;$/, ''));
      if ((t?.trim() === 'String' || (!t && /^".*"$/.test(rhs))) && /^".*"$/.test(rhs)) rhs += '.to_string()';
      rhs = qualifyFields(rhs);
      const localName = rustIdent(n);
      locals.add(localName);
      out.push(`let ${mut === 'var' ? 'mut ' : ''}${localName}${t ? `: ${mapType(t.trim())}` : ''} = ${rhs};`);
      continue;
    }

    line = line.replace(/^return\s+(.+?);?$/, (_, x) => `return ${qualifyFields(convertExpr(x))};`);
    line = line.replace(/\btrue\b/g, 'true').replace(/\bfalse\b/g, 'false');
    line = line.replace(/\bnull\b/g, 'None');
    line = line.replace(/\.length\b/g, '.len()').replace(/\.size\(\)/g, '.len()');
    line = line.replace(/\bnew\s+(\w+)\s*\(/g, '$1::new(');
    line = qualifyFields(line);
    if (!line.endsWith('{') && !line.endsWith('}') && !line.endsWith(';')) line += ';';
    out.push(line);
  }
  if (!out.length) return '';
  return indentLines(out.join('\n'), 2);
}

export function visibility(mods = '') {
  return /\bpublic\b/.test(mods) ? 'pub ' : '';
}
