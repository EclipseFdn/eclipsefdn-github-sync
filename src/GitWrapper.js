/** *****************************************************************************
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
const RETRY_COUNTS_DEFAULT = 2;
const ACCEPTED_HTTP_STATUS = 204;

// add additional plugins for octokit to meet best practices
const { Octokit } = require('@octokit/rest');
const { throttling } = require('@octokit/plugin-throttling');
const { retry } = require('@octokit/plugin-retry');

const { getLogger } = require('./logger.js');
let log = getLogger('info', 'GitWrapper');

const ExtendedOctokit = Octokit
  .plugin(retry)
  .plugin(throttling);
const flatCache = require('flat-cache');

// variables for use with the cache
const teamCacheID = '1';
const repoCacheID = '2';
const orgCacheID = '3';
let teamCache = flatCache.load(teamCacheID);
let repoCache = flatCache.load(repoCacheID);
let orgCache = flatCache.load(orgCacheID);

// keep track of which prefetches have been completed
let prefetch = {
  teams: {},
  repos: {},
};

// run variables

// keep octokit outside of exports as its not needed to expose it there.
let octokit;

// count how many times the GitHub API was hit
var callCount = 0;

module.exports = class {
  #token;
  #dryrun;
  #verbose;
  #logger;
  set logger(logger) {
    this.#logger = logger;
    // set external as well to log info
    log = logger;
  }
  get logger() {
    return this.#logger;
  }

  constructor(token, verbose = false, dryrun = false) {
    this.#token = token;
    this.#verbose = verbose;
    this.#dryrun = dryrun;
    this.#logger = getLogger(this.#verbose ? 'debug' : 'info', 'GitWrapper');
    // instantiate octokit
    octokit = new ExtendedOctokit({
      auth: this.#token,
      request: {
        retryAfter: 3,
      },
      throttle: {
        onRateLimit: (retryAfter, options) => {
          this.#logger.warn(`Request quota exhausted for request ${options.method} ${options.url}`);

          if (options.request.retryCount <= RETRY_COUNTS_DEFAULT) { // only retries once
            this.#logger.warn(`Retrying after ${retryAfter} seconds!`);
            return true;
          }
        },
        onAbuseLimit: (retryAfter, options) => {
          // does not retry, only logs a warning
          this.#logger.warn(`Abuse detected for request ${options.method} ${options.url}`);
          if (options.request.retryCount <= RETRY_COUNTS_DEFAULT) { // only retries once
            this.#logger.warn(`Retrying after ${retryAfter} seconds!`);
            return true;
          }
          return false;
        },
      },
    });
  }
  // enable dry run functionality
  setDryRun(doDryRun) {
    this.#dryrun = doDryRun;
  }

  // enable dry run functionality
  setVerbose(isVerbose) {
    this.#verbose = isVerbose;
    this.#logger = getLogger(this.#verbose ? 'debug' : 'info', 'GitWrapper');
  }

  getCallCount() {
    return callCount;
  }

  async checkAccess() {
    if (this.#token === undefined || this.#token === '') {
      this.#logger.error('Application was not given an access token and will not continue');
      return;
    }
    try {
      const { headers } = await octokit.request('HEAD /');
      const scopes = headers['x-oauth-scopes'].split(', ');
      if (scopes.indexOf('admin:org') < 0) {
        this.#logger.error('Application was not given an access token with the admin:org scope and will not continue');
      } else {
        return true;
      }
    } catch (err) {
      this.#logger.error('Application was not given a valid access token');
    }
    return false;
  }

  addTeam(org, teamName) {
    if (this.#verbose === true) {
      this.#logger.debug(`addTeam(org = ${org}, teamName = ${teamName})`);
    }
    if (!org || !teamName) {
      this.#logger.error('addTeam command requires organization and team to be set');
      return;
    }
    var sanitizedTeam = sanitizeTeamName(teamName);
    // check if the team already exists
    var cachedResult = teamCache.getKey(getTeamCacheKey(org, sanitizedTeam));
    if (cachedResult != null) {
      this.#logger.verbose(`Team with name ${teamName} already exists for ${org}, skipping creation`);
      return cachedResult;
    }

    // call the API if dry run is not set
    if (!this.#dryrun) {
      callCount++;
      return octokit.teams.create({
        org: org,
        name: sanitizedTeam,
        privacy: 'closed',
      }).then(result => {
        // cache the result for later use
        teamCache.setKey(getTeamCacheKey(org, sanitizedTeam), result.data);

        this.#logger.verbose(`Done creating team with name: ${org}:${sanitizedTeam}`);
        return result.data;
      }).catch(err => logError(err, 'team:create'));
    } else {
      this.#logger.debug(`Dry run set, not writing new team ${org}:${sanitizedTeam}`);
    }
  }

  /**
   * Adds repository to given team in organization. First calls GitHub to get
   * an ID given team name and organization. This ID is used in call to attach
   * given repo to a team.
   */
  async addRepoToTeam(org, teamName, repo, permissions = 'pull', overwrite = true) {
    if (this.#verbose === true) {
      this.#logger.debug(`addRepoToTeam(org = ${org}, teamName = ${teamName}, repo = ${repo}`
        + `, permissions = ${permissions}, overwrite = ${overwrite})`);
    }
    if (!org || !teamName || !repo) {
      this.#logger.warn('addRepoToTeam command requires organization, team, and repo to be set');
      return;
    }
    if (!overwrite && (await doesTeamManageRepo(org, teamName, repo))) {
      this.#logger.warn(`${org}/${repo} is already managed by ${teamName} and is set to not overwrite, returning`);
      return;
    }
    var sanitizedTeam = sanitizeTeamName(teamName);
    // call the API to get additional information about the team
    var teamData = await getTeam(org, sanitizedTeam);
    // check if data was returned
    if (teamData == null) {
      return;
    }

    // if not set to dryrun, add repo to team in given org
    if (!this.#dryrun) {
      callCount++;
      return octokit.teams.addOrUpdateRepoPermissionsInOrg({
        org: org,
        owner: org,
        team_slug: teamData.slug,
        repo: repo,
        permission: permissions,
      }).then(result => {
        this.#logger.verbose(`Done adding repo to team: ${repo} -> ${org}/${sanitizedTeam}`);
      }).catch(err => logError(err, 'team:addOrUpdateRepo'));
    } else {
      this.#logger.debug(`Dry run set, not writing new team ${org}/${sanitizedTeam}`);
    }
  }

  async removeTeam(org, teamName) {
    if (this.#verbose === true) {
      this.#logger.debug(`removeTeam(org = ${org}, teamName = ${teamName})`);
    }
    if (!org || !teamName) {
      this.#logger.warn('removeTeam command requires organization and teamName to be set');
      return;
    }
    var sanitizedTeam = sanitizeTeamName(teamName);
    // call the API to get additional information about the team
    var teamData = await getTeam(org, sanitizedTeam);
    // check if data was returned
    if (teamData == null) {
      return;
    }

    // if not set to dryrun, add repo to team in given org
    if (!this.#dryrun) {
      callCount++;
      return octokit.teams.deleteInOrg({
        org: org,
        team_slug: teamData.slug,
      }).then(result => {
        this.#logger.verbose(`Done removing team: ${org}/${sanitizedTeam}`);
      }).catch(err => logError(err, 'team:deleteInOrg'));
    } else {
      this.#logger.debug(`Dry run set, not removing team ${org}/${sanitizedTeam}`);
    }
  }

  /**
   * Invites user with username of 'uname' to the given team in given
   * organization. Checks current member list to see if user should be
   * invited.
   */
  async inviteUserToTeam(org, teamName, uname) {
    if (this.#verbose === true) {
      this.#logger.debug(`inviteUserToTeam(org = ${org}, teamName = ${teamName}, uname = ${uname})`);
    }
    if (!org || !teamName || !uname) {
      this.#logger.warn('inviteUserToTeam command requires organization, team, and uname to be set');
      return;
    }
    var sanitizedTeam = sanitizeTeamName(teamName);

    // call the API to get additional information about the team
    var teamData = await getTeam(org, sanitizedTeam);
    // check if data was returned
    if (teamData === null) {
      return;
    }

    // check if the user already exists in the team
    var teamMembers = await getTeamMembers(org, teamData);
    if (teamMembers === undefined) {
      return;
    }
    for (var i = 0; i < teamMembers.length; i++) {
      if (teamMembers[i].login === uname) {
        this.#logger.verbose(`User with usernmae '${uname}' is already a member of ${org}/${sanitizedTeam}`);
        return;
      }
    }

    // if not set to dryrun, invite user to team
    if (!this.#dryrun) {
      callCount++;
      return octokit.teams.addOrUpdateMembershipForUserInOrg({
        org: org,
        team_slug: teamData.slug,
        username: uname,
      }).then(result => {
        this.#logger.verbose(`Done inviting user to team: ${uname} -> ${org}/${sanitizedTeam}`);
      }).catch(err => logError(err, 'team:addOrUpdateMembership'));
    }
  }

  /**
   * Removes user with username of 'uname' from the given team in given
   * organization. Checks current member list to see if user should be
   * removed.
   */
  async removeUserFromTeam(org, teamName, uname) {
    if (this.#verbose === true) {
      this.#logger.debug(`removeUserFromTeam(org = ${org}, teamName = ${teamName}, uname = ${uname})`);
    }
    if (!org || !teamName || !uname) {
      this.#logger.warn('removeUserFromTeam command requires organization, team, and uname to be set');
      return;
    }
    var sanitizedTeam = sanitizeTeamName(teamName);

    // call the API to get additional information about the team
    var teamData = await getTeam(org, sanitizedTeam);
    // check if data was returned
    if (teamData === null) {
      return;
    }

    // check if the user already exists in the team
    var teamMembers = await getTeamMembers(org, teamData);
    if (teamMembers === undefined) {
      return;
    }
    var isMember = false;
    for (var i = 0; i < teamMembers.length; i++) {
      if (teamMembers[i].login === uname) {
        isMember = true;
        break;
      }
    }
    if (!isMember) {
      this.#logger.warn(`User with username '${uname}' is not a member of ${org}/${teamName}, cannot remove`);
      return;
    }

    // if not set to dryrun, invite user to team
    if (!this.#dryrun) {
      callCount++;
      return octokit.teams.removeMembershipForUserInOrg({
        org: org,
        team_slug: teamData.slug,
        username: uname,
      }).then(result => {
        this.#logger.verbose(`Done removing user from team: ${uname} -> ${org}/${sanitizedTeam}`);
      }).catch(err => logError(err, 'team:removeMembership'));
    }
  }

  /**
   * Renames the given team in the organization with the passed new name.
   */
  async renameTeam(org, teamName, newName) {
    if (this.#verbose === true) {
      this.#logger.debug(`addRepo(org = ${org}, teamName = ${teamName}, newName = ${newName})`);
    }
    if (!org || !teamName || !newName) {
      this.#logger.warn('renameTeam command requires organization, team, and new team name to be set');
      return;
    }
    var sanitizedTeam = sanitizeTeamName(teamName);
    var sanitizedNewTeam = sanitizeTeamName(newName);

    // call the API to get additional information about the team
    var teamData = await getTeam(org, sanitizedTeam);
    // check if data was returned
    if (teamData === null) {
      return;
    }

    if (!this.#dryrun) {
      callCount++;
      return octokit.teams.updateInOrg({
        org: org,
        team_slug: teamData.slug,
        name: sanitizedNewTeam,
      }).then(result => {
        this.#logger.verbose(`Done renaming team: ${org}/${sanitizedTeam} -> ${org}/${sanitizedNewTeam}`);
      }).catch(err => logError(err, 'team:update'));
    }
  }

  /**
   * Creates a new repo with given name and an EPL-2.0 license.
   */
  addRepo(org, repo) {
    if (this.#verbose === true) {
      this.#logger.debug(`addRepo(org = ${org}, repo = ${repo})`);
    }
    if (repoCache.getKey(getRepoCacheKey(org, repo)) !== null) {
      this.#logger.warn(`Repo with name ${repo} already exists for ${org}, skipping creation`);

      return repoCache.getKey(getRepoCacheKey(org, repo));
    }

    if (!this.#dryrun) {
      callCount++;
      return octokit.repos.createInOrg({
        org: org,
        name: repo,
        license_template: 'EPL-2.0',
      }).then(result => {
        // cache the result for later use
        repoCache.setKey(getRepoCacheKey(org, repo), result.data);

        this.#logger.verbose(`Done creating repo for org: ${org}/${repo}`);
        return result.data;
      }).catch(err => logError(err, 'repos:createInOrg'));
    }
  }

  /**
   * Retrieve all team members associated with a team, using multiple calls if
   * necessary to get all users on a team.
   */
  async getTeamMembers(org, team) {
    return getTeamMembers(org, team);
  }

  async editTeam(org, team, options) {
    if (this.#verbose === true) {
      this.#logger.debug(`editTeam(org = ${org}, team = ${JSON.stringify(team)}, options = ${JSON.stringify(options)})`);
    }
    this.#logger.verbose(`Updating team ${team} settings: ${JSON.stringify(options)}`);
    // call the API to get additional information about the team
    var teamData = await getTeam(org, sanitizeTeamName(team));
    // check if data was returned
    if (teamData == null) {
      this.#logger.warn(`Could not find team with name ${team} to update`);
      return;
    }
    // allow for other options being set
    var opt = options;
    if (opt === null) {
      opt = {};
    }
    // set the required team options
    opt['org'] = org;
    opt['team_slug'] = teamData.slug;
    opt['name'] = teamData.name;
    return await octokit.teams.updateInOrg(opt)
      .then(result => result)
      .catch(err => logError(err, 'team:list'));
  }

  /**
   * Prefetch and fill caches with all existing teams for the current org.
   * Will check if prefetch has already been performed for current org.
   */
  async prefetchTeams(org) {
    if (this.#verbose === true) {
      this.#logger.debug(`prefetchTeams(org = ${org})`);
    }
    if (prefetch['teams'][org] === true) {
      if (this.#verbose === true) {
        this.#logger.debug(`Org '${org}' teams have been fetched previously, returning`);
      }
      return;
    }
    this.#logger.info(`Starting prefetch for teams in org=${org}`);

    var options = octokit.teams.list.endpoint.merge({
      org: org,
    });
    var data = await octokit.paginate(options)
      .then(result => result)
      .catch(err => logError(err, 'team:list'));
    if (data === undefined) {
      this.#logger.error(`An error occured while prefetching teams for org '${org}', returning`);
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
    this.#logger.verbose(`Finished prefetch for org=${org}, got ${count} teams`);
  }

  /**
   * Prefetch and fill caches with all existing repos for the current org.
   * Will check if prefetch has already been performed for current org.
   */
  async prefetchRepos(org) {
    if (this.#verbose === true) {
      this.#logger.debug(`prefetchRepos(org = ${org})`);
    }
    if (prefetch['repos'][org] === true) {
      if (this.#verbose === true) {
        this.#logger.debug(`Org '${org}' repos have been fetched previously, returning`);
      }
      return;
    }
    this.#logger.verbose(`Starting prefetch for repos in org=${org}`);
    var options = octokit.repos.listForOrg.endpoint.merge({
      org: org,
    });
    var data = await octokit.paginate(options)
      .then(result => result)
      .catch(err => logError(err, 'team:listMembers'));
    if (data === undefined) {
      this.#logger.error(`An error occured while prefetching repos for org '${org}', returning`);
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
    this.#logger.verbose(`Finished prefetch for org=${org}, got ${count} repos`);
  }

  /**
   * Gets all teams for a given organization
   */
  async getTeamsForOrg(org) {
    if (this.#verbose === true) {
      this.#logger.debug(`getTeamsForOrg(org = ${org})`);
    }
    await this.prefetchTeams(org);
    var out = [];
    for (var repo in teamCache.all()) {
      out.push(JSON.parse(JSON.stringify(teamCache.getKey(repo))));
    }
    return out;
  }

  /**
   * Wraps GitHub repo team functionality in paginate to reduce calls for
   * potential large repos. Returns raw results with no cache
   */
  async getReposForTeam(org, team) {
    if (this.#verbose === true) {
      this.#logger.debug(`getReposForTeam(org = ${org}, team = ${JSON.stringify(team)})`);
    }
    this.#logger.verbose(`Getting repos associated with team: ${team.name}`);
    var options = octokit.teams.listReposInOrg.endpoint.merge({
      team_slug: team.slug,
      org: org,
    });
    return await octokit.paginate(options)
      .then(result => result)
      .catch(err => logError(err, 'teams:listRepos'));
  }

  async getInvitedMembers(org, team) {
    if (this.#verbose === true) {
      this.#logger.debug(`getInvitedMembers(org = ${org}, team = ${JSON.stringify(team)})`);
    }
    // generate a cache key and check if we have a valid cache result.
    var cacheKey = getInvitedMembersCacheKey(org, team.slug);
    var cachedResult = teamCache.getKey(cacheKey);

    this.#logger.verbose(`Getting invited members for key: ${cacheKey}`);
    // fetch if we don't have a cached result
    if (cachedResult === undefined) {
      // loop through all available users, and add them to a list to be
      // returned
      var options = octokit.teams.listPendingInvitationsInOrg.endpoint.merge({
        team_slug: team.slug,
        org: org,
      });
      var data = await octokit.paginate(options)
        .then(result => result)
        .catch(err => logError(err, 'team:listPendingInvitations'));
      if (data === undefined) {
        return undefined;
      }

      // save the data to cache to avoid reprocessing
      teamCache.setKey(cacheKey, data);

      // return the data for usage
      return Array.from(data);
    } else {
      this.#logger.verbose(`Found cached result for key ${cacheKey}`);

      // return result to be immediately used
      return Array.from(cachedResult);
    }
  }

  async getOrgCollaborators(org) {
    if (this.#verbose === true) {
      this.#logger.debug(`getOrgCollaborators(org = ${org})`);
    }
    var cacheKey = getOrgCollabCacheKey(org);
    var cachedResult = orgCache.getKey(cacheKey);

    this.#logger.verbose(`Getting invited members for key: ${cacheKey}`);
    // fetch if we don't have a cached result
    if (cachedResult === undefined) {
      // loop through all available users, and add them to a list to be
      // returned
      var options = octokit.orgs.listOutsideCollaborators.endpoint.merge({
        org: org,
      });
      var data = await octokit.paginate(options)
        .then(result => result)
        .catch(err => logError(err, 'orgs:listOutsideCollaborators'));
      if (data === undefined) {
        return undefined;
      }

      // save the data to cache to avoid reprocessing
      orgCache.setKey(cacheKey, data);

      // return the data for usage
      return Array.from(data);
    } else {
      this.#logger.debug(`Found cached result for key ${cacheKey}`);

      // return result to be immediately used
      return Array.from(cachedResult | {});
    }
  }

  async getRepoCollaborators(org, repo, affiliation = 'direct') {
    if (this.#verbose === true) {
      this.#logger.debug(`getRepoCollaborators(org = ${org}, repo = ${repo}, affiliation = ${affiliation})`);
    }
    // generate a cache key and check if we have a valid cache result.
    var cacheKey = getRepoCollaboratorCacheKey(org, repo);
    var cachedResult = repoCache.getKey(cacheKey);

    this.#logger.verbose(`Getting collaborators for key: ${cacheKey}`);
    // fetch if we don't have a cached result
    if (cachedResult === undefined) {
      // loop through all available users, and add them to a list to be
      // returned
      var options = octokit.repos.listCollaborators.endpoint.merge({
        owner: org,
        repo: repo,
        affiliation: affiliation,
      });
      var data = await octokit.paginate(options)
        .then(result => result)
        .catch(err => logError(err, 'team:listCollaborators'));
      if (data === undefined) {
        return undefined;
      }

      // save the data to cache to avoid reprocessing
      teamCache.setKey(cacheKey, data);

      // return the data for usage
      return Array.from(data);
    } else {
      this.#logger.debug(`Found cached result for key ${cacheKey}`);

      // return result to be immediately used
      return Array.from(cachedResult);
    }
  }


  async removeUserAsCollaborator(org, repo, uname) {
    if (this.#verbose === true) {
      this.#logger.debug(`removeUserAsCollaborator(org = ${org}, repo = ${repo}, uname = ${uname})`);
    }
    if (!org || !repo || !uname) {
      this.#logger.error('removeUserAsCollaborator command requires organization, repo, and uname to be set');
      return;
    }

    var collabs = await this.getRepoCollaborators(org, repo);
    if (collabs === null) {
      this.#logger.warn(`Could not find collaborators for team ${org}/${repo}`);
      return;
    }
    var isCollaborator = false;
    for (var i = 0; i < collabs.length; i++) {
      if (collabs[i].login === uname) {
        isCollaborator = true;
        break;
      }
    }
    if (!isCollaborator) {
      this.#logger.warn(`User with usernmae '${uname}' is not a collaborator on ${org}/${repo}, cannot remove`);
      return;
    }

    // if not set to dryrun, invite user to team
    if (!this.#dryrun) {
      callCount++;
      return octokit.repos.removeCollaborator({
        owner: org,
        repo: repo,
        username: uname,
      }).then(result => {
        this.#logger.verbose(`Done removing user from team: ${uname} -> ${org}/${repo}`);
      }).catch(err => logError(err, 'repo:removeCollaborator'));
    }
  }

  async removeUserAsOutsideCollaborator(org, uname) {
    if (this.#verbose === true) {
      this.#logger.debug(`removeUserAsOutsideCollaborator(org = ${org}, uname = ${uname})`);
    }
    if (!org || !uname) {
      this.#logger.warn('removeUserAsOutsideCollaborator command requires organization and uname to be set');
      return;
    }

    var collabs = await this.getOrgCollaborators(org);
    if (collabs === null) {
      this.#logger.warn(`Could not find outside collaborators for team ${org}`);
      return;
    }
    var isCollaborator = false;
    for (var i = 0; i < collabs.length; i++) {
      if (collabs[i].login === uname) {
        isCollaborator = true;
        break;
      }
    }
    if (!isCollaborator) {
      this.#logger.warn(`User with username '${uname}' is not an outside collaborator on ${org}, cannot remove`);
      return;
    }

    // if not set to dryrun, remove outside collaborator from org
    if (!this.#dryrun) {
      callCount++;
      return octokit.orgs.removeOutsideCollaborator({
        org: org,
        username: uname,
      }).then(result => {
        this.#logger.verbose(`Done removing outside collaborator from org: ${uname} -> ${org}`);
      }).catch(err => logError(err, 'orgs:removeOutsideCollaborator'));
    }
  }

  /**
   * Updates permissions for a given organization given an object
   * with permissions and organization name.
   */
  updateOrgPermissions(org, permissions) {
    if (this.#verbose === true) {
      this.#logger.debug(`updateOrgPermissions(org = ${org}, permissions = ${JSON.stringify(permissions)})`);
    }
    if (org === undefined || org === '') {
      this.#logger.warn('Cannot update permissions for empty org name');
      return;
    }
    if (permissions === undefined || !(permissions instanceof Object)) {
      this.#logger.warn('Cannot update organization with empty permissions');
      return;
    }
    // copy the permissions, and set the org into the new params object
    var params = JSON.parse(JSON.stringify(permissions));
    params.org = org;
    // required in v16 to enable additional management fields
    params.mediaType = {
      previews: ['surtur'],
    };
    if (!this.#dryrun) {
      // increment the call count  and update the permissions for the organization
      callCount++;
      return octokit.orgs.update(params).then(result => {
        // if verbose is set, print the parameters to this.#logger
        if (this.#verbose) {
          this.#logger.debug(`Done updating org (${org}) to set parameters: ${JSON.stringify(params)}`);
        } else {
          this.#logger.verbose(`Done updating org (${org}) to set parameters.`);
        }
      }).catch(err => logError(err, 'orgs:update'));
    } else {
      this.#logger.debug(`Dry run enabled, would have updated org (${org}) to set parameters: ${JSON.stringify(params)}`);
    }
  }

  getOrganization(org) {
    if (this.#verbose === true) {
      this.#logger.debug(`getOrganization(org = ${org})`);
    }
    // generate a cache key and check if we have a valid cache result.
    var cacheKey = getOrgCacheKey(org);
    var cachedResult = orgCache.getKey(cacheKey);

    this.#logger.verbose(`Getting org for key: ${cacheKey}`);
    // fetch if we don't have a cached result
    if (cachedResult === undefined) {
      callCount++;
      return octokit.orgs.get({
        org: org,
        mediaType: {
          previews: ['surtur'],
        },
      }).then(result => {
        // cache the data in memory for use later
        orgCache.setKey(cacheKey, result.data);
        // return the data to the user
        return JSON.parse(JSON.stringify(result.data));
      }).catch(err => logError(err, 'orgs:get'));
    } else {
      this.#logger.debug(`Found cached result for key ${cacheKey}`);

      // return result to be immediately used
      return JSON.parse(JSON.stringify(cachedResult));
    }
  }

  /**
   * Used to read cached/discovered repositories given an org name.
   */
  getDiscoveredRepos(org) {
    if (this.#verbose === true) {
      this.#logger.debug(`getDiscoveredRepos(org = ${org})`);
    }
    var out = [];
    var keys = repoCache.keys();
    var regex = new RegExp(`^${org}/.*$`);
    for (var kIdx in keys) {
      var key = keys[kIdx];
      if (regex.test(key)) {
        out.push(repoCache.getKey(key));
      }
    }
    return out;
  }

  /**
   * Used to read cached/discovered repositories given an org name.
   */
  async getTeamsForRepo(org, repo) {
    if (this.#verbose === true) {
      this.#logger.debug(`getTeamsForRepo(org = ${org}, repo = ${repo})`);
    }
    if (!org || !repo) {
      this.#logger.warn('getTeamsForRepo command requires organization and repo to be set');
      return;
    }
    // if not set to dryrun, remove outside collaborator from org
    var options = octokit.repos.listTeams.endpoint.merge({
      owner: org,
      repo: repo,
    });
    return await octokit.paginate(options)
      .then(result => result)
      .catch(err => logError(err, 'repos:listTeams'));
  }

  sanitizeTeamName(name) {
    return name.toLowerCase().replace(/[^\s\da-zA-Z-]/g, '-');
  }
};
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

  log.verbose(`Getting team for key: ${cacheKey}`);
  // fetch if we don't have a cached result
  if (cachedResult === undefined) {
    callCount++;
    return octokit.teams.getByName({
      org: org,
      team_slug: sanitizeTeamName(team),
    }).then(result => {
      // cache the data in memory for use later
      teamCache.setKey(cacheKey, result.data);

      // return the data to the user
      return JSON.parse(JSON.stringify(result.data));
    }).catch(err => logError(err, 'team:getByName'));
  } else {
    log.verbose(`Found cached result for key ${cacheKey}`);

    // return result to be immediately used
    return JSON.parse(JSON.stringify(cachedResult));
  }
}

