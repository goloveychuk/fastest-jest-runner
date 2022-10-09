class IncompleteReporter {
    onRunComplete(testContexts, results) {
        const res = results.testResults.map( tr => [
             tr.testFilePath,
             tr.perfStats
        ])

        // res.sort((a, b) => b[1].runtime - a[1].runtime);
        console.log(JSON.stringify(Object.fromEntries(res)))
    }
  }
  
module.exports = IncompleteReporter;