import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, loadCatalog, adaptBody, adaptation } from '../lib/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('锁定上游版本，完整发现十五个不冲突的技能', () => {
  const { manifest, definitions } = loadCatalog();
  assert.equal(manifest.version, '7.0.2');
  assert.equal(manifest.revision, 'c62ffea8267a70de07583e153544d355b6748a56');
  assert.equal(definitions.length, 15);
  for (const skill of definitions) {
    assert.match(skill.name, /^superpowers-[a-z][a-z0-9-]*$/);
    assert.equal(skill.provider, 'superpowers-bridge');
    assert.equal(skill.invocation.userInvocable, true);
    assert.equal(skill.invocation.modelInvocable, true);
    assert.equal(skill.resourceBase.path, dirname(skill.path));
    assert.ok(existsSync(skill.path));
    assert.ok(skill.content.startsWith(adaptation));
    assert.doesNotMatch(skill.content, /^---\nname:/);
  }
  assert.ok(existsSync(join(root, 'vendor/skills/requesting-code-review/code-reviewer.md')));
  assert.ok(existsSync(join(root, 'vendor/skills/subagent-driven-development/scripts/sdd-workspace')));
  assert.match(readFileSync(join(root, 'vendor/LICENSE.superpowers'), 'utf8'), /Jesse Vincent/);
});

test('已知技能名转换，不修改未知技能或普通相对资源路径', () => {
  assert.equal(adaptBody('superpowers:brainstorming ./code-reviewer.md superpowers:other', new Set(['brainstorming'])),
    'superpowers-brainstorming ./code-reviewer.md superpowers:other');
});

test('原生 provider 延迟加载、取消与 locator 验证', async () => {
  const life = new AbortController();
  let provider;
  const sections = [];
  apply({
    skills: { registerProvider(factory) { provider = factory({ signal: life.signal }); } },
    systemPrompt: { section(section) { sections.push(section); } },
  });
  const candidates = await provider.list();
  assert.equal(candidates.length, 15);
  assert.equal(candidates[0].rank, 600);
  assert.equal(candidates[0].content, undefined);
  const brainstorming = candidates.find(entry => entry.name === 'superpowers-brainstorming');
  assert.match((await provider.get(brainstorming)).content, /Brainstorming/);
  assert.equal(await provider.get({ ...brainstorming, locator: '../../escape' }), undefined);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].interpolate, false);
  assert.match(sections[0].text, /superpowers-brainstorming/);
  assert.match(sections[0].text, /bootstrap is already loaded automatically/);
  assert.match(sections[0].text, /System\/developer instructions/);
  assert.match(sections[0].text, /Skills never grant approval or authorization/);
  assert.match(sections[0].text, /pwsh/);
  const caller = AbortSignal.abort(new Error('cancel caller'));
  await assert.rejects(provider.list({ signal: caller }), /cancel caller/);
  await assert.rejects(provider.get(brainstorming, { signal: caller }), /cancel caller/);
  life.abort(new Error('unloaded'));
  await assert.rejects(provider.list(), /unloaded/);
  await assert.rejects(provider.get(brainstorming), /unloaded/);
});

test('损坏文件、重复技能与目录穿越清单明确失败', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-superpowers-test-'));
  try {
    const base = join(temporary, 'vendor');
    cpSync(join(root, 'vendor'), base, { recursive: true });
    const manifestPath = join(base, 'manifest.json');
    const original = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(original);
    manifest.skills[0].file = '../outside';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => loadCatalog(base), /Invalid Superpowers resource path/);
    manifest.skills[0].file = `skills/${manifest.skills[0].name}/SKILL.md`;
    manifest.skills.push(manifest.skills[0]);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => loadCatalog(base), /Invalid Superpowers manifest/);
    writeFileSync(manifestPath, original);
    writeFileSync(join(base, 'skills/brainstorming/SKILL.md'), 'tampered');
    assert.throws(() => loadCatalog(base), /integrity mismatch: skills\/brainstorming\/SKILL.md/);
    cpSync(join(root, 'vendor'), base, { recursive: true });
    writeFileSync(join(base, 'skills/requesting-code-review/code-reviewer.md'), 'tampered helper');
    assert.throws(() => loadCatalog(base), /resource integrity mismatch/);
    cpSync(join(root, 'vendor'), base, { recursive: true });
    rmSync(join(base, 'skills/brainstorming/scripts/server.cjs'));
    assert.throws(() => loadCatalog(base), /ENOENT/);
  } finally {
    // temporary 由 mkdtempSync 返回，删除范围不接收用户输入。
    rmSync(temporary, { recursive: true, force: true });
  }
});
