// Progress display for the terrain pipeline: an overall bar, a bar for the running stage, a line per finished stage, and
// assets/terrain-lab/status.json for reading progress without watching the terminal. Plain ANSI, no dependencies.
// Off a terminal (CI, a captured run) it prints a line per 10%.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const TTY = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const [dim, red, green, yellow, cyan, bold] = [2, 31, 32, 33, 36, 1].map((c) => (s) => paint(c, s));
const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const bar = (f, w = 24) => { const n = Math.round(clamp01(f) * w); return '█'.repeat(n) + '░'.repeat(w - n); };
export const fmtTime = (s) => (s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`);

const DIR = 'assets/terrain-lab', TIMINGS = `${DIR}/timings.json`, STATUS = `${DIR}/status.json`;

export class Reporter {
  /** stages: [{name, weight, pending?}]. Weights are replaced by the durations measured last run, so the overall bar is honest. */
  constructor(stages) {
    mkdirSync(DIR, { recursive: true });
    this.stages = stages;
    this.timings = existsSync(TIMINGS) ? JSON.parse(readFileSync(TIMINGS, 'utf8')) : {};
    this.weight = stages.map((s) => (s.pending ? 0 : this.timings[s.name] ?? s.weight));
    this.total = this.weight.reduce((a, b) => a + b, 0) || 1;
    this.t0 = Date.now(); this.done = 0; this.cur = -1; this.frac = 0; this.label = ''; this.notes = []; this.rows = [];
    this.live = false; this.lastDraw = 0; this.lastStatus = 0; this.lastTenth = -1;
  }
  overall() { return clamp01((this.done + (this.cur >= 0 ? this.weight[this.cur] * this.frac : 0)) / this.total); }
  status(extra = {}, force = false) {
    if (!force && Date.now() - this.lastStatus < 300) return;
    this.lastStatus = Date.now();
    writeFileSync(STATUS, JSON.stringify({
      stage: this.stages[this.cur]?.name ?? null, percent: Math.round(this.frac * 100), overall: Math.round(this.overall() * 100),
      task: this.label, elapsed: (Date.now() - this.t0) / 1000, updated: new Date().toISOString(), ...extra,
    }, null, 2));
  }
  clear() { if (TTY && this.live) { process.stdout.write('\r\x1b[2K\n\x1b[2K\x1b[1A\r'); this.live = false; } }
  draw() {
    if (!TTY || this.cur < 0) return;
    const el = (Date.now() - this.t0) / 1000, o = this.overall(), eta = o > 0.02 ? (el / o) * (1 - o) : NaN;
    const s = this.stages[this.cur], se = (Date.now() - this.stageStart) / 1000;
    const l1 = ` ${dim('overall')} ${cyan(bar(o))} ${String(Math.round(o * 100)).padStart(3)}%  ${dim('elapsed')} ${fmtTime(el)}  ${dim('ETA')} ${Number.isNaN(eta) ? '…' : fmtTime(eta)}`;
    const l2 = ` ${yellow('▶')} ${bold(s.name.padEnd(18))} ${cyan(bar(this.frac, 18))} ${String(Math.round(this.frac * 100)).padStart(3)}%  ${dim(this.label)} ${dim(fmtTime(se))}`;
    process.stdout.write(`\r\x1b[2K${l1}\n\x1b[2K${l2}\x1b[1A\r`);
    this.live = true; this.lastDraw = Date.now();
  }
  begin(i) {
    this.cur = i; this.frac = 0; this.label = ''; this.notes = []; this.stageStart = Date.now(); this.lastTenth = -1;
    if (!TTY) console.log(`▶ ${this.stages[i].name}`);
    this.draw(); this.status({}, true);
  }
  /** Called from the long loops: what is being done, and how far along the stage is (0..1). */
  task(label, frac = this.frac) {
    this.label = label; this.frac = clamp01(frac);
    if (!TTY) { const tenth = Math.floor(this.frac * 10); if (tenth > this.lastTenth && tenth < 10) { this.lastTenth = tenth; console.log(`  ${this.stages[this.cur].name} ${tenth * 10}% ${label}`); } }
    else if (Date.now() - this.lastDraw > 90) this.draw();
    this.status();
  }
  note(s) { this.notes.push(s); }
  end(status, text = '') {
    const s = this.stages[this.cur], secs = (Date.now() - this.stageStart) / 1000;
    this.clear();
    const mark = { ok: green('✔'), cached: cyan('↺'), skipped: dim('–'), pending: dim('·'), fail: red('✘') }[status];
    const time = status === 'ok' || status === 'cached' ? fmtTime(secs).padStart(8) : ''.padStart(8);
    console.log(` ${mark} ${s.name.padEnd(18)} ${time}  ${status === 'fail' ? red(text) : dim(text)}`);
    for (const n of this.notes) console.log(`     ${dim(n)}`);
    if (status === 'ok') this.timings[s.name] = secs; // cached runs say nothing about the stage's real cost
    this.rows.push({ name: s.name, status, secs, text });
    this.done += this.weight[this.cur]; this.frac = 0; this.notes = [];
    this.draw(); this.status({ state: status === 'fail' ? 'failed' : 'running', error: status === 'fail' ? text : undefined }, true);
  }
  /** A stage that is listed but not built yet (or turned off). */
  skip(i, status, text) { this.cur = i; this.stageStart = Date.now(); this.notes = []; this.end(status, text); }
  finish(checks, failed) {
    this.clear();
    writeFileSync(TIMINGS, JSON.stringify(this.timings, null, 2));
    console.log(`\n ${bold('checks')}`);
    for (const c of checks) console.log(`  ${c.state === 'ok' ? green('✔') : c.state === 'fail' ? red('✘') : c.state === 'warn' ? yellow('!') : dim('·')} ${c.name.padEnd(34)} ${dim(c.detail ?? '')}`);
    const total = (Date.now() - this.t0) / 1000;
    console.log(`\n ${failed ? red('failed') : green('done')} in ${fmtTime(total)}${failed ? '' : ''}`);
    this.status({ state: failed ? 'failed' : 'done', checks }, true);
  }
}
