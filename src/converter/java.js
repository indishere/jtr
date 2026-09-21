import { convertBlockBody, extractBalanced, findTopLevelMembers, mapType, rustIdent, splitParams, visibility } from './common.js';

function parseField(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const m = clean.match(/^(?<mods>(?:(?:public|protected|private|static|final|volatile|transient)\s+)*)?(?<type>[\w.<>, ?\[\]]+)\s+(?<name>\w+)\s*(?:=\s*(?<init>.+?))?;$/);
  if (!m) return null;
  return { ...m.groups, mods: m.groups.mods || '' };
}

function parseCallable(text, className) {
  const brace = text.indexOf('{');
  if (brace < 0) return null;
  const header = text.slice(0, brace).replace(/\s+/g, ' ').trim();
  const balanced = extractBalanced(text, brace);
  if (!balanced) return null;
  const ctor = header.match(new RegExp(`^(?<mods>(?:(?:public|protected|private)\\s+)*)${className}\\s*\\((?<params>.*)\\)(?:\\s+throws\\s+.+)?$`));
  if (ctor) return { kind: 'constructor', mods: ctor.groups.mods || '', params: ctor.groups.params, body: balanced.body };
  const meth = header.match(/^(?<mods>(?:(?:public|protected|private|static|final|synchronized|abstract|native)\s+)*)?(?<ret>[\w.<>, ?\[\]]+)\s+(?<name>\w+)\s*\((?<params>.*)\)(?:\s+throws\s+.+)?$/);
  if (!meth) return null;
  return { kind: 'method', ...meth.groups, mods: meth.groups.mods || '', body: balanced.body };
}

function convertClass(name, mods, body, warnings) {
  const members = findTopLevelMembers(body);
  const fields = [];
  const callables = [];
  for (const member of members) {
    if (member.kind === 'statement') {
      const field = parseField(member.text);
      if (field) fields.push(field);
      else if (member.text && !member.text.startsWith('static {')) warnings.push(`Unsupported class statement in ${name}: ${member.text.slice(0, 80)}`);
    } else {
      const callable = parseCallable(member.text, name);
      if (callable) callables.push(callable);
      else if (/^(?:public\s+)?(?:class|interface|enum)\b/.test(member.text.trim())) warnings.push(`Nested type in ${name} preserved as TODO`);
      else warnings.push(`Unsupported block in ${name}: ${member.text.slice(0, 80).replace(/\s+/g,' ')}`);
    }
  }

  const structFields = fields.filter(f => !/\bstatic\b/.test(f.mods)).map(f => `    ${visibility(f.mods)}${rustIdent(f.name)}: ${mapType(f.type)},`);
  const lines = [`#[derive(Debug, Clone)]`, `${visibility(mods)}struct ${name} {`, ...structFields, `}`];
  lines.push('', `impl ${name} {`);

  for (const c of callables) {
    if (c.kind === 'constructor') {
      const params = splitParams(c.params, 'java');
      const bodyRust = convertBlockBody(c.body, 'java', warnings, { fieldNames: fields.map(f => f.name), paramNames: params.map(p => p.name) });
      const assignments = fields.filter(f => !/\bstatic\b/.test(f.mods)).map(f => {
        const rn = rustIdent(f.name);
        const fromBody = new RegExp(`self\\.${f.name}\\s*=\\s*${f.name}\\s*;?`).test(bodyRust);
        if (fromBody || params.some(p => p.name === rn)) return `            ${rn}: ${rn},`;
        if (f.init) return `            ${rn}: ${f.init.replace(/"([^"]*)"/, '"$1".to_string()')},`;
        return `            ${rn}: Default::default(),`;
      });
      lines.push(`    ${visibility(c.mods)}fn new(${params.map(p => `${p.name}: ${p.type}`).join(', ')}) -> Self {`);
      lines.push('        Self {', ...assignments, '        }', '    }', '');
    } else {
      const params = splitParams(c.params, 'java');
      const isStatic = /\bstatic\b/.test(c.mods);
      const mutates = /\bself\.\w+\s*=/.test(c.body.replace(/\bthis\./g, 'self.'));
      const selfArg = isStatic ? [] : [mutates ? '&mut self' : '&self'];
      const allParams = [...selfArg, ...params.map(p => `${p.name}: ${p.type}`)].join(', ');
      const ret = mapType(c.ret);
      lines.push(`    ${visibility(c.mods)}fn ${rustIdent(c.name)}(${allParams})${ret === '()' ? '' : ` -> ${ret}`} {`);
      const converted = convertBlockBody(c.body, 'java', warnings, { fieldNames: fields.map(f => f.name), paramNames: params.map(p => p.name) });
      lines.push(converted || '        // TODO: translated body was empty');
      lines.push('    }', '');
    }
  }

  for (const f of fields.filter(f => /\bstatic\b/.test(f.mods))) {
    warnings.push(`Static field ${name}.${f.name} needs manual Rust ownership/lifetime review`);
  }

  lines.push('}');
  return lines.join('\n');
}

