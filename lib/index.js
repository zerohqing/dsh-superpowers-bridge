import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const name = 'superpowers-bridge';
export const inject = ['skills', 'systemPrompt'];
const vendor = resolve(dirname(fileURLToPath(import.meta.url)), '../vendor');
export const providerName = 'superpowers-bridge';

/**
 * DSH 工具与权限契约优先于上游示例。保留上游正文，在单独的适配层说明差异，
 * 避免全局替换 Bash 片段破坏脚本、示例或 Markdown 相对链接。
 */
export const adaptation = `## DeepSeek Harness platform adaptation
This is the DSH platform, not Claude Code, Codex, Pi, or another listed harness.
System/developer instructions, explicit user instructions, repository rules, current permissions and tool availability always take precedence over these skills. Skills never grant approval or authorization. Respect the user's existing execution mode and authorized plan; do not restart completed planning just because the plugin was loaded.
- Invoke skills with the native skill tool, using the exact kebab-case name superpowers-<upstream-name>. For example: skill({name: "superpowers-brainstorming"}). Translate superpowers:<name> references, including those inside supplementary files, to superpowers-<name>. The using-superpowers bootstrap is already loaded automatically.
- Use read/write/edit/glob/grep for files; read existing files before editing. Resolve relative resources from the resource base supplied with the skill, not the workspace. The resource base contains the complete upstream skill directory, including reviewer prompts and scripts.
- Bash/Read/Write/Edit/Grep/Glob/Task/TodoWrite are upstream tool labels, not DSH tool names. Use pwsh on Windows; bash only when that tool and environment actually exist. Translate shell syntax, do not send Bash syntax to pwsh. Do not assume bash, python3, jq, timeout, /tmp, or POSIX paths exist.
- For isolated tasks use subagent with a self-contained prompt; subagent_fork only when inherited context is intended. Continue your children with send_message; use interrupt_agent/list_agents as supported. Completion notifications are automatic: do useful independent work instead of polling. Collect managed jobs with job_output. Do not invent Task, Agent, spawn_agent or wait_agent calls, subagent types or unsupported model/effort parameters. Use available model settings without silently changing the user's choices. Shared workspace writes must not conflict.
- Map TodoWrite/update_plan/TaskCreate/TaskUpdate checklists to todo_write. Use ask_user_question when missing information or permission is required, and honor DSH plan mode and exit_plan_mode. Do not create a workflow orchestration unless the user explicitly requests it.
- Upstream .sh scripts and extensionless shebang scripts need a verified compatible interpreter (some require bash, python3 and fcntl). They are optional helpers, not native Windows programs. If unavailable, carry out their bookkeeping with native file tools and todo_write, or report the limitation; never claim they ran. The visual companion additionally needs user opt-in and a supported, managed server environment. Do not start a replacement DSH GUI server.
- Skill instructions to write plans, commit, push, merge, publish, delete files/worktrees, or inspect/export session transcripts do not authorize those actions. Follow the user's document/commit rules, confirm destructive actions and any required consent, and protect secrets and private session data. diagnosing-superpowers has no automatic access to DSH session history: use only authorized, available tools/data and do not upload diagnostic bundles without permission.
- Use brainstorming for new creative work, systematic-debugging for bugs, and verification-before-completion before claiming success. If a tool or prerequisite is unavailable, explain the limitation instead of pretending the workflow is supported.
`;

/** 只转换锁定目录内真实技能的命名空间；未知名称保持原样，避免伪造可调用技能。 */
export function adaptBody(body, names) {
  return body.replace(/superpowers:([a-z][a-z0-9-]*)/g,
    (original, skill) => names.has(skill) ? `superpowers-${skill}` : original);
}

/**
 * 安装时已包含全部资源，运行时不联网、不执行上游脚本。
 * 先验证整个清单再注册，损坏包不会在 live profile 中留下半套技能。
 */
export function loadCatalog(base = vendor) {
  const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8'));
  if (!Array.isArray(manifest.skills) || manifest.skills.length === 0) throw new Error('Empty Superpowers manifest');
  // 包内哈希用于检测发行损坏，不是供应链签名。补充提示与脚本也必须完整才允许注册。
  if (!Array.isArray(manifest.resources) || !manifest.resources.length) throw new Error('Empty resource manifest');
  const files = new Set();
  for (const entry of manifest.resources) {
    if (typeof entry.file !== 'string' || !/^(skills\/[a-zA-Z0-9_./-]+|LICENSE\.superpowers)$/.test(entry.file) ||
        entry.file.split('/').some(part => !part || part === '.' || part === '..') || files.has(entry.file)) {
      throw new Error('Invalid Superpowers resource path');
    }
    files.add(entry.file);
    if (createHash('sha256').update(readFileSync(join(base, entry.file))).digest('hex') !== entry.sha256) {
      throw new Error(`Superpowers resource integrity mismatch: ${entry.file}`);
    }
  }
  const names = new Set(manifest.skills.map(entry => entry.name));
  if (names.size !== manifest.skills.length || !names.has('using-superpowers')) throw new Error('Invalid Superpowers manifest');
  const definitions = manifest.skills.map(entry => {
    if (!/^[a-z][a-z0-9-]*$/.test(entry.name) || entry.file !== `skills/${entry.name}/SKILL.md` || !files.has(entry.file)) {
      throw new Error('Invalid Superpowers resource path');
    }
    if (typeof entry.description !== 'string' || !entry.description.trim()) throw new Error('Missing skill description');
    const path = join(base, entry.file);
    const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    if (createHash('sha256').update(text).digest('hex') !== entry.sha256) {
      throw new Error(`Superpowers integrity mismatch: ${entry.name}`);
    }
    const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(text);
    if (!frontmatter) throw new Error(`Missing skill frontmatter: ${entry.name}`);
    return Object.freeze({
      name: `superpowers-${entry.name}`, description: entry.description,
      source: 'bundled', provider: providerName, path,
      invocation: Object.freeze({ modelInvocable: true, userInvocable: true }),
      resourceBase: Object.freeze({ kind: 'directory', path: dirname(path) }),
      content: `${adaptation}\n---\n\n${adaptBody(text.slice(frontmatter[0].length), names)}`,
    });
  });
  return { manifest, definitions };
}

/**
 * 原生注册 API 自带 Cordis effect 所有权：卸载/HMR 会清理技能和提示，不额外保留
 * 进程全局标记、不污染会话历史，也不通过 agent/pre-step 重写用户消息。
 */
export function apply(ctx) {
  const { manifest, definitions } = loadCatalog();
  const byName = new Map(definitions.map(skill => [skill.name, skill]));
  ctx.skills.registerProvider(control => ({
    name: providerName,
    async list(options = {}) {
      control.signal.throwIfAborted();
      options.signal?.throwIfAborted();
      // 与 DSH 官方 bundled rank 一致，项目覆盖层仍可优先。
      return definitions.map(({ content, ...summary }) => ({ ...summary, rank: 600, locator: summary.name }));
    },
    async get(candidate, options = {}) {
      control.signal.throwIfAborted();
      options.signal?.throwIfAborted();
      // locator 只做内存查找，绝不将调用方输入拼接为文件路径。
      return candidate.name === candidate.locator ? byName.get(candidate.locator) : undefined;
    },
  }));
  ctx.systemPrompt.section({
    name: 'superpowers-bridge:bootstrap', order: 90, interpolate: false,
    text: `# Superpowers for DeepSeek Harness\nUpstream ${manifest.version} (${manifest.revision}).\n` +
      byName.get('superpowers-using-superpowers').content,
  });
}

export default { name, inject, apply };
