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

// custom wrappers
const Wrapper = require('./GitWrapper.js');
const { HttpWrapper } = require('./HttpWrapper.js');
const EclipseAPI = require('./EclipseAPI.js');

// set up yargs command line parsing
var argv = require('yargs')
  .usage('Usage: $0 [options]')
  .example('$0', '')
  .option('d', {
    alias: 'dryrun',
    description: 'Runs script as dry run, not writing any changes to API',
    boolean: true,
  })
  .option('t', {
    alias: 'devMode',
    description: 'Runs script in dev mode, which returns API data that does not impact production organizations/teams. '
      + 'This does NOT affect the static team manager. If testing is wanted for that integration, verbose and dryrun mode are suggested.',
    boolean: true,
  })
  .option('V', {
    alias: 'verbose',
    description: 'Sets the script to run in verbose mode',
    boolean: true,
  })
  .option('D', {
    alias: 'deletionDryRun',
    description: 'Runs the script in a semi-dryrun state to prevent deletions of users',
    boolean: true,
  })
  .option('p', {
    alias: 'project',
    description: 'The project ID that should be targeted for this sync run',
  })
  .option('s', {
    alias: 'secretLocation',
    description: 'The location of the access-token file containing an API access token',
  })
  .help('h')
  .alias('h', 'help')
  .version('0.1')
  .alias('v', 'version')
  .epilog('Copyright 2019 Eclipse Foundation inc.')
  .argv;

const DEFAULT_ORG_PERMISSIONS = {
  default_repository_permission: 'read',
  members_can_create_repositories: false,
  members_can_create_private_repositories: false,
  members_can_create_public_repositories: false,
  members_allowed_repository_creation_type: 'none',
};
const API_OK_STATUS = 200;
const API_MISSING_STATUS = 404;
const EXIT_ERROR_STATE = 1;

const { getLogger } = require('./logger.js');
const logger = getLogger(argv.V ? 'debug' : 'info', 'main');
const axios = require('axios');
const { SecretReader, getBaseConfig } = require('./SecretReader.js');
const { StaticTeamManager, ServiceTypes } = require('./teams/StaticTeamManager.js');

// create global placeholder for wrapper
var wrap;
var cHttp;
var eclipseApi;
var bots;
var stm;

_prepareSecret();

/**
 * Retrieves secret API token from system, and then starts the script via _init
 *
 * @returns
 */
function _prepareSecret() {
  // retrieve the secret API file root if set
  var settings = getBaseConfig();
  if (argv.s !== undefined) {
    settings.root = argv.s;
  }
  var reader = new SecretReader(settings);
  // get the secret and start the script if set
  var secret = reader.readSecret('api-token');
  if (secret !== null) {
    _init(secret.trim());
  }
}

/**
 * Async as we require blocking to ensure that data is available when processing
 * starts.
 */
async function _init(secret) {
  if (secret === undefined || secret === '') {
    logger.error('Could not fetch API secret, exiting');
    return;
  }
  wrap = new Wrapper(secret);
  if (!await wrap.checkAccess()) {
    return;
  }
  wrap.setDryRun(argv.d);
  wrap.setVerbose(argv.V);
  logger.info(`Running in dryrun? ${argv.d}`);

  cHttp = new HttpWrapper();
  stm = new StaticTeamManager();
  stm.verbose = argv.V;

  eclipseApi = new EclipseAPI();
  eclipseApi.verbose = argv.V;
  eclipseApi.testMode = argv.t;
  // get raw project data and post process to add additional context
  var data = await eclipseApi.eclipseAPI('?github_only=1');
  data = eclipseApi.postprocessEclipseData(data, 'github_repos');

  logger.info(`Finished preloading ${data.length} projects`);
  // get bots for raw project processing
  var rawBots = await eclipseApi.eclipseBots();
  bots = eclipseApi.processBots(rawBots);
  logger.info(`Found ${Object.keys(bots).length} registered bots`);

  // start the sync operation.
  await runSync(data);

  // close the wrappers, persisting required cache info
  cHttp.close();
}

