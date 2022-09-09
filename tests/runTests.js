const {execSync, spawnSync} = require('child_process')
const {readdirSync} = require('fs')
const path = require('path')

const jestPath = execSync("yarn bin jest").toString().trim()



const allDirs = readdirSync(__dirname, {withFileTypes: true}).filter(f => f.isDirectory()).map( f => path.join(__dirname, f.name))


for (const d of allDirs) {
    console.log('Running tests in', d)
    const res = spawnSync("node", [jestPath], {cwd: d, stdio: 'inherit'})
    if (res.status !== 0) {
        throw new Error(`Test failed in ${d}`)
    }
}