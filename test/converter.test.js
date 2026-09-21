import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { convertJava } from '../src/converter/java.js';
import { convertKotlin } from '../src/converter/kotlin.js';
import { convertProject } from '../src/project.js';

test('converts a Java class into a Rust struct and impl', () => {
  const source = `public class MathBox { private int value; public MathBox(int value) { this.value = value; } public int getValue() { return this.value; } }`;
  const { code } = convertJava(source, 'MathBox.java');
  assert.match(code, /pub struct MathBox/);
  assert.match(code, /value: i32/);
  assert.match(code, /pub fn new\(value: i32\)/);
  assert.match(code, /pub fn get_value\(&self\) -> i32/);
  assert.match(code, /return self\.value;/);
});

test('converts a Kotlin data class into a Rust struct', () => {
  const source = `data class Person(val name: String, var age: Int) { fun birthday(): Int { age = age + 1\nreturn age } }`;
  const { code } = convertKotlin(source, 'Person.kt');
  assert.match(code, /pub struct Person/);
  assert.match(code, /pub name: String/);
  assert.match(code, /pub age: i32/);
  assert.match(code, /pub fn birthday\(&mut self\) -> i32/);
});

test('converts a directory into a Rust crate and report', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jtr-test-'));
  const input = path.join(process.cwd(), 'test', 'fixtures', 'java');
  const out = path.join(tmp, 'out');
  const report = await convertProject({ input, outFolder: out, lang: 'java' });
  assert.equal(report.convertedFiles.length, 1);
  await fs.access(path.join(out, 'Cargo.toml'));
  await fs.access(path.join(out, 'src', 'com', 'example', 'greeter.rs'));
  await fs.access(path.join(out, 'jtr-report.json'));
});
