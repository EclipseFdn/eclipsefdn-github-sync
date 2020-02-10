const axios = require('axios');
const parse = require('parse-link-header');

module.exports = function() {
	this.eclipseAPI = async function() {
	  var hasMore = true;
	  var result = [];
	  var data = [];
	  // add timestamp to url to avoid browser caching
	  var url = `https://projects.eclipse.org/api/projects`;
	  // loop through all available users, and add them to a list to be returned
	  while (hasMore) {
	    console.log('Loading next page...');
	    // get the current page of results, incrementing page count after call
	    result = await axios.get(url).then(result => {
	      // return the data to the user
	      var links = parse(result.headers.link);
	      if (links.self.url == links.last.url) {
	        hasMore = false;
	      } else {
	        url = links.next.url;
	      }
	      return result.data;
	    }).catch(err => logError(err, 'team:list'));
	    
	    // collect the results
	    if (result != null && result.length > 0) {
	      for (var i = 0; i < result.length; i++) {
	        data.push(result[i]);
	      }
	    }
	  }
	  return data;
	};

	this.postprocessEclipseData = function(data) {
	  for (var key in data) {
	    var project = data[key];
	    // add post processing fields
	    project.pp_repos = [];
	    project.pp_orgs = [];
	    var repos = project.github_repos;
	    for (var idx in repos) {
	      var repo = repos[idx];
	      var repoUrl = repo.url;
	
	      console.log(`Checking repo URL: ${repoUrl}`);
	      // strip the repo url to get the org + repo
	      var match = /.*\/([^\/]+)\/([^\/]+)\/?$/.exec(repoUrl);
	      // check to make sure we got a match
	      if (match == null) {
	        continue;
	      }
	      
	      // get the org + repo from the repo URL
	      var org = match[1];
	      var repoName = match[2];
	      // set the computed data back to the objects
	      repo.org = org;
	      repo.repo = repoName;
	      if (project.pp_orgs.indexOf(org) == -1) {
	    	  project.pp_orgs.push(org);
	      }
	      if (project.pp_repos.indexOf(repoName) == -1) {
	    	  project.pp_repos.push(repoName);
	      }
	    }
	    // set back to ensure properly set
	    data[key] = project;
	  }
	  return data;
	};

	this.eclipseBots = async function() {
		var botsRaw = await axios.get("https://api.eclipse.org/bots").then(result => result.data).catch(err => console.log(err));
		if (botsRaw == undefined) {
			console.log('Could not retrieve bots from API');
			process.exit(1);
		}
		return botsRaw;
	}

	this.processBots = function(botsRaw, site = "github.com"){
		var botMap = {};
		for (var botIdx in botsRaw) {
			var bot = botsRaw[botIdx];
			if (bot[site] == undefined) continue;
			
			var projBots = botMap[bot["projectId"]];
			if (projBots == undefined) {
				projBots = [];
			}
			projBots.push(bot[site]["username"]);
			botMap[bot["projectId"]] = projBots;
		}
		return botMap;
	};
}
