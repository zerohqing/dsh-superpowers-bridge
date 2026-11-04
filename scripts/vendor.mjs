import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 固定提交而非跟随 main；升级必须显式修改提交并重新运行测试，避免运行时下载改变行为。
// 当前对应上游 v7.0.2（固定提交，避免运行时下载改变行为）。
const revision = 'c62ffea8267a70de07583e153544d355b6748a56';

// 用法：node scripts/vendor.mjs [来源目录] [--tag vX.Y.Z]
// 来源目录是 git 仓库时，按固定提交读取 blob（首选路径）。
// 来源目录是发布包解压目录时，必须用 --tag 指明版本，脚本会校验 package.json 版本与之相符。
// 之所以保留第二条路径：部分机器只能访问 codeload/api，无法 git clone github.com。
const argv = process.argv.slice(2);
const tagIndex = argv.indexOf('--tag');
const tag = tagIndex === -1 ? undefined : argv[tagIndex + 1];
if (tagIndex !== -1 && !/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error(`Invalid --tag: ${tag}`);
const positional = argv.filter((_, index) => index !== tagIndex && index !== tagIndex + 1);
const source = resolve(positional[0] ?? '../superpowers-upstream-tmp');
const target = join(root, 'vendor');
// 不覆盖已有资源，防止上游删除文件后旧文件仍留在打包结果中；重建由操作者先核对目录。
if (existsSync(target)) throw new Error('vendor already exists; inspect and remove it before regenerating');

const git = (...args) => execFileSync('git', ['-C', source, ...args],
  { maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
// 判断来源是否为 git 仓库；不是仓库时退回发布包解压目录模式。
const isGit = (() => {
  try {
    git('rev-parse', '--git-dir');
    return true;
  } catch {
    return false;
  }
})();

/** 从固定提交直接读取 blob，不复制工作树：ignored 缓存、未提交修改、符号链接都不会混入发行包。 */
function gitEntries() {
  const rows = git('ls-tree', '-r', '-z', revision, '--', 'skills/', 'LICENSE').toString('utf8').split('\0').filter(Boolean);
  return rows.map(row => {
    const match = /^(100644|100755) blob [a-f0-9]+\t(.+)$/.exec(row);
    if (!match) throw new Error(`Unsupported upstream tree entry: ${row}`);
    return { path: match[2], bytes: git('show', `${revision}:${match[2]}`) };
  });
}

/**
 * 发布包解压目录没有 git 对象，只能逐文件读取。这里同样只接受普通文件，
 * 遇到符号链接或特殊文件直接失败，避免发行包里混入指向树外的内容。
 */
function treeEntries() {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const absolute = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in release tree: ${relative(source, absolute)}`);
    if (entry.isDirectory()) return walk(absolute);
    if (entry.isFile()) return [absolute];
    throw new Error(`Unsupported file type in release tree: ${relative(source, absolute)}`);
  });
  return [join(source, 'LICENSE'), ...walk(join(source, 'skills'))].map(absolute => ({
    // 统一成上游仓库里的 POSIX 相对路径，清单与资源校验都依赖这个形式。
    path: relative(source, absolute).split(sep).join('/'),
    bytes: readFileSync(absolute),
  }));
}

if (!isGit && !tag) {
  throw new Error('Non-git source requires --tag vX.Y.Z so the vendored tree stays traceable to a release');
}
const entries = isGit ? gitEntries() : treeEntries();
const packageJson = isGit
  ? JSON.parse(git('show', `${revision}:package.json`).toString('utf8'))
  : JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
// 解压目录模式下 tag 与 package.json 版本必须一致，否则说明解开的不是该发布版本。
if (tag && packageJson.version !== tag.slice(1)) {
  throw new Error(`Tag ${tag} does not match package.json version ${packageJson.version}`);
}

const resources = [];
const skills = [];
const payloads = [];
for (const { path, bytes } of entries) {
  if (path.split('/').some(part => !part || part === '.' || part === '..') || path.includes('\\')) {
    throw new Error(`Invalid upstream path: ${path}`);
  }
  const file = path === 'LICENSE' ? 'LICENSE.superpowers' : path;
  resources.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
  payloads.push({ file, bytes });
  if (!/^skills\/[^/]+\/SKILL\.md$/.test(path)) continue;
  const text = bytes.toString('utf8').replace(/\r\n/g, '\n');
  // 当前锁定版本只使用两个单行字段。格式改变时明确失败，不静默误读 YAML。
  const front = /^---\nname: ([a-z][a-z0-9-]*)\ndescription: ([^\n]+)\n---\n/.exec(text);
  if (!front || path !== `skills/${front[1]}/SKILL.md`) throw new Error(`Unsupported frontmatter: ${path}`);
  const description = front[2].startsWith('"') ? JSON.parse(front[2]) : front[2];
  skills.push({ name: front[1], description, file, sha256: createHash('sha256').update(text).digest('hex') });
}
skills.sort((a, b) => a.name.localeCompare(b.name));
// 所有输入通过检查后才创建目录，失败时不会留下已经可注册的半套清单。
for (const { file, bytes } of payloads) {
  mkdirSync(dirname(join(target, file)), { recursive: true });
  writeFileSync(join(target, file), bytes);
}
writeFileSync(join(target, 'manifest.json'), JSON.stringify({
  repository: 'https://github.com/obra/superpowers', revision,
  version: packageJson.version, resources, skills,
}, null, 2) + '\n');
console.log(`Vendored ${skills.length} skills and ${resources.length} resources at ${revision} (${packageJson.version})`);
