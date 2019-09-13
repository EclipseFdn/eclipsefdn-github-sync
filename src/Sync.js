/****************************************************************
 Copyright (C) 2019 Eclipse Foundation, Inc.
 
 This program and the accompanying materials are made
 available under the terms of the Eclipse Public License 2.0
 which is available at https://www.eclipse.org/legal/epl-2.0/
 
  Contributors:
    Martin Lowe <martin.lowe@eclipse-foundation.org>
    
 SPDX-License-Identifier: EPL-2.0
******************************************************************/

// custom wrappers
const Wrapper = require('./GitWrapper.js');
const CachedHttp = require('./HttpWrapper.js');

//set up yargs command line parsing
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
  .help('h')
  .alias('h', 'help')
  .version('0.1')
  .alias('v', 'version')
  .epilog('Copyright 2019 Eclipse Foundation inc.')
  .argv;

const axios = require('axios');
const fs = require('fs');
const parse = require('parse-link-header');
const winston = require('winston');
const { format } = require('logform');

var now = new Date();
winston.configure({
  format: winston.format.combine(  
      format.timestamp(),
      format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
    ),
  transports: [
    new winston.transports.File({ 
      filename: `logs/sync-${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDay()}.log`, 
      level: 'debug' 
      }),
    new winston.transports.Console({ level: argv.V ? 'debug' : 'error' })
  ]
});

//create global placeholder for wrapper
var wrap;
var cHttp;

//thread sleeping to prevent abuse of API
var sab = new SharedArrayBuffer(1024);
var int32 = new Int32Array(sab);
const waitTimeInMS = 1000;

_prepareSecret();

/**
 * Retrieves secret API token from system, and then starts the script via _init
 * 
 * @returns
 */
function _prepareSecret() {
  //retrieve the secret API token
  fs.readFile('/run/secrets/api-token', {encoding: 'utf-8'}, function(err,data){
     if (!err && data != undefined && data.length > 0) {
         _init(data.trim());
     } else {
         winston.error(err);
         return;
     }
  });
}

/**
 * Async as we require blocking to ensure that data is available when processing
 * starts.
 */
async function _init(secret) {
  if (secret === undefined) {
    winston.error("Could not fetch API secret, exiting");
    return;
  }
  
  wrap = new Wrapper(secret);
  wrap.setDryRun(argv.d);

  cHttp = new CachedHttp();
  /*
  var hasMore = true;
  var result = [];
  var data = [];
  var url = 'https://projects.eclipse.org/api/projects?github_only=1&';
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
  }*/
  
  var d = [{
      "project_project_id":"test.electric-boogaloo-4",
      "project_name":"Electric Boogaloo 3: The boogie strikes back",
      "project_scope":"",
      "project_url":"https://projects.eclipse.org/projects/test.electric-boogaloo",
      "github_repos":[
        "https://github.com/eclipsefdn-webdev/test-electric-boogaloo",
        "https://github.com/eclipsefdn-webdev/test-riding-lawnmower"
      ],
      "contributors":[
        {
           "url":"https://api.eclipse.org/account/profile/cguindon"
        },
        {
          "url":"https://api.eclipse.org/account/profile/malowe"
        },
      ],
      "committers":[
         {
            "url":"https://api.eclipse.org/account/profile/cguindon"
         }
      ],
      "spec_project_working_group":null
   },
   {
     "project_project_id":"dork.bork-bork",
     "project_name":"Electric Boogaloo 3: The boogie strikes back",
     "project_scope":"",
     "project_url":"https://projects.eclipse.org/projects/dork.bork-bork",
     "github_repos":[
       "https://github.com/eclipsefdn-webdev/dork-beagle",
       "https://github.com/eclipsefdn-webdev/dork-poodle"
     ],
     "contributors":[
       {
          "url":"https://api.eclipse.org/account/profile/cguindon"
       },
     ],
     "committers":[
        {
           "url":"https://api.eclipse.org/account/profile/epoirier"
        }
     ],
     "spec_project_working_group":null
  }];
  
  winston.info(`Finished preloading ${d.length} projects`);
  // start the sync operation.
  await runSync(d);
  
  // close the wrappers, persisting required cache info
  cHttp.close();
}



async function runSync(data) {
  var start = new Date();
  for (key in data) {
    var project = data[key];
    var projectID = project.project_project_id;
    var repos = project.github_repos;
    winston.debug(`Project ID: ${projectID}`);
    
    // maintain orgs used by this project
    var orgs = [];
    for (idx in repos) {
      var repoUrl = repos[idx];
      var match = /\/([^\/]*)\/([^\/]*)$/.exec(repoUrl);
      
      // get the org + repo from the repo URL
      var org = match[1];
      var repo = match[2];
      winston.debug(`Starting org=${org};repo=${repo}`);
      
      // check if we've processed this org yet, if not, then create teams and add users
      if (!orgs.includes(org)) {
        winston.debug(`Generating teams for ${org}/${repo}`);
        await processOrg(org, project);
        
        orgs.push(org);
      } 
      
      if (!argv.d) {
        // create the repo if it doesn't exist
        await wrap.addRepo(org, repo);
        
        // Ensure that the teams refer to the repo
        await wrap.addRepoToTeam(org, `${projectID}-committers`, repo, "push");
        await wrap.addRepoToTeam(org, `${projectID}-contributors`, repo);
      } else {
        winston.warn(`Dry run set, not adding repo '${repo}' for org: ${org}`);
      }
    }
  }
  // log how long it took to do this stuff
  var end = new Date();
  winston.info(`Start: ${start}, end: ${end}, calls: ${wrap.getCallCount()}`);
}

async function processOrg(org, project) {
  // prefetch teams to reduce redundant calls
  await wrap.prefetchTeams(org);
  await wrap.prefetchRepos(org);
  
  // create the teams for the current org
  if (!argv.d) {
    await updateTeam(org, project, 'contributors');
    await updateTeam(org, project, 'committers');
  } else {
    console.log('Dry run set, not adding teams for org: ' + org);
  }
}

async function updateTeam(org, project, grouping) {
  var projectID = project.project_project_id;
  var teamName = `${projectID}-${grouping}`;
  var team = await wrap.addTeam(org, teamName);
  var members = await wrap.getTeamMembers(org, teamName, team.id);
  
  winston.debug(grouping + ' members: ');
  winston.debug(members);
  for (idx in project[grouping]) {
    // get the user via cached HTTP
    var user = await cHttp.getData(project[grouping][idx].url);
    if (user === undefined) {
      winston.warn(`User '${project[grouping][idx].name}' had no associated data on Eclipse API`);
      continue;
    }
    if (user.github_handle === undefined) {
      winston.warn(`User '${project[grouping][idx].name}' has no associated GitHub username, skipping`);
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

  winston.debug('Leftover members: ');
  winston.debug(members);
  if (members != undefined) {
    for (var i = 0; i < members.length; i++) {
      await wrap.removeUserFromTeam(org, teamName, members[i].login);
    }
  }
}