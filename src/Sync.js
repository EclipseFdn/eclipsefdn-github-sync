/*******************************************************************************
 * Copyright (C) 2019 Eclipse Foundation, Inc.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/
 * 
 * Contributors: Martin Lowe <martin.lowe@eclipse-foundation.org>
 * 
 * SPDX-License-Identifier: EPL-2.0
 ******************************************************************************/

// custom wrappers
const Wrapper = require('./GitWrapper.js');
const CachedHttp = require('./HttpWrapper.js');

// set up yargs command line parsing
var argv = require('yargs')
  .usage('Usage: $0 [options]')
  .example('$0', '')
  .option('d', {
    alias: 'dryrun',
    description: 'Runs script as dry run, not writing any changes to API',
    boolean: true
  })
  .option('V', {
    alias: 'verbose',
    description: 'Sets the script to run in verbose mode',
    boolean: true
  })
  .option('D', {
    alias: 'deletionDryRun',
    description: 'Runs the script in a semi-dryrun state to prevent deletions of users',
    boolean: true
  })
  .help('h')
  .alias('h', 'help')
  .version('0.1')
  .alias('v', 'version')
  .epilog('Copyright 2019 Eclipse Foundation inc.')
  .argv;

const axios = require('axios');
const fs = require('fs');
const parse = require('parse-link-header');
const defaultOrgPermissions = {
	"default_repository_permission": "read",
	"members_can_create_repositories": false,
	"members_can_create_private_repositories": false,
	"members_can_create_public_repositories": false,
	"members_allowed_repository_creation_type": "none"
};

// create global placeholder for wrapper
var wrap;
var cHttp;
var bots;

// thread sleeping to prevent abuse of API
var sab = new SharedArrayBuffer(1024);
var int32 = new Int32Array(sab);
const waitTimeInMS = 500;

_prepareSecret();

/**
 * Retrieves secret API token from system, and then starts the script via _init
 * 
 * @returns
 */
function _prepareSecret() {
  // retrieve the secret API token
  fs.readFile('/run/secrets/api-token', {encoding: 'utf-8'}, function(err,data){
     if (!err && data != undefined) {
         _init(data.trim());
     } else {
         console.log("Error while reading access token: " + err);
         return;
     }
  });
}

/**
 * Async as we require blocking to ensure that data is available when processing
 * starts.
 */
async function _init(secret) {
  if (secret == undefined || secret == "") {
    console.log("Could not fetch API secret, exiting");
    return;
  }
  
  wrap = new Wrapper(secret);
  if (!await wrap.checkAccess()) {
    return;
  }
  wrap.setDryRun(argv.d);
  console.log(`Running in dryrun? ${argv.d}`);

  cHttp = new CachedHttp();
  
  var hasMore = true;
  var result = [];
  var data = [];
  console.log('Loading Eclipse API data!');
  var url = 'https://projects.eclipse.org/api/projects?github_only=1&';
  // loop through all available users, and add them to a list to be returned
  while (hasMore) {
    console.log('Loading next page...');
    // get the current page of results, incrementing page count after call
    result = await axios.get(url).then(r => {
      // return the data to the user
      var links = parse(r.headers.link);
      if (links.self.url == links.last.url) {
        hasMore = false;
      } else {
        url = links.next.url;
      }
      return r.data;
    }).catch(err => console.log(`Error while retrieving results from Eclipse Projects API (${url}): ${err}`));
    
    // collect the results
    if (result != null && result.length > 0) {
      for (var i = 0; i < result.length; i++) {
        data.push(result[i]);
      }
    }
  }
  data = postprocessData(data);
  
  console.log(`Finished preloading ${data.length} projects`);
  // get bots for raw project processing
  var rawBots = await eclipseBots();
  bots = processBots(rawBots);
  console.log(`Found ${Object.keys(bots).length} registered bots`);
  
  // start the sync operation.
  await runSync(data);
  
  // close the wrappers, persisting required cache info
  cHttp.close();
}

function postprocessData(data) {
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
      var match = /\/([^\/]+)\/([^\/]+)\/?$/.exec(repoUrl);
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
}

