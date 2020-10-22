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
// set up yargs command line parsing
var argv = require('yargs')
  .usage('Usage: $0 [options]')
  .example('$0', '')
  .option('V', {
    alias: 'verbose',
    description: 'Sets the script to run in verbose mode',
    boolean: true,
  })
  .option('o', {
    alias: 'org',
    description: 'The org to generate a member report for',
    required: true,
  })
  .help('h')
  .alias('h', 'help')
  .version('0.1')
  .alias('v', 'version')
  .epilog('Copyright 2019 Eclipse Foundation inc.')
  .argv;

const MB_IN_BYTES = 1024;
const DEFAULT_WAIT_PERIOD_IN_MS = 500;
const SPLICE_CURRENT_ENTRY_ONLY = 1;
const SUBSTRING_SECOND_LAST_CHARACTER_TARGET = 2;

// custom wrappers
const Wrapper = require('../GitWrapper.js');
const CachedHttp = require('../HttpWrapper.js');
const EclipseAPI = require('../EclipseAPI.js');
const axios = require('axios');
var readline = require('readline');

// create global placeholder for wrapper
var wrap;
var cHttp;
var eclipseApi;

// thread sleeping to prevent abuse of API
var sab = new SharedArrayBuffer(MB_IN_BYTES);
var int32 = new Int32Array(sab);
const waitTimeInMS = DEFAULT_WAIT_PERIOD_IN_MS;

// read in secret from command line
var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
rl.question('Please enter your GitHub access token: ', answer => acceptInput(answer));

// best attempt at basic input checking
function acceptInput(answer) {
  var secret = answer.trim();
  if (!secret || secret.length === 0) {
    console.log('A token is required to run sync functionality, please try again');
    return rl.question('Please enter your GitHub access token: ', answer => acceptInput(answer));
  }

  rl.close();
  run(secret);
}

async function run(secret) {
  if (secret === undefined || secret === '') {
    console.log('Could not fetch API secret, exiting');
    return;
  }

  // build wrapper
  wrap = new Wrapper(secret);
  wrap.setDryRun(argv.d);

  cHttp = new CachedHttp();
  eclipseApi = new EclipseAPI();

  // get eclipse api data
  var data = await mapRepoToUsers(await eclipseApi.eclipseAPI('?github_only=1'), argv.o);
  var remaining = [];
  console.log(`Getting teams of org '${argv.o}'`);
  // get all teams for the current organization
  var ts = await wrap.getTeamsForOrg(argv.o);
  for (var idx in ts) {
    var team = ts[idx];
    console.log(`Starting processing: ${team.slug}`);
    // get the members for the current team
    var members = await wrap.getTeamMembers(argv.o, team);
    if (members === undefined) {
      continue;
    }

    // create secondary list to modify while looping
    var s = [];
    for (var member in members) {
      s.push(members[member].login.toLowerCase());
    }
    console.log(`Found ${s.length} members to process:\n\t${JSON.stringify(s)}`);

    // for each of the repos for team, remove users who have access from
    // secondary list
    s = await removeTrackedUsers(s, data, team);
    var rows = await generateDataRows(s, team.slug, argv.o);
    for (var rowIdx in rows) {
      remaining.push(rows[rowIdx]);
    }

    // generate rows for untracked invited members
    var invitees = await wrap.getInvitedMembers(argv.o, team);
    if (invitees !== null && invitees.length > 0) {
      s = [];
      for (var invitee in invitees) {
        s.push(invitees[invitee].login.toLowerCase());
      }
      console.log(`Found ${s.length} invited members to process:\n\t${JSON.stringify(s)}`);

      // remove tracked members whose invites are still pending
      s = await removeTrackedUsers(s, data, team);
      // generate rows with invited set to true
      rows = await generateDataRows(s, team.slug, argv.o, true);
      for (rowIdx in rows) {
        remaining.push(rows[rowIdx]);
      }
    }
    console.log(`Done processing: ${team.slug}`);
    Atomics.wait(int32, 0, 0, waitTimeInMS);
  }
  console.log('GITHUB_HANDLE, ECLIPSE_UNAME, TEAM, ORGANIZATION, INVITED');
  for (var i in remaining) {
    var currRow = remaining[i];
    console.log(`${currRow['github']},${currRow['uname']},${currRow['team']},${currRow['org']},${currRow['invited']}`);
  }
  cHttp.close();
}

