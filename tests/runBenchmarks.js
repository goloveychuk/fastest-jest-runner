const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const jestPath = execSync('yarn bin jest').toString().trim();

const root = path.join(__dirname, 'benchmarks');

const focus = process.argv[2];

const allDirs = focus
  ? [focus]
  : fs
      .readdirSync(root, { withFileTypes: true })
      .filter((f) => f.isDirectory())
      .map((f) => f.name);

const WORKERS = 12;

const filesCount = 500;
const REPEATS = 3;

function generateTests(dir) {
  const template = fs.readFileSync(path.join(dir, 'template.js'), 'utf-8');
  const genDir = path.join(dir, 'gen');
  if (fs.existsSync(genDir)) {
    fs.rmdirSync(genDir);
  }
  fs.mkdirSync(genDir);
  for (let i = 0; i < filesCount; i++) {
    const content = template;
    fs.writeFileSync(path.join(genDir, `${i}.test.js`), content);
  }
}

const allResults = [];

for (const d of allDirs) {
  console.log('Running tests in', d);
  const abs = path.join(root, d);
  generateTests(abs);

  for (let repeat = 0; repeat < REPEATS; repeat++) {
    for (const runner of ['fastest-jest-runner', undefined]) {
      const runnerArgs = runner ? ['--runner', runner] : [];
      let started = Date.now();
      const res = spawnSync(
        'node',
        [jestPath, '-w', WORKERS, '--no-cache', ...runnerArgs],
        {
          cwd: abs,
          stdio: 'inherit',
        },
      );

      const ended = Date.now();
      allResults.push({
        runner: runner ?? 'default',
        test: d,
        repeat,
        'elapsed (s)': Math.round((ended - started) / 1000),
      });
      if (res.status !== 0) {
        throw new Error(`Test failed in ${d}`);
      }
    }
  }
}

console.table(allResults);
