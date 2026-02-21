#!/usr/bin/env node
'use strict';

// project-index CLI
// Manages ~/projects/index.json — Kite's project registry
//
// Usage:
//   node index.cjs list [--status active|done|archived]
//   node index.cjs show <id>
//   node index.cjs add --id NAME --name "..." --path ~/projects/NAME [--github owner/repo]
//   node index.cjs update <id> [--status STATUS] [--last-action "..."] [--next "step"]
//   node index.cjs note <id> "text"
//   node index.cjs done <id>
//   node index.cjs archive <id>

const fs = require('fs');
const path = require('path');
const os = require('os');

const INDEX_PATH = path.join(os.homedir(), 'projects', 'index.json');

// ─── Helpers ────────────────────────────────────────────────────────────────

function load() {
  if (!fs.existsSync(INDEX_PATH)) return [];
  return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
}

function save(projects) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(projects, null, 2) + '\n', 'utf8');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function resolvePath(p) {
  if (!p) return p;
  return p.replace(/^~/, os.homedir());
}

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = val;
    } else {
      positional.push(argv[i]);
    }
  }
  return { args, positional };
}

// ─── Table renderer ─────────────────────────────────────────────────────────

function padEnd(str, len) {
  const s = String(str ?? '');
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

function statusEmoji(status) {
  return { active: '🟢', done: '✅', archived: '📦', paused: '⏸️' }[status] ?? '❓';
}

function printTable(projects) {
  if (projects.length === 0) {
    console.log('No projects found.');
    return;
  }
  const header = ['ID', 'Name', 'Status', 'Tags', 'Cron', 'Last Action'];
  const rows = projects.map(p => [
    p.id,
    p.name,
    `${statusEmoji(p.status)} ${p.status}`,
    (p.tags || []).join(', '),
    p.cron || '—',
    (p.last_action || '').slice(0, 50),
  ]);
  const cols = header.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length)));
  const sep = cols.map(c => '─'.repeat(c)).join('─┼─');
  const fmt = row => row.map((v, i) => padEnd(v, cols[i])).join(' │ ');
  console.log(fmt(header));
  console.log(sep);
  rows.forEach(r => console.log(fmt(r)));
  console.log(`\n${projects.length} project(s)`);
}

function printDetail(p) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${statusEmoji(p.status)} ${p.name}  [${p.id}]`);
  console.log(`${'═'.repeat(60)}`);
  const field = (label, val) => val != null && val !== '' && !(Array.isArray(val) && val.length === 0)
    ? console.log(`  ${padEnd(label + ':', 14)} ${Array.isArray(val) ? val.join(', ') : val}`)
    : null;
  field('Status', `${p.status}`);
  field('Path', p.path);
  field('GitHub', p.github ? `https://github.com/${p.github}` : null);
  field('Description', p.description);
  field('Last Action', p.last_action);
  field('Next Steps', p.next_steps?.length ? p.next_steps : null);
  field('Tags', p.tags);
  field('Cron', p.cron);
  field('Created', p.created_at);
  field('Updated', p.updated_at);
  console.log('');
}

// ─── Commands ───────────────────────────────────────────────────────────────

function cmdList(argv) {
  const { args } = parseArgs(argv);
  let projects = load();
  if (args.status) projects = projects.filter(p => p.status === args.status);
  printTable(projects);
}

function cmdShow(argv) {
  const [id] = argv;
  if (!id) { console.error('Usage: show <id>'); process.exit(1); }
  const projects = load();
  const p = projects.find(x => x.id === id);
  if (!p) { console.error(`Project not found: ${id}`); process.exit(1); }
  printDetail(p);
}

function cmdAdd(argv) {
  const { args } = parseArgs(argv);
  if (!args.id || !args.name || !args.path) {
    console.error('Required: --id, --name, --path');
    process.exit(1);
  }
  const projects = load();
  if (projects.find(p => p.id === args.id)) {
    console.error(`Project already exists: ${args.id}`);
    process.exit(1);
  }
  const entry = {
    id: args.id,
    name: args.name,
    path: resolvePath(args.path),
    github: args.github || null,
    status: args.status || 'active',
    description: args.desc || args.description || '',
    last_action: args['last-action'] || '',
    next_steps: args.next ? [args.next] : [],
    tags: args.tags ? args.tags.split(',').map(t => t.trim()) : [],
    cron: args.cron || null,
    created_at: today(),
    updated_at: today(),
  };
  projects.push(entry);
  save(projects);
  console.log(`✅ Added: ${entry.name} [${entry.id}]`);
}

