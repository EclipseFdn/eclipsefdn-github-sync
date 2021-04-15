// import testing framework
const chai = require('chai');
const sinon = require('sinon');
const faker = require('faker');
const expect = chai.expect;

// import test dependencies
const { ImportRunner } = require('../src/auto_backup/ImportRunner');
const Wrapper = require('../src/GitWrapper');
const { Gitlab } = require('gitlab');
// create reusable API wrapper bases
const GH_BASE_WRAPPER = new Wrapper();
const GL_BASE_WRAPPER = new Gitlab();

// create random stable secrets
const GITLAB_SECRET = faker.datatype.uuid;
const GITHUB_SECRET = faker.datatype.uuid;

describe('ImportRunner', function () {
  // create a mock/shadow of API layers for tests
  let runner;

  // Create mocks for gitlab + github classes
  let ghMock;
  let glMock;
  // run before each test to create new mocks and clear state
  beforeEach(function () {
    ghMock = sinon.mock(GH_BASE_WRAPPER);
    glMock = sinon.mock(GL_BASE_WRAPPER);
    runner = new ImportRunner();
    runner.gitlab = glMock;
    runner.github = ghMock;
    runner.githubAccessToken = GITHUB_SECRET;
    runner.gitlabAccessToken = GITLAB_SECRET;
  });

  describe('constructor', function() {
    it('should have a valid no-op constructor', function(){
      expect(new ImportRunner()).to.not.be.null.and.to.not.throw;
    })
  })

  describe('field_access', function() {
    it('should block get for Gitlab secret', function() {
      expect(runner.gitlabAccessToken).to.be.null;
    });
    it('should allow set for Gitlab secret', function() {
      let tempRunner = new ImportRunner();
      expect(() => tempRunner.gitlabAccessToken = 'new value').to.not.throw;
    });
    it('should block get for Github secret', function() {
      expect(runner.githubAccessToken).to.be.null;
    });
    it('should allow set for Github secret', function() {
      let tempRunner = new ImportRunner();
      expect(() => tempRunner.githubAccessToken = 'new value').to.not.throw;
    });
    it('should allow get for Github wrapper', function() {
      expect(runner.github).to.eq(ghMock);
    });
    it('should allow set for Github secret', function() {
      let tempRunner = new ImportRunner();
      expect(() => tempRunner.github = {}).to.not.throw;
    });
    it('should allow get for Gitlab wrapper', function() {
      expect(runner.gitlab).to.eq(glMock);
    });
    it('should allow set for Gitlab secret', function() {
      let tempRunner = new ImportRunner();
      expect(() => tempRunner.gitlab = {}).to.not.throw;
    });
  });

  describe('#checkRunner()', function () {
    checkRunnerTestSuite(async function(runner) {
      return await runner.checkRunner(getTestConfig());
    });
  });

  describe('#runBackup', function () {
    // run backup should be held to same requirements as checkRunner
    describe('_checkRunner()', function () {
      checkRunnerTestSuite(async function(runner) {
        return await runner.runBackup(getTestConfig());
      });
    });

  });

  describe('#pruneBackupGroups', function() {
    describe('success', function() {
      it('should ')
    });
    describe('failure', function() {

    });
  });
});

/**
 * Test suite for checkRunner function. This is used and should be observed in multiple cases, so it has been extracted for easy calling.
 *
 * @param {Function<Recorc<String,any>>} testFunc operation that is being tested in this instance
 */
function checkRunnerTestSuite(testFunc) {
  let checkedRunner;
  beforeEach(function () {
    checkedRunner = new ImportRunner();
  });

  it('should fail if Gitlab object not set', async function () {
    checkedRunner.github = {};
    checkedRunner.gitlabAccessToken = 'sample';
    checkedRunner.githubAccessToken = 'sample';
    expect(await testFunc(checkedRunner)).to.be.false;
  });
  it('should fail if Github object not set', async function () {
    checkedRunner.gitlab = {};
    checkedRunner.gitlabAccessToken = 'sample';
    checkedRunner.githubAccessToken = 'sample';
    expect(await testFunc(checkedRunner)).to.be.false;
  });
  it('should fail if Gitlab secret not set', async function () {
    checkedRunner.github = {};
    checkedRunner.gitlab = {};
    checkedRunner.githubAccessToken = 'sample';
    expect(await testFunc(checkedRunner)).to.be.false;
  });
  it('should fail if Github secret not set', async function () {
    checkedRunner.github = {};
    checkedRunner.gitlab = {};
    checkedRunner.gitlabAccessToken = 'sample';
    expect(await testFunc(checkedRunner)).to.be.false;
  });
}

// simple function to get bare configs. This can be extended or modified if needed after call
function getTestConfig() {
  return {
    flags: {
      test: true,
    },
  };
}
