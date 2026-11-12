#!/usr/bin/env node
// dsh-plugin-test-runner — detecta y ejecuta tests de un proyecto local.
// Tools: status, detect, run.

import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'test-runner', 'config.json');
const CACHE_DIR = path.join(DSH_HOME, 'cache', 'test-runner');
const READ_ONLY = String(process.env.DSH_TESTRUN_MODE || '').toLowerCase() === 'read-only';
const MAX_TIMEOUT = 300000;
const log = (m) => process.stderr.write(`[testrun] ${m}\n`);

function loadConfig() {
  try { if (existsSync(CONFIG_FILE)) return { allowedPaths: [], ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) }; } catch { /* defaults */ }
  return { allowedPaths: [] };
}
function allowedRoots() {
  const configured = loadConfig().allowedPaths;
  return (Array.isArray(configured) && configured.length ? configured : [process.env.USERPROFILE || process.env.HOME || os.homedir()]).map((item) => path.resolve(item));
}
function isAllowed(target) { const resolved = path.resolve(target); return allowedRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep)); }
function detectProject(rootInner) {
  const root = path.resolve(rootInner);
  if (!existsSync(root)) throw new Error(`la ruta no existe: ${root}`);
  if (!isAllowed(root)) throw new Error(`ruta no permitida: ${root} (revisa allowedPaths)`);
  const packageJsonFile = path.join(root, 'package.json');
  let scripts = {};
  let packageName = null;
  if (existsSync(packageJsonFile)) { try { const pkg = JSON.parse(readFileSync(packageJsonFile, 'utf8').replace(/^\uFEFF/, '')); scripts = pkg.scripts || {}; packageName = pkg.name || null; } catch { /* ignora */ } }
  const manager = existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(path.join(root, 'yarn.lock')) ? 'yarn' : existsSync(path.join(root, 'package-lock.json')) ? 'npm' : 'npm';
  const pythonFiles = ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'requirements.txt'].filter((name) => existsSync(path.join(root, name)));
  const testScripts = Object.keys(scripts).filter((name) => /^test(:|$)/i.test(name));
  return { root, packageName, manager, scripts, testScripts, python: pythonFiles, isNode: existsSync(packageJsonFile) };
}
function runNodeTests(project, script, timeoutMs) {
  if (!project.testScripts.includes(script)) throw new Error(`script no permitido: ${script}. Disponibles: ${project.testScripts.join(', ') || '(ninguno)'}`);
  const manager = project.manager === 'yarn' ? 'yarn' : project.manager;
  const command = process.platform === 'win32' ? `${manager}.cmd` : manager;
  const args = manager === 'yarn' ? [script] : ['run', script, '--silent'];
  const started = Date.now();
  const result = spawnSync(command, args, { cwd: project.root, encoding: 'utf8', timeout: timeoutMs, shell: true, windowsHide: true, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return { exitCode: result.status, durationMs: Date.now() - started, output, timedOut: result.error?.code === 'ETIMEDOUT' };
}
function summarize(output) {
  const pass = (output.match(/\b(pass(ed|ing)?|ok|\u2713|tests? passed)\b/gi) || []).length;
  const fail = (output.match(/\b(fail(ed|ing)?|\u2717|failing|error)\b/gi) || []).length;
  return { pass, fail, tail: output.split('\n').filter((line) => line.trim()).slice(-25) };
}
function textResult(text) { return { content: [{ type: 'text', text }] }; }

function buildInstructions() {
  return [
    'Test Runner: detecta y ejecuta los tests de un proyecto local.',
    '',
    'Herramientas: status, detect, run.',
    '',
    'Reglas:',
    '- run requiere confirm:true, ejecuta solo scripts test de package.json y respeta allowedPaths.',
    '- No inventes resultados: reporta exit code, duración y salida real (cola).',
    '- En DSH_TESTRUN_MODE=read-only solo funciona detect.',
    '- No ejecutes comandos arbitrarios: solo scripts "test" o "test:*" del proyecto.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-test-runner', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });

  server.registerTool(
    'status',
    { title: 'Estado', description: 'Rutas permitidas, timeout y modo.', inputSchema: z.object({}) },
    async () => textResult([`Rutas permitidas: ${allowedRoots().join(', ')}`, `Timeout máximo: ${MAX_TIMEOUT / 1000}s`, `Modo: ${READ_ONLY ? 'read-only' : 'normal'}`].join('\n')),
  );

  server.registerTool(
    'detect',
    { title: 'Detectar tests', description: 'Detecta package manager, scripts y entorno de tests.', inputSchema: z.object({ path: z.string().min(2) }) },
    async (args) => {
      const project = detectProject(args.path);
      return textResult([
        `Proyecto: ${project.packageName || path.basename(project.root)}`,
        `Ruta: ${project.root}`,
        `Manager: ${project.manager}`,
        `Scripts test: ${project.testScripts.join(', ') || '(ninguno)'}`,
        `Python: ${project.python.length ? project.python.join(', ') : '(no detectado)'}`,
        `Node: ${project.isNode ? 'sí' : 'no'}`,
      ].join('\n'));
    },
  );

  server.registerTool(
    'run',
    { title: 'Ejecutar tests', description: 'Ejecuta un script test y resume el resultado. Requiere confirm:true.', inputSchema: z.object({ path: z.string().min(2), script: z.string().optional(), timeoutMs: z.number().int().min(5000).max(MAX_TIMEOUT).optional(), confirm: z.boolean().optional() }) },
    async (args) => {
      if (READ_ONLY) throw new Error('modo read-only: run deshabilitado');
      if (args.confirm !== true) throw new Error('run requiere confirm:true y pedido explícito');
      const project = detectProject(args.path);
      if (!project.isNode) throw new Error('proyecto sin package.json: no hay scripts test para ejecutar');
      const script = args.script || project.testScripts.find((name) => name === 'test') || project.testScripts[0];
      if (!script) throw new Error('no hay scripts test en package.json');
      const result = runNodeTests(project, script, args.timeoutMs ?? 120000);
      const summary = summarize(result.output);
      return textResult([
        `${result.exitCode === 0 ? '✅' : '❌'} ${script} · exit ${result.exitCode}${result.timedOut ? ' (timeout)' : ''} · ${result.durationMs} ms`,
        `Señales: pass=${summary.pass} fail=${summary.fail}`,
        '',
        'Salida (cola):',
        ...summary.tail,
      ].join('\n'));
    },
  );

  return server;
}

try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignora */ }
log(`modo: ${READ_ONLY ? 'read-only' : 'normal'}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
