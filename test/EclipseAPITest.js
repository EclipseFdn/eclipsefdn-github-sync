var chai = require('chai');
var expect = chai.expect;

var eclipse = require('../src/EclipseAPI.js');


describe('EclipseAPI', function() {
	var EclipseAPI = new eclipse();
	describe('#eclipseAPI', function() {
		describe('success', function() {
			var result;
			before(async function() {
				// get eclipse projects, disable pagination as this is a long process
				result = await EclipseAPI.eclipseAPI('', false);
			});

			it('should contain JSON data', function() {
				expect(result).to.be.an('array');
			});
			it('should contain project_id field', function() {
				if (result.length > 0) {
					expect(result[0]).to.have.property('project_id').that.is.a('string');
				}
			});
      it('should contain github_repos field', function() {
        if (result.length > 0) {
          expect(result[0]).to.have.property('github_repos').that.is.an('array');
        }
      });
      it('should contain gitlab_repos field', function() {
        if (result.length > 0) {
          expect(result[0]).to.have.property('gitlab_repos').that.is.an('array');
        }
      });
		});
	});
	
	describe('#postprocessEclipseData', function() {
		describe('success', function() {
			var result;
			before(function() {
				// post process data using some sample JSON
				result = EclipseAPI.postprocessEclipseData([{
					"project_id": "sample.proj",
					"github_repos": [
						{
							"url": "http://www.github.com/example-org/some-repo"
						},
						{
							"url": "http://www.github.com/second-org/cool-code"
						}
					]
				}], "github_repos");
			});

			it('should contain repos at root level of project', function() {
				expect(result[0]).to.have.property('pp_repos').that.has.members(['cool-code','some-repo']);
			});
			it('should contain orgs at root level of project', function() {
				expect(result[0]).to.have.property('pp_orgs').that.has.members(['example-org','second-org']);
			});
			it('should contain repo name injected for each github repo', function(done) {
				// complex case not suited to chai test
				for (var repoIdx in result.github_repos) {
					var repo = result.github_repos[repoIdx];
					if (repo.url == "http://www.github.com/example-org/some-repo" 
						&& repo.repo == "some-repo") {
						// good
					} else if (repo.url == "http://www.github.com/second-org/cool-code" 
						&& repo.repo == "cool-code") {
						// good
					} else {
						done(false);
					}
				}
				done();
			});
			it('should contain org name injected for each github repo', function(done) {
				// complex case not suited to chai test
				for (var repoIdx in result.github_repos) {
					var repo = result.github_repos[repoIdx];
					if (repo.url == "http://www.github.com/example-org/some-repo" 
						&& repo.prg == "example-org") {
						// good
					} else if (repo.url == "http://www.github.com/second-org/cool-code" 
						&& repo.org == "second-org") {
						// good
					} else {
						done(false);
					}
				}
				done();
			});
		});
	});
	
	describe('#eclipseBots', function() {
		describe('success', function() {
			var result;
			before(async function() {
				// get the eclipse bots for api
				result = await EclipseAPI.eclipseBots();
			});

			it('should contain JSON data', function() {
				expect(result).to.be.an('array');
			});
			it('should contain projectId string value', function() {
				// validate data required in further calls.
				expect(result[0]).to.have.property('projectId').that.is.a('string');
			});
		});
	});
	
	describe('#processBots', function() {
		describe('success', function() {
			var result;
			var bots;
			var siteName;
			before(async function() {
				// get current bots and find a site name to filter on
				bots = [
					{
						"id": 1,
						"projectId": "ecd.che",
						"username": "genie.che",
						"email": "che-bot@eclipse.org",
						"github.com": {
						  "username": "che-bot",
						  "email": "che-bot@eclipse.org"
						},
						"github.com-openshift-ci-robot": {
						  "username": "openshift-ci-robot",
						  "email": "openshift-ci-robot@users.noreply.github.com"
						},
						"github.com-openshift-merge-robot": {
						  "username": "openshift-merge-robot",
						  "email": "openshift-merge-robot@users.noreply.github.com"
						},
						"non-gh-bot-sample": {
						  "username": "non-gh-bot",
						  "email": "non-gh-bot@test.com"
						}
					},
					{
						"id": 11,
						"projectId": "eclipse.jdt",
						"username": "genie.jdt",
						"email": "jdt-bot@eclipse.org",
						"oss.sonatype.org": {
						  "username": "jdt-dev",
						  "email": "jdt-dev@eclipse.org"
						}
					}
				];
				siteName = "github.com";
				// get bots with filtered list
				result = EclipseAPI.processBots(bots, siteName);
			});

			it('should contain object data', function() {
				expect(result).to.be.an('object');
			});
			it('should contain keys that match bot projects in the original data', function() {
				// get the project IDs of bots that have an entry for the current site
				var projectNames = [];
				bots.forEach(b => b[siteName] != undefined ? projectNames.push(b.projectId): null);
				expect(result).to.have.keys(projectNames);
			});
			it('should contain keys that have at least 1 user associated', function() {
				for (var resultIdx in result) {
					expect(result[resultIdx]).to.be.an('array').that.is.not.empty;
				}
				// expect that the JDT project isn't included (no github.com bot)
				expect(result['eclipse.jdt']).to.be.undefined;
			});
			it('should contain keys that only have valid users associated', function() {
				// check that the ECD Che project gets included
				expect(result['ecd.che']).to.include.members(['openshift-ci-robot', 'openshift-merge-robot', 'che-bot']);
			});
		});
	});
});