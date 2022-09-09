const {execSync, spawnSync} = require('child_process')
const {readdirSync} = require('fs')
const path = require('path')

const jestPath = execSync("yarn bin jest").toString().trim()

const root = __dirname;

const focus = process.argv[2]


const allDirs = focus ? [focus] : readdirSync(root, {withFileTypes: true}).filter(f => f.isDirectory()).map(f => f.name)


for (const d of allDirs) {
    console.log('Running tests in', d)
    const abs = path.join(__dirname, d)
    const res = spawnSync("node", [jestPath], {cwd: abs, stdio: 'inherit'})
    // console.log(res.stdout)
    // console.log(res.stderr)
    console.log(res.error)
    if (res.status !== 0) {
        throw new Error(`Test failed in ${d}`)
    }
}