function convertInterface(name, mods, body, warnings) {
  const members = findTopLevelMembers(body);
  const out = [`${visibility(mods)}trait ${name} {`];
  for (const member of members) {
    const text = member.text.replace(/;$/, '').trim();
    const m = text.match(/^(?<mods>(?:(?:public|protected|private|static|default|abstract)\s+)*)?(?<ret>[\w.<>, ?\[\]]+)\s+(?<name>\w+)\s*\((?<params>.*)\)$/);
    if (!m) { warnings.push(`Unsupported interface member in ${name}: ${text.slice(0, 80)}`); continue; }
    const params = splitParams(m.groups.params, 'java');
    const ret = mapType(m.groups.ret);
    out.push(`    fn ${rustIdent(m.groups.name)}(&self${params.length ? ', ' : ''}${params.map(p => `${p.name}: ${p.type}`).join(', ')})${ret === '()' ? '' : ` -> ${ret}`};`);
  }
  out.push('}');
  return out.join('\n');
}

function convertEnum(name, mods, body) {
  const head = body.split(';')[0];
  const variants = head.split(',').map(v => v.trim()).filter(v => /^\w+$/.test(v));
  return `#[derive(Debug, Clone, Copy, PartialEq, Eq)]\n${visibility(mods)}enum ${name} {\n${variants.map(v => `    ${v},`).join('\n')}\n}`;
}

export function convertJava(source, fileName = 'input.java') {
  const warnings = [];
  let text = source.replace(/^\s*package\s+[\w.]+\s*;\s*$/gm, '').replace(/^\s*import\s+[^;]+;\s*$/gm, '');
  const out = [`// Generated by jtr from ${fileName}. Review before production use.`];
  const re = /(?<mods>(?:(?:public|protected|private|abstract|final|static|sealed|non-sealed)\s+)*)?(?<kind>class|interface|enum)\s+(?<name>\w+)[^{]*\{/g;
  let match;
  let found = false;
  while ((match = re.exec(text))) {
    found = true;
    const open = re.lastIndex - 1;
    const bal = extractBalanced(text, open);
    if (!bal) { warnings.push(`Unbalanced type ${match.groups.name}`); break; }
    const { kind, name, mods = '' } = match.groups;
    if (kind === 'class') out.push('', convertClass(name, mods, bal.body, warnings));
    else if (kind === 'interface') out.push('', convertInterface(name, mods, bal.body, warnings));
    else out.push('', convertEnum(name, mods, bal.body));
    re.lastIndex = bal.end + 1;
  }
  if (!found) {
    warnings.push('No top-level Java class/interface/enum detected; emitted source as a review comment.');
    out.push('', '/*', source, '*/');
  }
  return { code: out.join('\n').trim() + '\n', warnings };
}