async function runSync(data) {
  var start = new Date();
  // used to track which orgs have been processed for removing outside collabs
  var uniqueOrgs = [];
  for (var key in data) {
    var project = data[key];
    var projectID = project.project_id;
    var repos = project.github_repos;
    console.log(`Project ID: ${projectID}`);
    
    // maintain orgs used by this project
    var orgs = [];
    for (var idx in repos) {
      var repo = repos[idx];
      var org = repo.org;
      var repoName = repo.repo;
      console.log(`Starting sync for org=${org};repo=${repoName}`);
      
      // check if we've processed this org yet, if not, then create teams and
      // add users
      if (!orgs.includes(org)) {
        console.log(`Generating teams for ${org}/${repoName}`);
        
        await processOrg(org, project);
        
        orgs.push(org);
      }
      // check if org has been processed earlier
      if (!uniqueOrgs.includes(org)) {
        console.log(`Removing outside collaborators for ${org}`);
        await removeOrgExternalContributors(data, org);
      
        uniqueOrgs.push(org);
      }
      // process contributors for the team
      await removeRepoExternalContributors(project, org, repoName);
      if (!argv.d) {
        // create the repo if it doesn't exist
        try {
          await wrap.addRepo(org, repoName);
          
          // Ensure that the teams refer to the repo
          await wrap.addRepoToTeam(org, `${projectID}-committers`, repoName, "push");
          await wrap.addRepoToTeam(org, `${projectID}-contributors`, repoName);
          await wrap.addRepoToTeam(org, `${projectID}-project-leads`, repoName, "pull", false);
        } catch (e) {
          console.log(`Error while updating ${projectID}. \n${e}`);
        }
      } else {
        console.log(`Dry run set, not adding repo '${repoName}' for org: ${org}`);
      }
    }
  }
  // log how long it took to do this stuff
  var end = new Date();
  console.log(`Start: ${start}, end: ${end}, calls: ${wrap.getCallCount()}`);
}

async function processOrg(org, project) {
  // prefetch teams to reduce redundant calls
  await wrap.prefetchTeams(org);
  await wrap.prefetchRepos(org);
  
  // create the teams for the current org + update perms
  if (!argv.d) {
	await wrap.updateOrgPermissions(org, defaultOrgPermissions);
    await updateTeam(org, project, 'contributors');
    await updateTeam(org, project, 'committers');
    await updateTeam(org, project, 'project_leads');
  } else {
    console.log('Dry run set, not adding teams for org: ' + org);
  }
}

async function updateTeam(org, project, grouping) {
  var projectID = project.project_id;
  var teamName = wrap.sanitizeTeamName(`${projectID}-${grouping}`);
  console.log(`Syncing team '${teamName}' for organization ${org}`);
  var team = await wrap.addTeam(org, teamName);
  // set team to private
  var result = await wrap.editTeam(team.id, teamName, {"privacy": "secret"});
  var members = await wrap.getTeamMembers(org, teamName, team.id);
  
  console.log(`${grouping} members: ${JSON.stringify(members)}`);
  for (var idx in project[grouping]) {
    // get the user via cached HTTP
    var userRequest = await cHttp.getRaw(project[grouping][idx].url);
    if (userRequest.response != undefined && userRequest.response.data == 'User not found.') {
      console.log(`User '${project[grouping][idx].name}' had no associated data on Eclipse API`);
      continue;
    } else if (userRequest.status != 200) {
      console.log(`Error while fetching data for ${project[grouping][idx].url}, ending all processing`);
      process.exit(1);
    }
    var user = userRequest.data;
    // check if github handle is null or empty
    if (!user.github_handle || user.github_handle.trim() === "") {
      console.log(`User '${project[grouping][idx].name}' has no associated GitHub username, skipping`);
      continue;
    }

    // invite user to team
    await wrap.inviteUserToTeam(org, teamName, user.github_handle);
    if (members != undefined) {
      members = members.filter(e => e.login !== user.github_handle);
    }
    // wait to make sure that we don't abuse GitHub API
    Atomics.wait(int32, 0, 0, waitTimeInMS);
  }

  console.log(`Leftover members: ${JSON.stringify(members)}`);
  // Commented out until Eclipse API endpoint exists to get user for github
	// handle
  if (members != undefined) {
  
    for (var i = 0; i < members.length; i++) {
      var url = `https://api.eclipse.org/github/profile/${members[i].login}`;
      var r = await axios.get(url).then(result => {
        return result.data;
      }).catch(err => console.log(`Received error from Eclipse API querying for '${url}': ${err}`));
      // check that we know the user before removing
      if (r != undefined && r["github_handle"] === members[i].login) {
        if (argv.D !== true) {
          console.log(`Removing '${members[i].login}' from team '${teamName}'`);
          await wrap.removeUserFromTeam(org, teamName, members[i].login);
        } else {
          console.log(`Would have deleted '${members[i].login}', but in semi-dry run mode`);
        }
      } else {
          console.log(`Could not identify '${members[i].login}' from team '${teamName}', skipping`);
      }
    }
  }
}