function cmdUpdate(argv) {
  const [id, ...rest] = argv;
  if (!id) { console.error('Usage: update <id> [--field value ...]'); process.exit(1); }
  const { args } = parseArgs(rest);
  const projects = load();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) { console.error(`Project not found: ${id}`); process.exit(1); }
  const p = projects[idx];
  if (args.status) p.status = args.status;
  if (args.description || args.desc) p.description = args.description || args.desc;
  if (args['last-action']) p.last_action = args['last-action'];
  if (args.next) p.next_steps = Array.isArray(p.next_steps) ? [...p.next_steps, args.next] : [args.next];
  if (args['clear-next']) p.next_steps = [];
  if (args.cron) p.cron = args.cron;
  if (args.github) p.github = args.github;
  if (args.tags) p.tags = args.tags.split(',').map(t => t.trim());
  p.updated_at = today();
  projects[idx] = p;
  save(projects);
  console.log(`✅ Updated: ${p.name} [${p.id}]`);
}

function cmdNote(argv) {
  const [id, ...noteParts] = argv;
  const note = noteParts.join(' ');
  if (!id || !note) { console.error('Usage: note <id> "text"'); process.exit(1); }
  const projects = load();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) { console.error(`Project not found: ${id}`); process.exit(1); }
  const p = projects[idx];
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  p.last_action = `${note} [${ts}]`;
  p.updated_at = today();
  projects[idx] = p;
  save(projects);
  console.log(`📝 Noted on ${p.name}: ${note}`);
}

function cmdDone(argv) {
  const [id] = argv;
  if (!id) { console.error('Usage: done <id>'); process.exit(1); }
  const projects = load();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) { console.error(`Project not found: ${id}`); process.exit(1); }
  projects[idx].status = 'done';
  projects[idx].updated_at = today();
  save(projects);
  console.log(`✅ Marked done: ${projects[idx].name}`);
}

function cmdArchive(argv) {
  const [id] = argv;
  if (!id) { console.error('Usage: archive <id>'); process.exit(1); }
  const projects = load();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) { console.error(`Project not found: ${id}`); process.exit(1); }
  projects[idx].status = 'archived';
  projects[idx].updated_at = today();
  save(projects);
  console.log(`📦 Archived: ${projects[idx].name}`);
}

function cmdHelp() {
  console.log(`
project-index — Kite's project registry CLI

COMMANDS
  list [--status active|done|archived]         List all (or filtered) projects
  show <id>                                     Show full detail for a project
  add --id ID --name "Name" --path ~/projects/ID
      [--github owner/repo] [--desc "..."]
      [--tags tag1,tag2] [--cron "*/15 * * * *"]
      [--status active] [--last-action "..."]   Add a new project
  update <id> [--status S] [--last-action "..."]
      [--next "step"] [--clear-next]
      [--desc "..."] [--cron "..."]
      [--github owner/repo] [--tags tag1,tag2]  Update project fields
  note <id> "text"                              Append timestamped note to last_action
  done <id>                                     Set status=done
  archive <id>                                  Set status=archived
  help                                          Show this help

INDEX FILE: ~/projects/index.json
`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

const [,, cmd, ...rest] = process.argv;

switch (cmd) {
  case 'list':    cmdList(rest);    break;
  case 'show':    cmdShow(rest);    break;
  case 'add':     cmdAdd(rest);     break;
  case 'update':  cmdUpdate(rest);  break;
  case 'note':    cmdNote(rest);    break;
  case 'done':    cmdDone(rest);    break;
  case 'archive': cmdArchive(rest); break;
  case 'help':
  case '--help':
  case undefined: cmdHelp();        break;
  default:
    console.error(`Unknown command: ${cmd}. Run: node index.cjs help`);
    process.exit(1);
}
