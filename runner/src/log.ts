import { TestResult } from "@jest/test-result";

export const phaseOrder = [
  'runTest',
  'writeToFifo',
  'fork',
//   'handleTestRes',
//   'writeResult',
  'innerRunTest',
  'readTestResult',
] as const;

type Phases = typeof phaseOrder[number];

// const _allTimings: any[] = []
// const PREFIX = '____¬timings¬'
// const SUFFIX = '¬end¬\n'

// export const getAllTimings = () => _allTimings

// export function handleStderr(chunk: string) {
//     const start = chunk.indexOf(PREFIX);
//     if (start === -1) {
//         return chunk
//     }

//     const end = chunk.indexOf(SUFFIX);
//     if (end ===-1) {
//         console.error('should not happen, size is small so should be atomic')
//         return chunk
//     }
//     let left = chunk.slice(0, start) + chunk.slice(end+SUFFIX.length)
//     _allTimings.push(JSON.parse(chunk.slice(PREFIX.length, end)))
//     return left
// }

export type Timing = ReturnType<typeof createTimings>

export const createTimings = () => {
    const allTimings: any[] = []
    const time = (phase: Phases, type: 'start' | 'end') => {
        allTimings.push({phase, type, time: Date.now()})
    }
    const enrich = (res: TestResult) => {
        res.perfStats = {
            ...(res.perfStats ?? {}), 
            //@ts-ignore
            timings: [...(res.perfStats.timings ?? []), ...allTimings]
        }
        return res
    }

    return {time, enrich, raw: () => allTimings}
}