async function runSync(data) {
  var start = new Date();
  // used to track which orgs have been processed for removing outside collabs
  var uniqueOrgs = [];
  for (var key in data) {
    var project = data[key];
    var projectID = project.project_id;
    var repos = project.github_repos;
    if (argv.p !== undefined && projectID !== argv.p) {
      console.log(`Project target set ('${argv.p}'). Skipping non-matching project ${projectID}`);
      continue;
    }
    logger.info(`Project ID: ${projectID}`);

    // maintain orgs used by this project
    var orgs = await processRepositories(repos, project);
    // check if org has been processed earlier
    for (var orgIdx in orgs) {
      var org = orgs[orgIdx];
      if (!uniqueOrgs.includes(org)) {
        logger.info(`Removing outside collaborators for ${org}`);
        await removeOrgExternalContributors(data, org);
        uniqueOrgs.push(org);
      }
    }
  }
  logger.info('Beginning processing of static teams');
  // retrieve the static teams for GitHub
  var teams = stm.processTeams(ServiceTypes.GITHUB);
  if (argv.V) {
    logger.info(`Number of custom teams discovered: ${teams.length}`);
  }
  for (var tIdx in teams) {
    var team = teams[tIdx];
    // process each team individually
    await processStaticTeam(team);
  }

  // log how long it took to do this stuff
  var end = new Date();
  logger.info(`Start: ${start}, end: ${end}, calls: ${wrap.getCallCount()}`);
}

async function processRepositories(repos, project) {
  if (argv.V === true) {
    logger.debug(`Sync:processRepositories(repos = ${JSON.stringify(repos)}, project = ${JSON.stringify(project)})`);
  }
  var orgs = [];
  for (var idx in repos) {
    var repo = repos[idx];
    var org = repo.org;
    var repoName = repo.repo;
    logger.info(`Starting sync for org=${org};repo=${repoName}`);

    // check if we've processed this org yet, if not, then create teams and
    // add users
    if (!orgs.includes(org)) {
      logger.info(`Generating teams for ${org}/${repoName}`);
      await processProjectsOrg(org, project);
      orgs.push(org);
    }

    // process contributors for the team
    var successfullyUpdatedExt = await removeRepoExternalContributors(project, org, repoName);
    if (argv.V === true) {
      logger.verbose(`Updated external contributors: ${successfullyUpdatedExt}`);
    }
    if (!argv.d) {
      try {
        // Ensure that the teams refer to the repo
        var updatedCommit = await wrap.addRepoToTeam(org, `${project.project_id}-committers`, repoName, 'push');
        var updatedContrib = await wrap.addRepoToTeam(org, `${project.project_id}-contributors`, repoName, 'triage');
        var updatedPL = await wrap.addRepoToTeam(org, `${project.project_id}-project-leads`, repoName, 'maintain', false);
        if (argv.V === true) {
          logger.verbose(`Attempted update commit team: ${updatedCommit === undefined}`);
          logger.verbose(`Attempted update contrib team: ${updatedContrib === undefined}`);
          logger.verbose(`Attempted update pl team: ${updatedPL === undefined}`);
        }
      } catch (e) {
        logger.error(`Error while updating ${project.project_id}. \n${e}`);
      }
    } else {
      logger.debug(`Dry run set, not adding repo '${repoName}' for org: ${org}`);
    }
  }
  return orgs;
}

async function processStaticTeam(team) {
  var orgs = [];
  logger.info(`Processing static team ${team.name}`);
  for (var rIdx in team.repos) {
    var repoURL = team.repos[rIdx];
    var match = /\/([^/]+)\/([^/]+)\/?$/.exec(repoURL);
    // check to make sure we got a match
    if (match == null) {
      logger.warn(`Cannot match repo and org from repo URL ${repoURL}, skipping`);
      continue;
    }

    // get the org + repo from the repo URL
    var org = match[1];
    var repoName = match[2];
    if (argv.V) {
      logger.info(`Processing static team ${team.name} for repo ${repoName} in org ${org}`);
    }
    // check if team is expired and should be deleted/skipped
    if (team.expiration !== undefined) {
      var expirationDate = new Date(team.expiration);
      // check if the expiration value is valid and after now
      if (expirationDate.getTime() < Date.now()) {
        logger.info(`Team with name ${team.name} is expired, it will be removed if present`);
        await wrap.removeTeam(org, wrap.sanitizeTeamName(team.name));
        continue;
      }
    }
    if (!orgs.includes(org)) {
      logger.info(`Generating teams for ${org}/${repoName}`);
      await processOrg(org, team);
      orgs.push(org);
    }
    if (!argv.d) {
      try {
        // update the team to have access to the repository
        await wrap.addRepoToTeam(org, wrap.sanitizeTeamName(team.name), repoName, team.permission);
      } catch (e) {
        logger.warn(`Error while updating ${wrap.sanitizeTeamName(team.name)}. \n${e}`);
      }
    } else {
      logger.debug(`Dry run set, not adding repo '${repoName}' to team '${wrap.sanitizeTeamName(team.name)}' for org: ${org}`);
    }
  }

}

