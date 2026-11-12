// Test end-to-end de test-runner.
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
const home = path.join(tmpDir, 'dsh-home');
const project = path.join(tmpDir, 'demo');
mkdirSync(path.join(home, 'test-runner'), { recursive: true });
mkdirSync(project, { recursive: true });
writeFileSync(path.join(home, 'test-runner', 'config.json'), JSON.stringify({ allowedPaths: [tmpDir] }), 'utf8');
writeFileSync(path.join(project, 'package.json'), JSON.stringify({
  name: 'demo',
  version: '1.0.0',
  scripts: {
    test: 'node -e "console.log(\'OK 3 tests passed\')"',
    'test:fail': 'node -e "console.error(\'1 failing test\'); process.exit(1)"',
    build: 'node -e "console.log(\'build\')"',
  },
}), 'utf8');

function makeClient(extraEnv = {}) {
  const entry = process.env.TESTRUN_SERVER ? path.resolve(process.env.TESTRUN_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: home, ...extraEnv }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'testrun-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
const detect = textOf(await client.callTool({ name: 'detect', arguments: { path: project } }));
console.log('--- detect ---'); console.log(detect);
console.log('detecta npm y scripts:', detect.includes('Manager: npm') && detect.includes('test:fail'));
const noConfirm = await client.callTool({ name: 'run', arguments: { path: project } });
console.log('run sin confirm isError:', noConfirm.isError === true);
const ok = await client.callTool({ name: 'run', arguments: { path: project, confirm: true } });
const okText = textOf(ok);
console.log('--- run ok ---'); console.log(okText);
console.log('corre test y pasa:', okText.includes('exit 0') && okText.includes('OK 3 tests passed'));
const fail = await client.callTool({ name: 'run', arguments: { path: project, script: 'test:fail', confirm: true } });
const failText = textOf(fail);
console.log('--- run fail ---'); console.log(failText);
console.log('detecta fallo:', failText.includes('exit 1') && failText.includes('failing'));
const notAllowed = await client.callTool({ name: 'run', arguments: { path: project, script: 'build', confirm: true } });
console.log('script no permitido isError:', notAllowed.isError === true);
const outside = await client.callTool({ name: 'detect', arguments: { path: 'C:\\Windows' } });
console.log('ruta fuera isError:', outside.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
const { client: roClient, transport: roTransport } = await makeClient({ DSH_TESTRUN_MODE: 'read-only' });
const roRun = await roClient.callTool({ name: 'run', arguments: { path: project, confirm: true } });
console.log('read-only run isError:', roRun.isError === true);
await roClient.close(); try { await roTransport.close?.(); } catch {}
console.log('OK');
