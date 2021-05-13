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
    glMock = {
      Groups: {
        subgroups: function () {},
        create: function () {},
        remove: function () {},
      },
    };
    runner = new ImportRunner();
    runner.gitlab = glMock;
    runner.github = ghMock;
    runner.githubAccessToken = GITHUB_SECRET;
    runner.gitlabAccessToken = GITLAB_SECRET;
  });

  describe('constructor', function () {
    it('should have a valid no-op constructor', function () {
      expect(new ImportRunner()).to.not.be.null.and.to.not.throw;
    });
  });

  describe('field_access', function () {
    it('should block get for Gitlab secret', function () {
      expect(runner.gitlabAccessToken).to.be.null;
    });
    it('should allow set for Gitlab secret', function () {
      let tempRunner = new ImportRunner();
      expect(() => (tempRunner.gitlabAccessToken = 'new value')).to.not.throw;
    });
    it('should block get for Github secret', function () {
      expect(runner.githubAccessToken).to.be.null;
    });
    it('should allow set for Github secret', function () {
      let tempRunner = new ImportRunner();
      expect(() => (tempRunner.githubAccessToken = 'new value')).to.not.throw;
    });
    it('should allow get for Github wrapper', function () {
      expect(runner.github).to.eq(ghMock);
    });
    it('should allow set for Github secret', function () {
      let tempRunner = new ImportRunner();
      expect(() => (tempRunner.github = {})).to.not.throw;
    });
    it('should allow get for Gitlab wrapper', function () {
      expect(runner.gitlab).to.eq(glMock);
    });
    it('should allow set for Gitlab secret', function () {
      let tempRunner = new ImportRunner();
      expect(() => (tempRunner.gitlab = {})).to.not.throw;
    });
  });

  describe('#checkRunner()', function () {
    checkRunnerTestSuite(async function (runner) {
      return await runner.checkRunner(getTestConfig());
    });
  });

  describe('#runBackup', function () {
    // run backup should be held to same requirements as checkRunner
    describe('_checkRunner()', function () {
      checkRunnerTestSuite(async function (runner) {
        return await runner.runBackup(getTestConfig());
      });
    });
  });

  describe('#getBackupGroups', function () {
    describe('success', function () {
      it('should make call to Gitlab for group using ID', async function () {
        let id = faker.datatype.number;
        // create the mock object to watch the process
        let mock = sinon.mock(glMock.Groups);
        mock.expects('subgroups').once().withArgs(id);

        await runner.getBackupGroups({ id: id });
        // verify it was called once
        mock.verify();
      });
      it('should return data without modification', async function () {
        // no modification ensures that we can always follow GL API spec
        let id = faker.datatype.number;
        let sampleData = [
          {
            id: faker.datatype.number,
            name: 'Sample subgroup 1',
            parent_id: id,
          },
          {
            id: faker.datatype.number,
            name: 'Sample subgroup 2',
            parent_id: id,
          },
        ];
        // create the mock object to watch the process
        let mock = sinon.mock(glMock.Groups);
        mock.expects('subgroups').once().withArgs(id).returns(sampleData);

        // should return the data in exact format
        expect(await runner.getBackupGroups({ id: id })).to.eq(sampleData);
        // verify it was called once
        mock.verify();
      });
    });
    describe('failure', function () {
      it('should catch exceptions and not bubble up', async function () {
        let id = faker.datatype.number;
        // create the mock object to watch the process
        let mock = sinon.mock(glMock.Groups);
        mock.expects('subgroups').once().withArgs(id).throws();

        // should return an empty response on failure
        expect(await runner.getBackupGroups({ id: id })).to.be.undefined.and.not
          .throw;
        // verify it was called once
        mock.verify();
      });
    });
  });

  describe('#createBackupGroup', function () {
    describe('success', function () {
      it('should make a call to create a group', async function () {
        let id = faker.datatype.number;
        let name = faker.datatype.string;
        // create the mock object to watch the process
        let mock = sinon.mock(glMock.Groups);
        // don't expect the args, as they would be brittle in this case
        mock
          .expects('create')
          .once();
        // should return an empty response on failure
        expect(await runner.createBackupGroup({}, name, id)).to.not.throw;
        // verify it was called once
        mock.verify();
      });
      it('should return the exact new group to the caller', async function () {
        let id = faker.datatype.number;
        let name = faker.datatype.string;
        let sampleData = {
          id: faker.datatype.number,
          name: faker.datatype.string,
        };
        // create the mock object to watch the process
        let mock = sinon.mock(glMock.Groups);
        // don't expect the args, as they would be brittle in this case
        mock
          .expects('create')
          .once().returns(sampleData);
        // should return an empty response on failure
        expect(await runner.createBackupGroup({}, name, id)).to.eq(sampleData);
        // verify it was called once
        mock.verify();
      });
    });
    describe('failure', function () {
      it('should catch exceptions and not bubble up', async function () {
        let id = faker.datatype.number;
        let name = faker.datatype.string;
        // create the mock object to watch the process
        let mock = sinon.mock(glMock.Groups);
        // don't expect the args, as they would be brittle in this case
        mock
          .expects('create')
          .once()
          .throws();

        // should return an empty response on failure
        expect(await runner.createBackupGroup({}, name, id)).to.be.undefined.and
          .not.throw;
        // verify it was called once
        mock.verify();
      });
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