async function processProjectsOrg(org, project) {
  if (argv.V === true) {
    logger.debug(`Sync:processProjectsOrg(org = ${org}, project = ${JSON.stringify(project)})`);
  }
  // prefetch teams to reduce redundant calls
  await wrap.prefetchTeams(org);
  await wrap.prefetchRepos(org);

  // create the teams for the current org + update perms
  if (!argv.d) {
    await wrap.updateOrgPermissions(org, DEFAULT_ORG_PERMISSIONS);
    await updateProjectTeam(org, project, 'contributors');
    await updateProjectTeam(org, project, 'committers');
    await updateProjectTeam(org, project, 'project_leads');
  } else {
    logger.debug('Dry run set, not adding teams for org: ' + org);
  }
}
async function processOrg(org, team) {
  if (argv.V === true) {
    logger.debug(`Sync:processOrg(org = ${org}, team = ${team})`);
  }
  // prefetch teams to reduce redundant calls
  await wrap.prefetchTeams(org);
  await wrap.prefetchRepos(org);
  var teamName = wrap.sanitizeTeamName(team.name);
  // create the teams for the current org
  if (!argv.d) {
    await updateTeam(org, teamName, team.members, undefined);
  } else {
    logger.debug(`Dry run set, not adding team '${teamName}' for org: ${org}`);
    if (argv.V) {
      logger.silly(`Would have added the following users to team '${teamName}': \n${JSON.stringify(team.members)}`);
    }
  }
}

async function updateProjectTeam(org, project, grouping) {
  if (argv.V === true) {
    logger.debug(`Sync:updateProjectTeam(org = ${org}, project = ${JSON.stringify(project)}, grouping = ${grouping})`);
  }
  var projectID = project.project_id;
  var teamName = wrap.sanitizeTeamName(`${projectID}-${grouping}`);
  updateTeam(org, teamName, project[grouping], project);
}

async function updateTeam(org, teamName, designatedMembers, project) {
  if (argv.V === true) {
    logger.debug(`Sync:updateTeam(org = ${org}, teamName = ${teamName}, designatedMembers = ${JSON.stringify(designatedMembers)})`);
  }
  logger.info(`Syncing team '${teamName}' for organization ${org}`);
  var team = await wrap.addTeam(org, teamName);
  // set team to private
  await wrap.editTeam(org, teamName, { privacy: 'secret' });
  var members = await wrap.getTeamMembers(org, team);

  logger.silly(`${teamName} members: ${JSON.stringify(designatedMembers)}`);
  for (var idx in designatedMembers) {
    // check if member has an expiration value set
    if (designatedMembers[idx].expiration !== undefined) {
      var expirationDate = new Date(designatedMembers[idx].expiration);
      // check if the expiration value is valid and after now
      if (expirationDate.getTime() < Date.now()) {
        continue;
      }
    }
    // get the user via cached HTTP
    var userRequest = await cHttp.getRaw(designatedMembers[idx].url);
    if (userRequest.response !== undefined && userRequest.response.data === 'User not found.') {
      logger.error(`User '${designatedMembers[idx].name}' had no associated data on Eclipse API`);
      continue;
    } else if (userRequest.status === API_MISSING_STATUS) {
      logger.error(`No user data could be retrieved for ${designatedMembers[idx].url}`);
      continue;
    } else if (userRequest.status !== API_OK_STATUS) {
      logger.error(`Error while fetching data for ${designatedMembers[idx].url}, ending all processing`);
      process.exit(EXIT_ERROR_STATE);
    }
    var user = userRequest.data;
    // check if github handle is null or empty
    if (!user.github_handle || user.github_handle.trim() === '') {
      logger.verbose(`User '${designatedMembers[idx].name}' has no associated GitHub username, skipping`);
      continue;
    }

    // invite user to team
    await wrap.inviteUserToTeam(org, teamName, user.github_handle);
    if (members !== undefined) {
      // remove just the user that matches the username
      members = members.filter(e => e.login.localeCompare(user.github_handle, undefined, { sensitivity: 'base' }));
    }
  }

  logger.silly(`Leftover members: ${JSON.stringify(members)}`);
  // Commented out until Eclipse API endpoint exists to get user for github
  // handle
  if (members !== undefined) {
    // for each left over member, check if its a bot
    for (var i = 0; i < members.length; i++) {
      // bot check before deletion, skipping if user is bot
      var isBot = isUserBot(members[i].login, project);
      if (!isBot) {
        if (argv.D !== true) {
          logger.info(`Removing '${members[i].login}' from team '${teamName}'`);
          await wrap.removeUserFromTeam(org, teamName, members[i].login);
        } else {
          logger.debug(`Would have deleted '${members[i].login}', but in semi-dry run mode`);
        }
      } else {
        logger.verbose(`User '${members[i].login}' from team '${teamName}' identified as a bot, skipping`);
      }
    }
  }
}

