const Wrapper = require('../GitWrapper.js');
const { Gitlab } = require('gitlab');

const { SecretReader, getBaseConfig } = require('../SecretReader.js');
const { ImportRunner } = require('./ImportRunner');

var argv = require('yargs')
  .usage('Usage: $0 [options]')
  .example('$0', '')
  .option('d', {
    alias: 'dryrun',
    description:
      'Runs script as dry run, not making any deletions in the Gitlab instance',
    boolean: true,
  })
  .option('t', {
    alias: 'target',
    description: 'The project ID that should be targeted for this sync run',
  })
  .option('e', {
    alias: 'email',
    description: 'The email inbox to send report to',
  })
  .option('m', {
    alias: 'mail',
    description:
      'Whether mail should be sent as part of the reporting at the end of the import process',
    boolean: true,
  })
  .option('o', {
    alias: 'organization',
    description: 'The name of the organization that should be backed up',
  })
  .option('H', {
    alias: 'host',
    description:
      'The host of the Gitlab instance to target for the import process',
  })
  .option('s', {
    alias: 'secretLocation',
    description:
      'The location of the access-token file containing an API access token',
  })
  .help('h')
  .alias('h', 'help')
  .version('0.1')
  .alias('v', 'version')
  .epilog('Copyright 2019 Eclipse Foundation inc.').argv;

function _prepareSecret() {
  // retrieve the secret API token
  var accessToken, githubToken;
  // retrieve the secret API file root if set
  var settings = getBaseConfig();
  if (argv.s !== undefined) {
    settings.root = argv.s;
  }
  var reader = new SecretReader(settings);
  var data = reader.readSecret('access-token');
  if (data !== null) {
    accessToken = data.trim();
    // retrieve the Eclipse API token (needed for emails)
    data = reader.readSecret('github-access-token');
    if (data !== null) {
      githubToken = data.trim();
      run(accessToken, githubToken);
    } else {
      console.log('Could not find the Github access token, exiting');
    }
  } else {
    console.log('Could not find the GitLab access token, exiting');
  }
}

async function run(t1, t2) {
  // create wrappers for import run
  let gl = new Gitlab({
    host: argv.H,
    token: t1,
  });
  let wrapper = new Wrapper(t2, true);
  // prep the import runner
  let imp = new ImportRunner();
  imp.githubAccessToken = t2;
  imp.gitlabAccessToken = t1;
  imp.gitlab = gl;
  imp.github = wrapper;

  // run the import process
  await imp.runBackup({
    target: argv.t,
    source: argv.o,
    email: argv.e,
    host: argv.H,
    flags: {
      noDelete: argv.d,
      sendMail: argv.m,
    },
  });
}
_prepareSecret();
