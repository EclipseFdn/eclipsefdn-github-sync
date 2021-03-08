/*! **************************************************************
 Copyright (C) 2021 Eclipse Foundation, Inc.

 This program and the accompanying materials are made
 available under the terms of the Eclipse Public License 2.0
 which is available at https://www.eclipse.org/legal/epl-2.0/

  Contributors:
    Martin Lowe <martin.lowe@eclipse-foundation.org>

 SPDX-License-Identifier: EPL-2.0
**************************************************************** */

// set up yargs command line parsing
var argv = require('yargs')
  .usage('Usage: $0 [options]')
  .example('$0', '')
  .option('a', {
    alias: 'all',
    description: 'Gets all bugs open and closed related to the given product/components',
    boolean: true,
    default: false,
  })
  .option('d', {
    alias: 'dryrun',
    description: 'Runs script as dry run, not writing any changes to API',
    boolean: true,
  })
  .option('V', {
    alias: 'verbose',
    description: 'Sets the script to run in verbose mode',
    count: true,
  })
  .option('H', {
    alias: 'host',
    description: 'The Gitlab host target for the migration. This allows for testing and staging migrations for use in development '
      + 'and dry runs.',
    default: 'http://gitlab.eclipse.org/',
  })
  .option('b', {
    alias: 'bugzillaHost',
    description: 'BugZilla host base URL, should lead to homepage of the BugZilla instance.',
    default: 'https://bugs.eclipse.org/bugs/',
  })
  .option('p', {
    alias: 'provider',
    description: 'The OAuth provider name set in GitLab for the Eclipse Accounts binding',
    default: 'oauth2_generic',
  })
  .option('r', {
    alias: 'resolution',
    description: 'The resolution to set for migrated Bugzilla issues within bugzilla',
    defaultValue:'MOVED',
  })
  .option('s', {
    alias: 'secretLocation',
    description: 'The location of the files containing API access tokens and secure configurations containing keys',
  })
  .option('S', {
    alias: 'status',
    description: 'The status to set for migrated Bugzilla issues within bugzilla',
    defaultValue:'RESOLVED',
  })
  .option('c', {
    alias: 'component',
    description: 'The Bugzilla component to search in for bugs',
  })
  .option('P', {
    alias: 'product',
    description: 'The Bugzilla product to search in for bugs',
  })
  .option('t', {
    alias: 'targetProject',
    description: 'The target project ID in Gitlab to migrate to. This project should be visible and accessible to the public.',
    required: true,
  })
  .help('h')
  .alias('h', 'help')
  .version('0.1')
  .alias('v', 'version')
  .epilog('Copyright 2019 Eclipse Foundation inc.')
  .argv;

const MAX_FILE_SIZE_IN_KB = 100000;
const BASE_64_FILE_SIZE_RATIO = 0.75;

const { GitlabWrapper } = require('./GitlabWrapper.js');
const EclipseAPI = require('../EclipseAPI.js');
const { SecretReader, getBaseConfig } = require('../SecretReader.js');
const { BugzillaClient } = require('../bz/client.js');

// matches hashes followed by a number (used as part to fix comments from BZ)
const HASH_MATCHING_REGEX = /(\s?)#(.)/g;
const HASH_MATCHING_REPLACEMENT = '$1# $2';

let bugzilla, gitlab, eclipse;
let userCache = {
  ef: {},
};

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
  // get all of the required secrets
  var reader = new SecretReader(settings);
  var accessToken = reader.readSecret('gl-access-token');
  var eclipseConfig = reader.readSecret('eclipse-oauth-config');
  var bzToken = reader.readSecret('bz-access-token');
  if (accessToken === null || eclipseConfig === null || bzToken === null) {
    console.log('One or more secret could not be loaded, ending processing');
  } else {
    run(accessToken, eclipseConfig, bzToken);
  }
}

async function run(accessToken, eclipseConfig, bzToken) {
  // set up api access needed for 3 systems
  eclipse = new EclipseAPI(JSON.parse(eclipseConfig));
  gitlab = new GitlabWrapper(accessToken, argv.H, argv.p, eclipse);
  bugzilla = new BugzillaClient(argv.b, bzToken);
  // set the verbosity in each of the API wrappers
  if (argv.V > 0) {
    eclipse.verbose = argv.V;
    gitlab.verbose = argv.V;
    bugzilla.verbose = argv.V;
  }
  gitlab.dryRun = argv.d;
  bugzilla.dryRun = argv.d;

  // get all bugs for current product + components
  console.log(`Fetching bugs associated with product '${argv.P}' and component '${argv.c}'`);
  let filter = {
    include_fields: 'id,summary,creator,status,cc,creation_time,assigned_to',
  };
  // check if we should pull in all issues, or only open issues
  if (!argv.a) {
    // advanced query lang, looks for statuses that aren't closed or resolved
    filter.f1 = 'bug_status';
    filter.o1 = 'nowordssubstr';
    filter.v1 = 'RESOLVED,CLOSED,VERIFIED';
  } else {
    console.log('All flag included, fetching all issues, open and closed');
  }
  let bugs = await bugzilla.getBugs(argv.P, argv.c, filter);
  console.log(`Found ${bugs.length} to migrate to project with ID ${argv.t}`);
  try {
    // set the project to not notify users of updates
    console.log('Disabling email notifications during migration');
    await gitlab.editProject(argv.t, { emails_disabled: true });
    for (let i in bugs) {
      let bug = bugs[i];
      let comments = await bugzilla.getCommentsForBug(bug.id);
      if (comments === undefined) {
        console.log(`Did not find any comments to migrate for issue ${bug.id}`);
        continue;
      }
      await processBZIssue(bug, comments);
    }
  } catch (err) {
    console.log('Error while processing issues');
    console.error(err);
  }
  // reenable emails for the project once finished migration
  console.log('Reenabling email notifications after migration');
  await gitlab.editProject(argv.t, { emails_disabled: false });
}

