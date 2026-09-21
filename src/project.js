import fs from 'node:fs/promises';
import path from 'node:path';
import { convertJava } from './converter/java.js';
import { convertKotlin } from './converter/kotlin.js';
import { rustIdent, snakeCase } from './converter/common.js';

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (['.git','node_modules','build','target','.gradle','.idea'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

function sourceRootRelative(inputRoot, file) {
  let rel = path.relative(inputRoot, file);
  const normalized = rel.split(path.sep).join('/');
  const markers = ['src/main/java/','src/main/kotlin/','src/test/java/','src/test/kotlin/'];
  for (const marker of markers) {
    const i = normalized.indexOf(marker);
    if (i >= 0) return normalized.slice(i + marker.length);
  }
  return normalized;
}

function sanitizeSegments(relNoExt) {
  return relNoExt.split('/').filter(Boolean).map((seg, i, arr) => i === arr.length - 1 ? snakeCase(seg) : rustIdent(seg));
}

async function writeModuleFiles(srcDir, modulePaths) {
  const tree = new Map();
  for (const parts of modulePaths) {
    let prefix = '';
    for (let i = 0; i < parts.length; i++) {
      const dirKey = prefix;
      if (!tree.has(dirKey)) tree.set(dirKey, new Set());
      tree.get(dirKey).add(parts[i]);
      prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
    }
  }
  for (const [dirKey, children] of tree) {
    const file = dirKey ? path.join(srcDir, dirKey, 'mod.rs') : path.join(srcDir, 'lib.rs');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const declarations = [...children].sort().map(c => `pub mod ${c};`).join('\n') + '\n';
    await fs.writeFile(file, declarations);
  }
}

export async function convertProject({ input, outFolder, lang, crateName = 'converted_project', force = false, dryRun = false }) {
  const inputPath = path.resolve(input || '.');
  const outPath = path.resolve(outFolder);
  const stat = await fs.stat(inputPath);
  const ext = lang === 'java' ? '.java' : '.kt';
  const files = stat.isDirectory() ? (await walk(inputPath)).filter(f => f.endsWith(ext)) : [inputPath];
  if (!files.length) throw new Error(`No ${ext} files found under ${inputPath}`);

  if (!dryRun) {
    try {
      const existing = await fs.readdir(outPath);
      if (existing.length && !force) throw new Error(`Output folder is not empty: ${outPath}. Use --force to overwrite generated files.`);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    await fs.mkdir(path.join(outPath, 'src'), { recursive: true });
  }

  const report = { language: lang, input: inputPath, output: outPath, convertedFiles: [], warnings: [] };
  const modulePaths = [];
  const inputRoot = stat.isDirectory() ? inputPath : path.dirname(inputPath);

  for (const file of files.sort()) {
    const source = await fs.readFile(file, 'utf8');
    const rel = sourceRootRelative(inputRoot, file);
    const relNoExt = rel.slice(0, -path.extname(rel).length);
    const parts = sanitizeSegments(relNoExt);
    const moduleName = parts.pop();
    const targetDir = path.join(outPath, 'src', ...parts);
    const target = path.join(targetDir, `${moduleName}.rs`);
    const converter = lang === 'java' ? convertJava : convertKotlin;
    const result = converter(source, path.basename(file));
    modulePaths.push([...parts, moduleName]);
    report.convertedFiles.push({ source: file, target, warnings: result.warnings });
    report.warnings.push(...result.warnings.map(message => ({ file, message })));
    if (!dryRun) {
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(target, result.code);
    }
  }

  if (!dryRun) {
    await writeModuleFiles(path.join(outPath, 'src'), modulePaths);
    const cargo = `[package]\nname = "${crateName.replace(/[^a-zA-Z0-9_-]/g, '_')}"\nversion = "0.1.0"\nedition = "2024"\n\n[dependencies]\n`;
    await fs.writeFile(path.join(outPath, 'Cargo.toml'), cargo);
    await fs.writeFile(path.join(outPath, 'jtr-report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}
