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


// add additional plugins for octokit to meet best practices
const Octokit = require('@octokit/rest')
  .plugin([
    require('@octokit/plugin-retry'),
    require('@octokit/plugin-throttling')
  ]);
const flatCache = require('flat-cache');
const winston = require('winston');

// variables for use with the cache
const teamCacheID = '1';
const repoCacheID = '2';
let teamCache = flatCache.load(teamCacheID);
let repoCache = flatCache.load(repoCacheID);

// keep track of which prefetches have been completed
let prefetch = {
    'teams':{},
    'repos':{}
};

// run variables
var dryrun = false;
var verbose = false;

// keep octokit outside of exports as its not needed to expose it there.
let octokit;

// count how many times the GitHub API was hit
var callCount = 0;

module.exports = function(token) {
  // instantiate octokit
  octokit = new Octokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, options) => {
        winston.warn(`Request quota exhausted for request ${options.method} ${options.url}`);

        if (options.request.retryCount === 0) { // only retries once
          console.log(`Retrying after ${retryAfter} seconds!`);
          return true;
        }
      },
      onAbuseLimit: (retryAfter, options) => {
        // does not retry, only logs a warning
        winston.warn(`Abuse detected for request ${options.method} ${options.url}`);
      }
    }
  });
  // enable dry run functionality
  this.setDryRun = function(doDryRun) {
    this.dryrun = doDryRun;
  };
  // enable dry run functionality
  this.setVerbose = function(isVerbose) {
    this.verbose = isVerbose;
  };
  this.getCallCount = function() {
    return callCount;
  };

	this.addTeam = function(org, team) {
    if (!org || !team) {
      winston.error('addTeam command requires organization and team to be set');
      return;
    }
    var sanitizedTeam = sanitizeTeamName(team);
    // check if the team already exists
    var cachedResult = teamCache.getKey(getTeamCacheKey(org, sanitizedTeam));
    if (cachedResult != null) {
      winston.debug(`Team with name ${team} already exists for ${org}, skipping creation`);
      return cachedResult;
    }
    
	  // call the API if dry run is not set
	  if (!this.dryrun) {
	    callCount++;
	    return octokit.teams.create({
	      'org': org,
	      'name': sanitizedTeam,
	      'privacy': 'closed'
	    }).then(result => {
	      // cache the result for later use
	      teamCache.setKey(getTeamCacheKey(org, sanitizedTeam), result.data);
	      
	      winston.debug(`Done creating team with name: ${org}:${sanitizedTeam}`);
	      return result.data;
	    }).catch(err => logError(err, 'team:create'));
	  } else {
	    winston.debug(`Dry run set, not writing new team ${org}:${sanitizedTeam}`);
	  }
	};
	
	/**
   * Adds repository to given team in organization. First calls GitHub to get an
   * ID given team name and organization. This ID is used in call to attach
   * given repo to a team.
   */
	this.addRepoToTeam = async function(org, team, repo, permissions = "pull") {  
    if (!org || !team || !repo) {
      winston.error('addRepoToTeam command requires organization, team, and repo to be set');
      return;
    }
    var sanitizedTeam = sanitizeTeamName(team);
    
		// call the API to get additional information about the team
	  var teamData = await getTeam(org, sanitizedTeam);
    // check if data was returned
		if (teamData == null) {
			return;
		}
		
		// if not set to dryrun, add repo to team in given org
	  if (!this.dryrun) {
      callCount++;
	    return octokit.teams.addOrUpdateRepo({
			  'owner': org,
			  'team_id': teamData.id,
			  'repo': repo,
			  'permission': permissions
			}).then(result => {
			  winston.debug(`Done adding repo to team: ${repo} -> ${org}/${sanitizedTeam}`)
			}).catch(err => logError(err, 'team:addOrUpdateRepo'));
	  } else {
	    winston.debug(`Dry run set, not writing new team ${org}/${name}`);	  
	  }
	};
  
	/**
   * Invites user with username of 'uname' to the given team in given
   * organization. Checks current member list to see if user should be invited.
   */
  this.inviteUserToTeam = async function(org, team, uname) {  
    if (!org || !team || !uname) {
      winston.error('inviteUserToTeam command requires organization, team, and uname to be set');
      return;
    }
    var sanitizedTeam = sanitizeTeamName(team);

    // call the API to get additional information about the team
    var teamData = await getTeam(org, sanitizedTeam);
    // check if data was returned
    if (teamData == null) {
      return;
    }
    
    // check if the user already exists in the team
    var teamMembers = await getTeamMembers(org, sanitizedTeam, teamData.id);
    for (var i = 0; i < teamMembers.length; i++) {
      if (teamMembers[i].login == uname) {
        winston.debug(`User with usernmae '${uname}' is already a member of ${org}/${sanitizedTeam}`);
        return;
      }
    }
    
    // if not set to dryrun, invite user to team
    if (!this.dryrun) {
      callCount++;
      return octokit.teams.addOrUpdateMembership({
        'team_id': teamData.id,
        'username': uname
      }).then(result => {
        winston.debug(`Done inviting user to team: ${uname} -> ${org}/${sanitizedTeam}`)
      }).catch(err => logError(err, 'team:addOrUpdateMembership'));
    }
  };
  
  /**
   * Removes user with username of 'uname' from the given team in given
   * organization. Checks current member list to see if user should be removed.
   */
  this.removeUserFromTeam = async function(org, team, uname) {  
    if (!org || !team || !uname) {
      winston.error('removeUserFromTeam command requires organization, team, and uname to be set');
      return;
    }
    var sanitizedTeam = sanitizeTeamName(team);
    
    // call the API to get additional information about the team
    var teamData = await getTeam(org, sanitizedTeam);
    // check if data was returned
    if (teamData == null) {
      return;
    }
    
    // check if the user already exists in the team
    var teamMembers = await getTeamMembers(org, sanitizedTeam, teamData.id);
    var isMember = false;
    for (var i = 0; i < teamMembers.length; i++) {
      if (teamMembers[i].login == uname) {
        isMember = true;
        break;
      }
    }
    if (!isMember) {
      winston.warn(`User with usernmae '${uname}' is not a member of ${org}/${team}, cannot remove`);
      return;
    }

    // if not set to dryrun, invite user to team
    if (!this.dryrun) {
      callCount++;
      return octokit.teams.removeMembership({
        'team_id': teamData.id,
        'username': uname
      }).then(result => {
        winston.debug(`Done removing user from team: ${uname} -> ${org}/${sanitizedTeam}`)
      }).catch(err => logError(err, 'team:removeMembership'));
    }
  };
  
  /**
   * Renames the given team in the organization with the passed new name.
   */
  this.renameTeam = async function(org, team, newName) {
    if (!org || !team || !newName) {
      winston.debug('renameTeam command requires organization, team, and new team name to be set');
      return;
    }
    var sanitizedTeam = sanitizeTeamName(team);
    var sanitizedNewTeam = sanitizeTeamName(newName);

    // call the API to get additional information about the team
    var teamData = await getTeam(org, sanitizedTeam);
    // check if data was returned
    if (teamData == null) {
      return;
    }

    if (!this.dryrun) {
      callCount++;
      return octokit.teams.update({
        'team_id': teamData.id,
        'name': sanitizedNewTeam
      }).then(result => {
        winston.debug(`Done renaming team: ${org}/${sanitizedTeam} -> ${org}/${sanitizedNewTeam}`)
      }).catch(err => logError(err, 'team:update'));
    }
  };

  /**
   * Creates a new repo with given name and an EPL-2.0 license.
   */
  this.addRepo = function(org, repo) {
    if (repoCache.getKey(getRepoCacheKey(org, repo)) != null) {
      winston.debug(`Repo with name ${repo} already exists for ${org}, skipping creation`);
      
      return repoCache.getKey(getRepoCacheKey(org, repo));
    }
    
    if (!this.dryrun) {
      callCount++;
      return octokit.repos.createInOrg({
        'org': org,
        'name': repo,
        'license_template': 'EPL-2.0'
      }).then(result => {
        // cache the result for later use
        repoCache.setKey(getRepoCacheKey(org, repo), result.data);
        
        winston.debug(`Done creating repo for org: ${org}/${repo}`);
        return result.data;
      }).catch(err => logError(err, 'repos:createInOrg'));
    }
  }

  /**
   * Retrieve all team members associated with a team, using multiple calls if
   * necessary to get all users on a team.
   */
  this.getTeamMembers = async function(org, team, teamId) {
    return getTeamMembers(org, team, teamId);
  };
  
  /**
   * Prefetch and fill caches with all existing teams for the current org. Will
   * check if prefetch has already been performed for current org.
   */
  this.prefetchTeams =async function(org) {
    if (prefetch['teams'][org] == true) {
      return;
    }
    winston.info(`Starting prefetch for teams in org=${org}`);
    
    var options = octokit.teams.list.endpoint.merge({
      'org': org
    });
    var data = await octokit.paginate(options)
      .then(result => result)
      .catch(err => logError(err, 'team:list'));
    if (data == undefined) {
      return;
    }
    
    var count = 0;
    for (var i = 0; i < data.length; i++) {
      var team = data[i];
      var cacheKey = getTeamCacheKey(org, sanitizeTeamName(team.slug));
      
      teamCache.setKey(cacheKey, team);
      count++;
    }
    
    // set the prefetch flag for org to true
    prefetch['teams'][org] = true;
    winston.info(`Finished prefetch for org=${org}, got ${count} teams`);
  };
  
  /**
   * Prefetch and fill caches with all existing repos for the current org. Will
   * check if prefetch has already been performed for current org.
   */
  this.prefetchRepos = async function(org) {
    if (prefetch['repos'][org] == true) {
      return;
    }
    winston.info(`Starting prefetch for repos in org=${org}`);
    var options = octokit.repos.listForOrg.endpoint.merge({
      'org': org
    });
    var data = await octokit.paginate(options)
      .then(result => result)
      .catch(err => logError(err, 'team:listMembers'));
    if (data == undefined) {
      return;
    }
    var count = 0;
    for (var i = 0; i < data.length; i++) {
      var repo = data[i];
      var cacheKey = getRepoCacheKey(org, repo.name);
      
      repoCache.setKey(cacheKey, repo);
      count++;
    }

    // set the prefetch flag for org to true
    prefetch['repos'][org] = true;
    winston.info(`Finished prefetch for org=${org}, got ${count} repos`);
  }
}
/** END OF EXPORTS */