async function removeRepoExternalContributors(project, org, repo) {
  if (argv.V === true) {
    logger.debug(`Sync:removeRepoExternalContributors(project = ${JSON.stringify(project)}, org = ${org}, repo = ${repo})`);
  }
  // get the collaborators
  var collaborators = await wrap.getRepoCollaborators(org, repo);
  if (collaborators === undefined) {
    logger.error(`Error while fetching collaborators for ${org}/${repo}`);
    return false;
  }
  // check if we have collaborators to process
  if (collaborators.length === 0) {
    return false;
  }

  var projBots = bots[project.project_id];
  for (var collabIdx in collaborators) {
    var uname = collaborators[collabIdx].login;
    // skip webmaster
    if (uname === 'eclipsewebmaster') {
      continue;
    }

    // get the bots for the current project
    if (projBots !== undefined && projBots.indexOf(uname) !== -1) {
      logger.verbose(`Keeping ${uname} as it was detected to be a bot for ${org}/${repo}`);
      continue;
    }

    // get the current users profile
    var url = `https://api.eclipse.org/github/profile/${uname}`;
    var r = await axios.get(url).then(result => {
      return result.data;
    }).catch(err => logger.error(`Received error from Eclipse API querying for '${url}': ${err}`));
    // check user against list of project leads
    if (r != null) {
      var eclipseUserName = r.name;
      var isProjectLead = false;
      for (var plIdx in project['project_leads']) {
        var projectLead = project['project_leads'][plIdx];
        if (projectLead.username === eclipseUserName) {
          isProjectLead = true;
          break;
        }
      }
      if (isProjectLead) {
        logger.verbose(`User '${eclipseUserName}' is a project lead for the current repository, not removing`);
        continue;
      }
    }
    // remove collaborator if we've gotten to this point and dryrun isn't set
    if (!argv.d) {
      logger.info(`Removing user '${uname}' from collaborators on ${org}/${repo}`);
      await wrap.removeUserAsCollaborator(org, repo, uname);
    } else {
      logger.verbose(`Dry run set, would have removing user '${uname}' from collaborators on ${org}/${repo}`);
    }
  }
  return true;
}


async function removeOrgExternalContributors(projects, org) {
  if (argv.V === true) {
    logger.debug(`Sync:removeOrgExternalContributors(projects = ${JSON.stringify(projects)}, org = ${org})`);
  }
  // get the collaborators
  var collaborators = await wrap.getOrgCollaborators(org);
  if (collaborators === undefined) {
    logger.error(`Error while fetching collaborators for ${org}`);
    return;
  }
  // check if we have collaborators to process
  if (collaborators.length === 0) {
    return;
  }
  // check each of the collaborators, removing them if they arent a bot for a
  // project in the org
  for (var collabIdx in collaborators) {
    var uname = collaborators[collabIdx].login;
    logger.verbose(`Checking collaborator '${uname}'...`);

    var isBot = false;
    var botKeys = Object.keys(bots);
    for (var botIdx in botKeys) {
      var botList = bots[botKeys[botIdx]];
      // check if the current user is in the current key-values list
      if (botList.indexOf(uname) !== -1) {
        logger.verbose(`Found user '${uname}' in bot list for project '${botKeys[botIdx]}', checking organizations`);
        // if we can determine that this user could be a bot, check that its
        // valid for current org
        for (var pIdx in projects) {
          var project = projects[pIdx];
          // check if our project ID is the ID associated with bot
          // and if the project has repositories within the given org
          if (project.project_id === botKeys[botIdx] && project.pp_orgs.indexOf(org) !== -1) {
            isBot = true;
            logger.verbose(`Discovered bot account for '${botKeys[botIdx]}' in org ${org}`);
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
    if (isBot) {
      logger.verbose(`Keeping '${uname}' as it was detected to be a bot for org '${org}'`);
      continue;
    }

    // remove collaborator if we've gotten to this point and dryrun isn't set
    if (!argv.d) {
      logger.info(`Removing user '${uname}' from collaborators on org '${org}'`);
      await wrap.removeUserAsOutsideCollaborator(org, uname);
    } else {
      logger.verbose(`Dry run set, would have removing user '${uname}' from collaborators on ${org}`);
    }
  }
}

function isUserBot(uname, project) {
  if (project !== undefined) {
    var botList = bots[project.project_id];
    // check if the current user is in the current key-values list for project
    if (botList && botList.indexOf(uname) !== -1) {
      logger.info(`Found user '${uname}' in bot list for project '${project.project_id}'`);
      return true;
    }
  }
  return false;
}
