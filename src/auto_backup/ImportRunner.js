const axios = require('axios');
const nodemailer = require('nodemailer');

// used to check if we need a leading 0 for date checks
const MONTH_INDEX_10 = 10;
/**
 * Prints a message to log outside of test mode.
 *
 * @param {Record<String,Any>} cfg the configuration object for the current run
 * @param {String} msg the message to print to log
 */
function log(cfg, msg) {
  if (!cfg || !cfg.flags || !cfg.flags.test) {
    console.log(msg);
  }
}

class ImportRunner {
  // hide tokens from external access
  #gitlabAccessToken;
  set gitlabAccessToken(value) {
    this.#gitlabAccessToken = value;
  }
  get gitlabAccessToken() {
    return null;
  }
  #githubAccessToken;
  set githubAccessToken(value) {
    this.#githubAccessToken = value;
  }
  get githubAccessToken() {
    return null;
  }

  // store wrappers in runner. Allow for easier mocking through easy access
  gitlab;
  github;

  /**
   * Runs the backup process from Github to Gitlab. This makes use of the import endpoint within Gitlab to queue an automated import of a
   * repositories code, issues, pull requests, and wiki. If these users exist within Gitlab (likely matched on email but not confirmed)
   * then users will retain ownership of issues, comments, and pull requests active within the repository.
   *
   * @param {*} config configuration for the current backup run. Assumes that multiple runs can be done concurrently using the same runner.
   */
  async runBackup(config = {
    target: '',
    source: '',
    email: '',
    host: '',
    count: 3,
    flags: {
      noDelete: false,
      sendMail: true,
    },
  }) {
    // validate runner state
    log(config, `Importing with config given: ${JSON.stringify(config)}`);
    if (!(await this.checkRunner(config))) {
      return false;
    }

    // create backup target group for this run
    let name = this.getBackupGroupName();
    if (name === undefined) {
      console.error('Could not create base group for backup process');
      this.report([], ['Could not create base group for backup process'], config.email);
    }
    let g = await this.createBackupGroup(config, name, config.target);
    if (g === undefined) {
      console.error('Could not create base group for backup process');
      this.report([], ['Could not create base group for backup process'], config.email);
    }
    // set up arrays to hold the promises, and returned messages
    let successes = [];
    let errors = [];
    let imports = [];
    // for each repo imported, track success and failure messages
    let repos = await this.getReposForOrg(config.source);
    repos.forEach(repo =>
      imports.push(this.importRepository(config, repo.id, g.full_path, config.host)
        .then(response => successes
          .push(`Successfully imported repository '${repo.name}' to ${response.data.full_name}(${response.data.id})`))
        .catch(error => errors.push(`Error importing repository '${repo.name}': ${error}`))));
    // remove old groups while imports are processing
    await this.pruneBackupGroups(g, config);

    // await the finish of the imports in case they haven't returned
    await Promise.allSettled(imports).then(() => this.report(successes, errors, config));
    return true;
  }

  /**
   * Checks the internal configurations for running imports (run-independent settings). If there is an issue with the current
   * state, the errors are logged and a report to the email inbox is attempted for the current run.
   *
   * @param {*} config configuration settings passed for current run. Passed to email client to attempt notification if possible.
   */
  async checkRunner(config) {
    let errors = [];
    if (!this.gitlab) {
      errors.push('Required API wrapper for Gitlab is missing');
    }
    if (!this.github) {
      errors.push('Required API wrapper for Github is missing');
    }
    if (!this.#githubAccessToken) {
      errors.push('Required secret for Github is missing');
    }
    if (!this.#gitlabAccessToken) {
      errors.push('Required secret for Gitlab is missing');
    }
    // if there is an issue checking the current configs, attempt to notify and fail
    if (errors.length > 0) {
      await this.report([], errors, config);
      return false;
    }
    return true;
  }

