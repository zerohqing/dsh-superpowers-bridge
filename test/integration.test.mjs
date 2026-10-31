import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import bridge from '../lib/index.js';

// 显式指定宿主依赖目录，测试进程不启动 DSH 服务、不触碰用户 profile。
const modules = process.env.DSH_TEST_MODULES;
test('真实 Cordis：挂载、重载、卸载、再次挂载及失败回滚', { skip: !modules }, async () => {
  const load = name => import(pathToFileURL(join(modules, '@deepseek-ai', name, 'lib/index.js')).href);
  const { Context } = await load('cordis');
  const { default: Skills } = await load('dsh-skill');
  const { default: Prompt } = await load('dsh-system-prompt');
  const ctx = new Context();
  const skills = await ctx.plugin(Skills, {});
  const prompt = await ctx.plugin(Prompt, {});
  let fiber;
  const count = async () => (await ctx.skills.list()).filter(skill => skill.provider === 'superpowers-bridge').length;
  const sections = async () => (await ctx.systemPrompt.assemble()).sections.filter(section => section.name === 'superpowers-bridge:bootstrap');
  try {
    fiber = await ctx.plugin(bridge);
    assert.equal(await count(), 15);
    assert.equal((await sections()).length, 1);
    const loaded = await ctx.skills.get('superpowers-brainstorming');
    assert.match(loaded.content, /DeepSeek Harness platform adaptation/);
    assert.equal(loaded.resourceBase.kind, 'directory');
    await fiber.restart();
    assert.equal(await count(), 15);
    assert.equal((await sections()).length, 1);
    await fiber.dispose();
    assert.equal(await count(), 0);
    assert.equal((await sections()).length, 0);
    fiber = await ctx.plugin(bridge);
    assert.equal(await count(), 15);
    await fiber.dispose();
    // 第二项注册故意重名失败，第一项 provider 必须由失败 fiber 自动清理。
    const blocker = await ctx.plugin({ inject: ['systemPrompt'], apply(scope) {
      scope.systemPrompt.section({ name: 'superpowers-bridge:bootstrap', order: 90, text: 'blocker' });
    } });
    const failed = ctx.plugin(bridge);
    await assert.rejects(failed.await());
    await failed.dispose();
    assert.equal(await count(), 0);
    assert.equal((await sections())[0].text, 'blocker');
    await blocker.dispose();
    assert.equal((await sections()).length, 0);
  } finally {
    await fiber?.dispose();
    await prompt.dispose();
    await skills.dispose();
  }
});
