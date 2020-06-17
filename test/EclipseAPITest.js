var chai = require('chai');
var expect = chai.expect;

var eclipse = require('../src/EclipseAPI.js');


describe('EclipseAPI', function() {
	var EclipseAPI = new eclipse();
	describe('#eclipseAPI', function() {
		describe('success', function() {
			var result;
			before(async function() {
				// get eclipse projects
				result = await EclipseAPI.eclipseAPI();
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
				var temp = await EclipseAPI.eclipseBots();
				for (var tempIdx in temp) {
					var keys = Object.keys(temp[tempIdx]);
					// look for a key with a dot that separates the domain from server name e.g. google.com
					var newKeys = keys.filter(k => k.indexOf('.') != -1);
					if (newKeys.length > 0) {
						siteName = newKeys[0];
						break;
					}
				}
				// if we couldn't find a proper site name, fail out
				if (siteName == undefined) {
					done(false);
				}

				// grab a slice of data that contains the site discovered previously
				var sliceSize = 10;
				var sliceIdx = 0;
				var hasBot = false;
				while (!hasBot && sliceIdx < temp.length) {
					bots = temp.slice(sliceIdx, sliceSize);
					sliceIdx += sliceSize;
					for (var botIdx in bots) {
						if (bots[botIdx][siteName] != undefined){
							hasBot = true;
							break;
						}
					}
				}
				// if we couldn't find any bots, fail out
				if (!hasBot) {
					done(false);
				}
				
				// get bots with filtered list
				result = await EclipseAPI.processBots(bots, siteName);
			});

			it('should contain object data', function() {
				expect(result).to.be.an('object');
			});
			it('should contain keys that match bot projects in the original data', function() {
				// get the project IDs of bots that have an entry for the current site
				var projectNames = [];
				bots.forEach(b => b[siteName] != undefined ? projectNames.push(b.projectId): null);
				
				expect(result).to.have.all.keys(projectNames);
			});
			it('should contain keys that have at least 1 user associated', function() {
				for (var resultIdx in result) {
					expect(result[resultIdx]).to.be.an('array').that.is.not.empty;
				}
			});
			it('should contain keys that only have valid users associated', function() {
				// get the project IDs of bots that have an entry for the current site
				var botNames = [];
				bots.forEach(b => b[siteName] != undefined ? botNames.push(b[siteName].username): null);
				for (var resultIdx in result) {
					var users = result[resultIdx];
					for (var userIdx in users) {
						expect(users[userIdx]).to.be.a('string').that.is.oneOf(botNames);
					}
				}
			});
		});
	});
});