/**
 * Gets team members from API. Returns deep copies of results to prevent
 * modification of state data.
 */
async function getTeamMembers(org, team) {
  // generate a cache key and check if we have a valid cache result.
  var cacheKey = getTeamMembersCacheKey(org, team.name);
  var cachedResult = teamCache.getKey(cacheKey);

  log.verbose(`Getting team members for key: ${cacheKey}`);
  // fetch if we don't have a cached result
  if (cachedResult === undefined) {
    // loop through all available users, and add them to a list to be returned
    var options = octokit.teams.listMembersInOrg.endpoint.merge({
      org: org,
      team_slug: team.slug,
    });
    var data = await octokit.paginate(options)
      .then(result => result)
      .catch(err => logError(err, 'team:listMembers'));
    if (data === undefined) {
      return undefined;
    }

    // save the data to cache to avoid reprocessing
    teamCache.setKey(cacheKey, data);

    // return the data for usage
    return Array.from(data);
  } else {
    log.verbose(`Found cached result for key ${cacheKey}`);

    // return result to be immediately used
    return Array.from(cachedResult);
  }
}

async function doesTeamManageRepo(org, teamName, repo) {
  if (!org || !teamName || !repo) {
    log.debug('checkManagesRepoInOrg command requires organization, team, and repo to be set');
    return;
  }
  var sanitizedTeamName = sanitizeTeamName(teamName);
  // get the team for its ID
  var team = getTeam(org, sanitizedTeamName);
  if (team === null) {
    log.warn(`Could not find team for ${org}/${sanitizedTeamName}, returning false for team management`);
    return false;
  }
  // check if we already know about this teams management of repo
  var cachedResult = teamCache.getKey(getTeamManagementCacheKey(org, team.id, repo));
  if (cachedResult !== undefined) {
    return cachedResult;
  }
  // attempt to check, catching errors which throw on 404s
  try {
    var result = await octokit.teams.checkPermissionsForRepoInOrg({
      org: org,
      team_slug: team.slug,
      owner: org,
      repo: repo,
    });
    teamCache.setKey(getTeamManagementCacheKey(org, team.id, repo), result.status === ACCEPTED_HTTP_STATUS);
    return result.status === ACCEPTED_HTTP_STATUS;
  } catch (e) {
    log.warn('Retrieved an error, assuming team does not manage repo');
    return false;
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
function getTeamManagementCacheKey(org, team, repo) {
  return `${getRepoCacheKey(org, repo)}->${team}:manages`;
}

function getInvitedMembersCacheKey(org, team) {
  return `${getTeamCacheKey(org, team)}:invited`;
}

function getRepoCollaboratorCacheKey(org, repo) {
  return `${getRepoCacheKey(org, repo)}:collab`;
}

function getRepoCacheKey(org, repo) {
  return `${org}/${repo}`;
}
function getOrgCollabCacheKey(org) {
  return `collaborators:${org}`;
}
function getOrgCacheKey(org) {
  return `org:${org}`;
}
/**
 * Logs error content when passed, printing the root called that was passed for
 * additional contextual information.
 */
function logError(err, root) {
  log.error(`API encountered errors processing current request (${root}). More information is available in log file`);
  if (err.errors) {
    for (var i = 0; i < err.errors.length; i++) {
      log.error(`${err.errors[i].message}`);
    }
  }
  log.error(err);
}
