# fastest-jest-runner

[![npm version](https://badge.fury.io/js/fastest-jest-runner.svg)](https://www.npmjs.com/package/fastest-jest-runner)

Setup:
1) `yarn add fastest-jest-runner`
2) write in `jest.config`: `"runner": "fastest-jest-runner"`

Advanced usage:
[using custom snapshots](tests/e2e/snapshots/package.json)

Public

Tested only with jest 29

Not working:
- custom jest runners, except jasmine2 and circus (can be impl)
- watch mode (can be impl)
- windows
- snapshots (can be impl)