  /**
   * Creates a subgroup within a targeted group in Gitlab to contain backups. This group will inherit the permissions of
   * the parent, so if the parent is visible, this group will also be visible.
   *
   * @param {*} config the configuration for the current run for use in logging
   * @param {String} name name of the backup group to create. This should be URL friendly (lowercase, dashed)
   * @param {String} parentID the ID of the parent group to contain the backup container
   * @returns the new Gitlab group definition, or undefined if there was an error
   */
  async createBackupGroup(config, name, parentID) {
    log(config, `createBackupGroup(${name}, ${parentID})`);
    try {
      return await this.gitlab.Groups.create({
        name: name,
        path: name,
        parent_id: parentID,
      });
    } catch (e) {
      console.error(e);
    }
  }

  /**
   * Retrieves backup groups present in a given group, using the backup group name format as a template for discovering previous groups.
   * This would return all of these groups in the format from Gitlab for further processing.
   *
   * @param {*} g the parent group to search for backup groups
   */
  async getBackupGroups(g) {
    try {
      return await this.gitlab.Groups.subgroups(g.id);
    } catch (e) {
      console.error(e);
    }
  }

  /**
   * Retrieves all repository definitions for a Github Organization. The access key set in the runner should have
   * access to the repositories within, otherwise there will be errors in retrieving fully correct information.
   *
   * @param {*} org the name of the organization to retrieve in Github.
   * @returns a list of Github repository definitions, or undefined if there was an issue retrieving the repositories.
   */
  async getReposForOrg(org) {
    // get the repos for the given org
    await this.github.prefetchRepos(org);
    // get the repos for the given org in the cache
    return this.github.getDiscoveredRepos(org);
  }

  /**
   * Makes a request to the designated Gitlab server to import a Github repository. This request is authenticated
   * and actioned using the internal access tokens.
   *
   * @param {*} repoID the ID of the Github repo to import
   * @param {*} targetNamespace the path to the namespace that will contain the imported repository
   * @param {*} host the host of the Gitlab instance that will import the repository.
   * @returns {Promise<>}a promise that returns the HTTP request response for the import request.
   */
  importRepository(config, repoID, targetNamespace, host = 'https://gitlab.eclipse.org') {
    log(config, `importRepository(${repoID},${targetNamespace},${host})`);
    // this call does not exist in the Gitlab lib, so it must be implemented
    try {
      return axios.post(`${host}/api/v4/import/github`, {
        personal_access_token: this.#githubAccessToken,
        target_namespace: targetNamespace,
        repo_id: repoID,
      },
      {
        headers: {
          'PRIVATE-TOKEN': this.#gitlabAccessToken,
        },
      });
    } catch (e) {
      console.error(e);
    }
  }

  /**
   * Performs the pruning operation, using the configs for the current run and the parent group retrieved earlier in the run. If
   * noDelete flag is set the process still runs, but reports to console that deletion was skipped for logging purposes.
   *
   * @param {*} parent the parent group for the backup groups
   * @param {*} config configuration object for the current run.
   */
  async pruneBackupGroups(parent, config) {
    let groups = await this.getBackupGroups(parent);
    // return if there are no groups to process
    if (groups === undefined || groups === null) {
      return false;
    }
    // only process groups with the pattern of backup-\d+ so that we can have static backups if necessary
    groups.filter(a => a.name.match(/^backup-\d+$/)).sort((a, b) => (b.name).localeCompare(a.name));
    let count = 0;
    for (let gIdx in groups) {
      count++;
      let g = groups[gIdx];
      log(config, `Processing group ${g.name} for potential pruning`);
      // if count is less than the configured group count or the first item, skip (never delete the newest item)
      if (count < config.count || count === 1) {
        log(config, `Skipping group ${g.name} for pruning`);
        continue;
      }
      if (!config.flags.noDelete) {
        // attempt to delete the group
        try {
          await this.gitlab.Groups.remove(g.id);
        } catch (e) {
          console.error(e);
        }
      } else {
        log(config, `Would have attempted to delete ${g.name}, but noDelete flag is set`);
      }
    }
  }