async function processBZIssue(bug, comments) {
  let issue = {};
  console.log(`Migrating comments for issue ${bug.id}`);
  for (let k in comments) {
    let comment = comments[k];
    // get user and gitlab wrap for the user
    var commenter = await getCachedUser(comment.creator);
    var sudo = await gitlab.getImpersonatedWrapper(commenter.name);

    // check if there is an attachment associated with current comment and handle it
    let uploadedFile = await uploadFile(comment);
    // first comment should be issue description, so treat it differently
    if (k === '0') {
      console.log(`Creating base issue for bug ${bug.id} with comment ${comment.id}`);
      // create the issue in their name
      issue = await sudo.createIssue(argv.t, bug.summary, getCommentText(bug, comment, uploadedFile), comment.creation_time);
      if (issue === undefined || issue === null) {
        console.log(`Could not create issue from BZ with ID ${bug.id}`);
        break;
      }
    } else {
      console.log(`Migrating comment by ${comment.creator} at ${comment.creation_time}`);
      let glComment = await sudo.createIssueComment(argv.t, issue.iid, getCommentText(bug, comment, uploadedFile), comment.creation_time);
      if (glComment === undefined) {
        console.log(`Could not migrate comment #${comment.count} for issue ${bug.id}`);
        continue;
      }
    }
  }
  // if we are importing closed issues, check if the current issue to see if its closed and close the GL issue
  if (issue !== undefined && issue !== null && (bug.status === 'RESOLVED' || bug.status === 'CLOSED' || bug.stats === 'VERIFIED')) {
    let closedIssue = await gitlab.editIssue(argv.t, issue.iid, {
      state_event: 'close',
    });
    console.log(`Closed issue ${closedIssue.id}`);
  }
  // close the BZ issue fter migration
  let bugStatus = await bugzilla.migrateIssue(bug.id, argv.t, issue.web_url, argv.S, argv.r);
  if (bugStatus !== undefined) {
    console.log(`Bug ${bug.id} migrated successfully to Gitlab`);
  } else {
    console.log(`Could not close bug ${bug.id}`);
  }
}

async function uploadFile(comment) {
  // check if there is a file to attach to the comment/issue
  if (comment.attachment_id !== undefined && comment.attachment_id !== null) {
    console.log(`Found attachment linked to comment ${comment.attachment_id}, fetching!`);
    let attachment = await bugzilla.getAttachment(comment.attachment_id);
    // approximate size of file based on base64 encoding
    // This seems to be the same size on both sides (https://bugs.eclipse.org/bugs/show_bug.cgi?id=415041) so this should be safe
    // already, but better check than waste network time on too large files
    let sizeInKB = attachment.data.length * BASE_64_FILE_SIZE_RATIO;
    if (sizeInKB > MAX_FILE_SIZE_IN_KB) {
      console.log(`Attachment with ID ${comment.attachment_id} is greater than the allowed file size (~ ${sizeInKB}KB), not attaching`);
    } else {
      console.log(`Uploading attachment linked to comment ${comment.attachment_id} with name ${attachment.file_name}`);
      try {
        return await gitlab.uploadIssueFile(argv.t, attachment.data, attachment.file_name);
      } catch (err) {
        console.log(err);
        console.log(`Could not upload file ${attachment.file_name} associated to comment ${comment.id}`);
      }
    }
  }
}

function getCommentText(bug, comment, attachment) {
  console.log(comment.text);
  let formattedText = comment.text;
  if (formattedText !== undefined) {
    // replace number formats that create bad issue links with separated text
    formattedText = formattedText.replace(HASH_MATCHING_REGEX, HASH_MATCHING_REPLACEMENT);
  }
  return `_Originally posted: [${comment.time} on ${bug.id}](${getCommentLocation(bug, comment)})_\n\n`
    + (attachment === undefined ? formattedText : attachment.markdown + '\n' + formattedText);
}

function getCommentLocation(bug, comment) {
  let path = `show_bug.cgi?id=${bug.id}#c${comment.count}`;
  return argv.b.endsWith('/') ? argv.b + path : argv.b + '/' + path;
}

// Cache users to reduce calls to Eclipse API for users that won't change and be called multiple times
async function getCachedUser(mail) {
  if (argv.V > 1) {
    console.log(`Migration:getCachedUser(mail = ${mail})`);
  }
  if (userCache['ef'][mail] === undefined) {
    let user = await eclipse.eclipseUserByEmail(mail);
    // have a backup/dummy user
    if (user === undefined || user === null) {
      user = {
        name: 'malowe',
      };
    }
    if (Array.isArray(user)) {
      userCache['ef'][mail] = user[0];
    } else {
      userCache['ef'][mail] = user;
    }
  }
  // create a deep copy
  if (argv.V > 1) {
    console.log('Returning following user:');
    console.log(userCache['ef'][mail]);
  }
  return JSON.parse(JSON.stringify(userCache['ef'][mail]));
}