/**
 * Wraps GitHub team retrieval functionality with simple caching and returning
 * future promises of content, or the content directly if cached. Deep copies
 * data to prevent external modification of state
 */
function getTeam(org, team) {
  // generate a cache key and check if we have a valid cache result.
  var cacheKey = getTeamCacheKey(org, sanitizeTeamName(team));
  var cachedResult = teamCache.getKey(cacheKey);
  
  winston.debug(`Getting team for key: ${cacheKey}`);
  // fetch if we don't have a cached result
  if (cachedResult == null) {
    callCount++;
    return octokit.teams.getByName({
      'org': org,
      'team_slug': sanitizeTeamName(team)
    }).then(result => {
      // cache the data in memory for use later
      teamCache.setKey(cacheKey, result.data);
      
      // return the data to the user
      return JSON.parse(JSON.stringify(result.data));
    }).catch(err => logError(err, 'team:getByName'));
  } else {
    winston.debug(`Found cached result for key ${cacheKey}`);
    
    // return result to be immediately used
    return JSON.parse(JSON.stringify(cachedResult));
  }
}

/**
 * Gets team members from API. Returns deep copies of results to prevent
 * modification of state data.
 */
async function getTeamMembers(org, team, teamId) {
  // generate a cache key and check if we have a valid cache result.
  var cacheKey = getTeamMembersCacheKey(org, team);
  var cachedResult = teamCache.getKey(cacheKey);

  winston.debug(`Getting team members for key: ${cacheKey}`);
  // fetch if we don't have a cached result
  if (cachedResult == null) {
    // loop through all available users, and add them to a list to be returned
    var options = octokit.teams.listMembers.endpoint.merge({
      'team_id': teamId
    });
    var data = await octokit.paginate(options)
      .then(result => result)
      .catch(err => logError(err, 'team:listMembers'));
    if (data == undefined) {
      return undefined;
    }
    
    // save the data to cache to avoid reprocessing
    teamCache.setKey(cacheKey, data);
    
    // return the data for usage
    return Array.from(data);
  } else {
    winston.debug(`Found cached result for key ${cacheKey}`);
    
    // return result to be immediately used
    return Array.from(cachedResult);
  }
}

function sanitizeTeamName(name) {
  return name.toLowerCase().replace(/[^\s\da-zA-Z-]/g, '-');
}

function getTeamCacheKey(org, team) {
  return `${org}/${team}`;
}

function getTeamMembersCacheKey(org, team) {
  return `${getTeamCacheKey(org, team)}:members`;
}

function getRepoCacheKey(org, repo) {
  return `${org}/${repo}`;
}

/**
 * Logs error content when passed, printing the root called that was passed for
 * additional contextual information.
 */
function logError(err, root) {
  winston.error(`API encountered errors processing current request (${root}). More information is available in log file`);
  if (err.errors) {
    for (var i = 0; i < err.errors.length; i++) {
      winston.debug(`${err.errors[i].message}`);
    }
  }
  winston.debug(err);
}