async function removeTrackedUsers(currMembers, trackedMembers, team) {
  console.log(`Removing tracked users from current users list for team '${team.slug}'`);
  // for each of the repos for team, remove users who have access from output
  // list
  var rs = await wrap.getReposForTeam(team);
  console.log(`Current list for team '${team.slug}': ${currMembers}`);
  for (var repoIdx in rs) {
    var repoName = rs[repoIdx]['name'];
    console.log(`Checking repo '${repoName}'`);
    var allowedUsers = trackedMembers[repoName];
    if (allowedUsers === undefined) {
      continue;
    }
    // iterate over users
    for (var userIdx in allowedUsers) {
      var username = allowedUsers[userIdx];
      // get index of the allowed user if it exists in the team
      var teamUserIdx = currMembers.indexOf(username);
      // remove user if it was found
      if (teamUserIdx > -1) {
        console.log(`Found tracked user ${currMembers[teamUserIdx]}, removing!`);
        currMembers.splice(teamUserIdx, SPLICE_CURRENT_ENTRY_ONLY);
        console.log(`New list: ${currMembers}`);
      }
    }
  }
  return currMembers;
}

async function generateDataRows(currMembers, teamName, org, invited = false) {
  var out = [];
  for (var memberIdx in currMembers) {
    console.log(`Generating row for user ${currMembers[memberIdx]}`);
    // query the Eclipse API to check for corresponding user
    var url = `https://api.eclipse.org/github/profile/${currMembers[memberIdx]}`;
    var result = await axios.get(url).then(result => {
      return result.data;
    }).catch(err => console.log(`Received error from Eclipse API querying for : ${err}`));
    out.push({
      github: currMembers[memberIdx],
      team: teamName,
      org: org,
      uname: !result || result.name === undefined ? '' : result.name,
      invited: invited,
    });
  }
  return out;
}

async function mapRepoToUsers(data, org) {
  // map project repos to the project id
  var out = {};
  // for both committers + contributors, get repo => user mapping
  var groupings = ['committers', 'contributors'];
  for (var j in groupings) {
    var grouping = groupings[j];
    for (var k in data) {
      var proj = data[k];
      console.log(`Pre-processing project ${proj.project_id}`);

      // get the repos for each of the projects
      var repos = getReposFromProject(proj, org);
      // stop processing if we don't have any valid repos
      if (repos.length === 0) {
        console.log(`No repositories found for grouping '${grouping}' in project '${proj.project_id}'`);
        continue;
      }
      // get users for valid repos
      for (var l in proj[grouping]) {
        // get the user via cached HTTP
        var eclipseUser = await cHttp.getData(proj[grouping][l]['url']);
        if (argv.v) {
          console.log(`Getting user @ url ${JSON.stringify(eclipseUser)}`);
        }
        if (eclipseUser === undefined) {
          console.log(`User '${proj[grouping][l].username}' had no associated data on Eclipse API`);
          continue;
        }
        if (!eclipseUser['github_handle'] || eclipseUser['github_handle'].trim() === '') {
          console.log(`User '${proj[grouping][l].username}' has no associated GitHub username, skipping`);
          continue;
        }

        // get the handle
        var githubHandle = eclipseUser['github_handle'].toLowerCase();
        for (var m in repos) {
          // get the list of users who have access for the repo
          console.log(`Handle: ${githubHandle}, repo ${repos[m]}`);
          var arr = out[repos[m]];
          if (arr === undefined) {
            arr = [];
          }
          // push the array and set it back
          arr.push(githubHandle);
          out[repos[m]] = arr;
        }
      }
    }
  }
  return out;
}

function getReposFromProject(proj, org) {
  var repos = [];
  for (var l in proj['github_repos']) {
    // get repo url for current project
    var gitUrl = proj['github_repos'][l]['url'];
    var match = /\/([^/]*)\/([^/]*\/?)$/.exec(gitUrl);
    if (match === null) {
      continue;
    }

    // get the org + repo from the repo URL
    var orgName = match[1];
    if (orgName !== org) {
      console.log(`Skipping repo URL as its org (${orgName}) doesn't match expected org of '${org}': '${gitUrl}'`);
      continue;
    }
    var repoName = match[2];
    if (repoName.endsWith('/')) {
      var repoNameSlashIdx = repoName.length - SUBSTRING_SECOND_LAST_CHARACTER_TARGET;
      repoName = repoName.substring(0, repoNameSlashIdx);
    }

    // retain the repo name
    repos.push(repoName);
  }
  return repos;
}
