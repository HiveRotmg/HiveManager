import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'baseline-tests.txt';
const raw = readFileSync(file);
// PowerShell 5.1 `>` redirection writes UTF-16LE.
const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8');
const lines = text.split(/\r?\n/);
let pass = 0;
const failures = [];
for (const line of lines) {
  // The console reporter's ✔/✖ survive the Windows console as cp437 mojibake.
  if (/^\s*(\u2714|\u0393\u00a3\u00f6)/.test(line)) pass++;
  else if (/^\s*(\u2716|\u0393\u00a3\u00fb)/.test(line)) failures.push(line.trim());
}
// File-level results are also marked; separate suite rollups (they end with (Nms) and start with 'test\')
const suiteFailures = failures.filter((l) => /test[\\/].*\.test\.ts \(/.test(l));
const caseFailures = failures.filter((l) => !/test[\\/].*\.test\.ts \(/.test(l));
console.log(`pass marks: ${pass}`);
console.log(`fail marks: ${failures.length} (cases ${caseFailures.length}, suite rollups ${suiteFailures.length})`);
console.log('\nfailing cases:');
for (const f of caseFailures) console.log('  ' + f);
console.log('\nfailing suites:');
for (const f of suiteFailures) console.log('  ' + f);
