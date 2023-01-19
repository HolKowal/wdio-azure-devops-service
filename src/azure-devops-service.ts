import { IAzureConfig, ITestResult } from './interface'
import { AzureTestPlanReporter } from '@gmangiapelo/azuredevops-test-reporter'
import { Capabilities, Frameworks, Options, Services } from '@wdio/types'
import { PickleTag } from '@cucumber/messages'
import { ITestCaseHookParameter } from '@cucumber/cucumber'
import { Test, TestResult } from '@wdio/types/build/Frameworks'
import fs from 'fs-extra'

const tempTestResults = 'tempTestResults.json'

export default class AzureDevopsService implements Services.ServiceInstance {
  private _azureReporter: AzureTestPlanReporter
  public _testResults: { [testCaseId: number]: ITestResult }

  constructor(
    private _options: IAzureConfig,
    private _capabilities: Capabilities.RemoteCapability,
    private _config: Omit<Options.Testrunner, 'capabilities'>
  ) {
    _options = Object.assign(_options, { stdout: true })
    this._azureReporter = new AzureTestPlanReporter(this._options)
    this._testResults = {}
  }

  async onPrepare(): Promise<void> {
    fs.removeSync(tempTestResults)
    fs.outputJsonSync(tempTestResults, this._testResults)
  }

  async before(): Promise<void> {
    this._testResults = fs.readJsonSync(tempTestResults)
  }

  async onComplete(): Promise<void> {
    this._testResults = fs.readJsonSync(tempTestResults)

    const testResultIds: number[] = []
    for (const testResultId of Object.keys(this._testResults)) {
      testResultIds.push(Number(testResultId))
    }

    await this._azureReporter.init()
    await this._azureReporter.starTestRun(testResultIds)
    const runId = await this._azureReporter.getCurrentTestRunId()
    for (const testResult of Object.values(this._testResults)) {
      await this._azureReporter.sendTestResult(testResult, runId)
    }
    await this._azureReporter.stopTestRun()

    fs.removeSync(tempTestResults)
  }

  async afterTest(test: Test, context: any, result: TestResult): Promise<void> {
    let caseId = this.parseCaseIDString(test.parent)

    if (caseId == 'notDefined') {
      caseId = this.parseCaseIDString(test.title)
      if (caseId == 'notDefined') {
        return new Promise((resolve) => {
          resolve()
        })
      }
    }

    for (let i = 0; i < caseId.length; i++) {
      let testResult: ITestResult

      const oldTestResult = this._testResults[Number(caseId[i])]

      const newMessage = `||${test.parent} ${test.title} - ${result.error}`

      testResult = {
        testCaseId: caseId[i],
        result:
          (oldTestResult !== undefined && oldTestResult.result == 'Failed') ||
          !result.passed
            ? 'Failed'
            : 'Passed',
        message: `${
          oldTestResult !== undefined && oldTestResult.result == 'Failed'
            ? oldTestResult.message
            : ''
        }${result.passed ? '' : newMessage}`,
      }

      this._testResults[Number(caseId[i])] = testResult
    }
  }

  async after(): Promise<void> {
    fs.outputJsonSync(tempTestResults, this._testResults)
  }

  async afterScenario(
    world: ITestCaseHookParameter,
    result: Frameworks.PickleResult
  ): Promise<void> {
    const caseId = this.parseCaseID(world.pickle.tags)

    if (caseId == 'notDefined') {
      return new Promise((resolve) => {
        resolve()
      })
    }

    const testResult: ITestResult = {
      testCaseId: caseId,
      result: result.passed ? 'Passed' : 'Failed',
      message: result.error || '',
    }

    await this._azureReporter.init()
    const runId = await this._azureReporter.getCurrentTestRunId()

    await this._azureReporter.sendTestResult(testResult, runId)
  }

  private parseCaseID(pickleTags: readonly PickleTag[]): string {
    const caseID = 'notDefined'
    let patt = /@?[cC](\d+)/g

    if (this._options.caseIdRegex) {
      patt = new RegExp(this._options.caseIdRegex, 'g')
    }
    for (const tag of pickleTags) {
      const matchInfo = patt.exec(tag.name)

      if (matchInfo != null) {
        return matchInfo[1]
      }
    }
    return caseID
  }

  private parseCaseIDString(title: string): string[] | string {
    const caseID = 'notDefined'
    let patt = /@?[cC](\d+)/g

    if (this._options.caseIdRegex) {
      patt = new RegExp(this._options.caseIdRegex, 'g')
    }

    let caseIdArray = []
    let match
    while ((match = patt.exec(title)) !== null) {
      caseIdArray.push(match[1])
    }

    if (caseIdArray.length > 0) {
      return caseIdArray
    }

    return caseID
  }
}