async function removeRepoExternalContributors(project, org, repo) {
  // get the collaborators
  var collaborators = await wrap.getRepoCollaborators(org, repo);
  Atomics.wait(int32, 0, 0, waitTimeInMS);
  if (collaborators == undefined) {
	  console.log(`Error while fetching collaborators for ${org}/${repo}`);
	  return;
  }
  // check if we have collaborators to process
  if (collaborators.length == 0) {
	return;
  }

  var projBots = bots[project.project_id];
  for (var collabIdx in collaborators) {
	var uname = collaborators[collabIdx].login;
	// skip webmaster
	if (uname == "eclipsewebmaster") {
	  continue;
	}

	// get the bots for the current project
	if (projBots != undefined && projBots.indexOf(uname) != -1){
		console.log(`Keeping ${uname} as it was detected to be a bot for ${org}/${repo}`);
		continue;
	}
	
	// get the current users profile
    var url = `https://api.eclipse.org/github/profile/${uname}`;
    var r = await axios.get(url).then(result => {
      return result.data;
    }).catch(err => console.log(`Received error from Eclipse API querying for '${url}': ${err}`));
    // check user against list of project leads
    if (r != null) {
    	var eclipseUserName = r.name;
		var isProjectLead = false;
		for (var plIdx in project['project_leads']) {
			var projectLead = project['project_leads'][plIdx];
			if (projectLead.username == eclipseUserName) {
				isProjectLead = true;
				break;
			}
		}
		if (isProjectLead) {
			console.log(`User '${eclipseUserName}' is a project lead for the current repository, not removing`);
			continue;
		}
    }
	// remove collaborator if we've gotten to this point and dryrun isn't set
	if (!argv.d) {
		console.log(`Removing user '${uname}' from collaborators on ${org}/${repo}`);
		await wrap.removeUserAsCollaborator(org, repo, uname);
	} else {
		console.log(`Dry run set, would have removing user '${uname}' from collaborators on ${org}/${repo}`);
	}
  }
}


async function removeOrgExternalContributors(projects, org) {
  // get the collaborators
  var collaborators = await wrap.getOrgCollaborators(org);
  Atomics.wait(int32, 0, 0, waitTimeInMS);
  if (collaborators == undefined) {
	  console.log(`Error while fetching collaborators for ${org}`);
	  return;
  }
  // check if we have collaborators to process
  if (collaborators.length == 0) {
	return;
  }
  // check each of the collaborators, removing them if they arent a bot for a
  // project in the org
  for (var collabIdx in collaborators) {
	var uname = collaborators[collabIdx].login;
	console.log(`Checking collaborator '${uname}'...`);
	
	var isBot = false;
	var botKeys = Object.keys(bots);
	for (var botIdx in botKeys) {
		var botList = bots[botKeys[botIdx]];
		// check if the current user is in the current key-values list
		if (botList.indexOf(uname) != -1) {
			console.log(`Found user '${uname}' in bot list for project '${botKeys[botIdx]}', checking organizations`);
			// if we can determine that this user could be a bot, check that its
			// valid for current org
			for (var pIdx in projects) {
				var project = projects[pIdx];
				// check if our project ID is the ID associated with bot
				// and if the project has repositories within the given org
				if (project.project_id == botKeys[botIdx] &&project.pp_orgs.indexOf(org) != -1) {
				  isBot = true;
				  console.log(`Discovered bot account for '${botKeys[botIdx]}' in org ${org}`);
				  break;
			    }
			}
		}
		// if we flagged the user as a bot, stop processing
		if (isBot) {
			break;
		}
	}
	// check if the user was flagged as a bot for the current org
	if (isBot){
		console.log(`Keeping '${uname}' as it was detected to be a bot for org '${org}'`);
		continue;
	}
	
	// remove collaborator if we've gotten to this point and dryrun isn't set
	if (!argv.d) {
		console.log(`Removing user '${uname}' from collaborators on org '${org}'`);
		await wrap.removeUserAsOutsideCollaborator(org, uname);
	} else {
		console.log(`Dry run set, would have removing user '${uname}' from collaborators on ${org}`);
	}
  }
}

async function eclipseBots() {
	var botsRaw = await cHttp.getData("https://api.eclipse.org/bots");
	if (botsRaw == undefined) {
		console.log('Could not retrieve bots from API');
		process.exit(1);
	}
	return botsRaw;
}

function processBots(botsRaw){
	var botMap = {};
	for (var botIdx in botsRaw) {
		var bot = botsRaw[botIdx];
		if (bot["github.com"] == undefined) continue;
		
		var projBots = botMap[bot["projectId"]];
		if (projBots == undefined) {
			projBots = [];
		}
		projBots.push(bot["github.com"]["username"]);
		botMap[bot["projectId"]] = projBots;
	}
	return botMap;
}
