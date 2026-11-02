// Joue des parties complètes sans interface et affiche le rythme et l'économie obtenus.
// Usage : npm run playtest -- [parties par profil] [niveau visé] [heures max] [profil]
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const { playThrough, PROFILES } = await import(pathToFileURL(resolve('.playtest/playtest.js')).href);
const [seedsArg = '3', targetArg = '30', hoursArg = '20', only] = process.argv.slice(2);
const seeds = Number(seedsArg);

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const hours = (n) => (Number.isFinite(n) ? n.toFixed(1) : '–');

for (const profile of PROFILES.filter((p) => !only || p.id === only)) {
  const runs = Array.from({ length: seeds }, (_, i) => playThrough(profile, 1000 + i * 77, { target: Number(targetArg), maxHours: Number(hoursArg), maxFights: 6000 }));
  const reached = runs.map((r) => r.campaignLevel);
  console.log(`\n=== ${profile.label} : niveau ${median(reached)} en médiane [${Math.min(...reached)}-${Math.max(...reached)}], ${runs.filter((r) => r.stuck).length} partie(s) bloquée(s)`);
  console.log('Niveau | heures | combats | défaites | morts | niv. soldats | or');
  for (const level of [1, 3, 5, 8, 10, 15, 20, 25, 30]) {
    const hits = runs.map((r) => r.milestones.find((m) => m.level === level)).filter(Boolean);
    if (hits.length === 0) continue;
    const col = (key) => median(hits.map((m) => m[key]));
    console.log(`${String(level).padStart(6)} | ${hours(col('hours')).padStart(6)} | ${String(col('fights')).padStart(7)} | ${String(col('losses')).padStart(8)} | ${String(col('deaths')).padStart(5)} | ${hours(col('avgLevel')).padStart(12)} | ${col('gold')}  (${hits.length}/${seeds} parties)`);
  }
  const perLevel = {};
  for (const r of runs) for (const [level, n] of Object.entries(r.fightsPerLevel)) (perLevel[level] ??= []).push(n);
  console.log('Combats par niveau :', Object.entries(perLevel).map(([level, n]) => `${level}:${median(n)}`).join(' '));
  const firsts = {};
  for (const r of runs) for (const [key, h] of Object.entries(r.firsts)) (firsts[key] ??= []).push(h);
  console.log('Premières fois (h) :', Object.entries(firsts).map(([key, h]) => `${key} ${hours(median(h))}`).join(' · '));
  const book = {};
  for (const r of runs) for (const [key, gold] of Object.entries(r.book)) book[key] = (book[key] ?? 0) + gold / seeds;
  console.log('Or (moyenne) :', Object.entries(book).map(([key, gold]) => `${key} ${Math.round(gold)}`).join(' · '));
  const modes = {};
  for (const r of runs) for (const [key, n] of Object.entries(r.modeCount)) modes[key] = (modes[key] ?? 0) + n / seeds;
  console.log('Combats par mode :', Object.entries(modes).map(([key, n]) => `${key} ${Math.round(n)}`).join(' · '));
  console.log(`Butin d'armes : ${Object.keys(runs[0].weaponsFound).map((key) => `${key} ${Math.round(runs.reduce((n, r) => n + r.weaponsFound[key], 0) / seeds)}`).join(' · ')} ; tirages : ${Math.round(runs.reduce((n, r) => n + r.pulls, 0) / seeds)}`);
}
