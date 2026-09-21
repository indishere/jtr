#!/usr/bin/env node
import process from 'node:process';
import { convertProject } from './project.js';

const HELP = `jtr - Java/Kotlin to Rust project converter\n\nUsage:\n  jtr convert --java --out-folder <folder> [input]\n  jtr convert --kotlin --out-folder <folder> [input]\n  jtr convert --lang <java|kotlin> --out-folder <folder> [input]\n\nOptions:\n  --java                 Convert Java (.java) source files\n  --kotlin               Convert Kotlin (.kt) source files\n  --lang <lang>          Same as --java / --kotlin\n  --out-folder <folder>  Output Rust crate directory (required)\n  --crate-name <name>    Cargo crate name (default: converted_project)\n  --force                Allow writing into a non-empty output directory\n  --dry-run              Scan and convert in memory without writing files\n  -h, --help             Show this help\n\nInput defaults to the current directory.`;

function fail(message, code = 1) {
  console.error(`jtr: ${message}`);
  process.exitCode = code;
}

function parse(argv) {
  if (!argv.length || argv.includes('-h') || argv.includes('--help')) return { help: true };
  const [command, ...rest] = argv;
  if (command !== 'convert') throw new Error(`unknown command '${command}'`);
  const opts = { input: '.', force: false, dryRun: false };
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--java') opts.lang = 'java';
    else if (a === '--kotlin') opts.lang = 'kotlin';
    else if (a === '--lang') opts.lang = rest[++i];
    else if (a === '--out-folder') opts.outFolder = rest[++i];
    else if (a === '--crate-name') opts.crateName = rest[++i];
    else if (a === '--force') opts.force = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a.startsWith('-')) throw new Error(`unknown option '${a}'`);
    else positional.push(a);
  }
  if (positional.length > 1) throw new Error('only one input path may be provided');
  if (positional[0]) opts.input = positional[0];
  if (!['java','kotlin'].includes(opts.lang)) throw new Error('choose exactly one source language with --java, --kotlin, or --lang');
  if (!opts.outFolder) throw new Error('--out-folder is required');
  return opts;
}

try {
  const opts = parse(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
  } else {
    const report = await convertProject(opts);
    console.log(`${opts.dryRun ? 'Would convert' : 'Converted'} ${report.convertedFiles.length} ${report.language} file(s) to ${report.output}`);
    if (report.warnings.length) console.log(`Warnings: ${report.warnings.length} (see jtr-report.json)`);
  }
} catch (error) {
  fail(error.message);
}