  /**
   * Report the errors and successes for the current run. This will also prep the email transport that will be an external mechanism
   * for reporting results of the import process. This email can be disabled with the config flag sendMail = FALSE. No matter the
   * state of email reporting, this method will always additionally post to the console for central access to results.
   *
   * @param {*} successes list of success messages for the current run
   * @param {*} errors list of error messages for the current run
   * @param {*} config the configuration object for the current run.
   */
  async report(successes = [], errors = [], config = {}) {
    // check if the script should attempt to send mail
    if (config.flags && config.flags.sendMail) {
      // set up the mail client
      let transport = nodemailer.createTransport({
        host: 'mail.eclipse.org',
        port: 25,
      });
      // check if the email config is valid
      await transport.verify(function(error, success) {
        if (error) {
          log(config, error);
        } else {
          // send the email with the validated transport
          this.sendMail(transport, successes, errors, config);
        }
      });
    }
    // do not spam log during test, as its not needed
    if (config.flags && config.flags.test) {
      return;
    }
    // post to the console log for the run
    log(config, 'Successes:');
    log(config, successes);
    log(config, 'Errors:');
    log(config, errors);
    log(config, 'Run complete!\n\n\n');
  }

  /**
   * Sends email message using passed transport, generating the body of the email, both in HTML and plain text format. This body is based
   * off of the success and error results that are passed in params. Information about current run (recipient, target organiazation) are
   * retrieved from the config object.
   *
   * @param {*} transport the validated email transport client to use to send the report
   * @param {*} successes list of success messages for the current run
   * @param {*} errors list of error messages for the current run
   * @param {*} config the configuration object for the current run.
   */
  async sendMail(transport, successes, errors, config) {
    // get the plain text message
    let message = `For the import of '${config.source}', there were ${
      successes ? successes.length : 0
    } successes and ${
      errors ? errors.length : 0
    } failures. See the log for more information.`;

    let html = `<h1>Backup Results</h1><p>${message}</p>`;
    // add success messages (if there are any)
    if (successes && successes.length > 0) {
      html += '<h2>Successes</h2><ul>';
      successes.forEach(success => (html += `<li>${success}</li>`));
      html += '</ul>';
    }
    // print error heading + list if there are errors present
    if (errors && errors.length > 0) {
      html += '<h2>Errors</h2><ul>';
      errors.forEach(err => (html += `<li>${err}</li>`));
      html += '</ul>';
    }

    // actually send the email.
    await transport.sendMail({
      from: 'Eclipse Webmaster <noreply@eclipse-foundation.org>',
      to: config.email,
      subject: `Backup of ${config.source} - ${new Date().toISOString()}`,
      text: message,
      html: html,
    });
  }

  /**
   * Generates the name of the backup group, adding leading 0s to properly allow sorting based on the date.
   *
   * @returns the backup date for the given date, or today if not passed.
   */
  getBackupGroupName(date = new Date()) {
    let actualDate = date === null ? new Date() : date;
    // check via duck typing
    if (typeof actualDate.getMonth !== 'function' || isNaN(actualDate.getTime())) {
      return undefined;
    }
    // create backup target group for this run
    let monthNonZeroIndexed = actualDate.getMonth() + 1;
    let formattedMonth = monthNonZeroIndexed < MONTH_INDEX_10 ? `0${monthNonZeroIndexed}` : monthNonZeroIndexed;
    let formattedDay = actualDate.getUTCDate() < MONTH_INDEX_10 ? `0${actualDate.getUTCDate()}` : actualDate.getUTCDate();

    return `backup-${actualDate.getUTCFullYear()}${formattedMonth}${formattedDay}`;
  }
}
module.exports.ImportRunner = ImportRunner;
