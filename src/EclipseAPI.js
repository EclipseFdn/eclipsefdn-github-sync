/*! **************************************************************
 Copyright (C) 2021 Eclipse Foundation, Inc.

 This program and the accompanying materials are made
 available under the terms of the Eclipse Public License 2.0
 which is available at https://www.eclipse.org/legal/epl-2.0/

  Contributors:
    Martin Lowe <martin.lowe@eclipse-foundation.org>

 SPDX-License-Identifier: EPL-2.0
**************************************************************** */

const HOUR_IN_SECONDS = 3600;
const EXIT_ERROR_STATE = 1;

const axios = require('axios');
const parse = require('parse-link-header');
const { ClientCredentials } = require('simple-oauth2');

module.exports = class EclipseAPI {
  #config;
  #client;
  #accessToken;
  #verbose = false;
  set verbose(val) {
    if (typeof val === 'boolean') {
      this.#verbose = val;
    }
  }
  get verbose() {
    return this.#verbose;
  }
  #testMode = false;
  get testMode() {
    return this.#testMode;
  }
  set testMode(testMode) {
    if (typeof testMode === 'boolean') {
      this.#testMode = testMode;
    }
  }

  constructor(config = {}) {
    this.#config = config;
    // if we have oauth config, intialize access token
    if (this.#config.oauth !== undefined) {
      const oauth = {
        client: {
          id: this.#config.oauth.client_id,
          secret: this.#config.oauth.client_secret,
        },
        auth: {
          tokenHost: this.#config.oauth.endpoint,
          tokenPath: '/oauth2/token',
          authorizePath: '/oauth2/authorize',
        },
      };
      this.#client = new ClientCredentials(oauth);
    }
  }

  async eclipseAPI(queryStringParams = '', paginate = true) {
    if (this.#verbose) {
      console.log(`EclipseAPI:eclipseAPI(queryStringParams = ${queryStringParams}, paginate = ${paginate})`);
    }
    // if test mode is enabled, return data that doesn't impact production
    if (this.#testMode) {
      return [{
        project_id: 'spider.pig',
        name: 'Spider pig does what a spider pig does',
        summary: 'Can he fly? No, hes a pig. Look out, here comes the spider pig',
        logo: '',
        tags: ['simpsons', 'doh', 'spider pig'],
        github_repos: [{
          url: 'https://github.com/eclipsefdn-webdev/spider-pig',
        }],
        contributors: [],
        committers: [{
          username: 'malowe',
          url: 'https://api.eclipse.org/account/profile/malowe',
        }, {
          username: 'epoirier',
          url: 'https://api.eclipse.org/account/profile/epoirier',
        }],
        project_leads: [{
          username: 'malowe',
          url: 'https://api.eclipse.org/account/profile/malowe',
        }, {
          username: 'cguindon',
          url: 'https://api.eclipse.org/account/profile/cguindon',
        }],
        working_groups: [{
          name: 'Cloud Development Tools',
          id: 'cloud-development-tools',
        }],
        spec_project_working_group: [],
        state: 'Regular',
      }];
    }

    var hasMore = true;
    var result = [];
    var data = [];
    // add timestamp to url to avoid browser caching
    var url = 'https://projects.eclipse.org/api/projects' + queryStringParams;
    // loop through all available users, and add them to a list to be returned
    do {
      console.log('Loading next page...');
      // get the current page of results, incrementing page count after call
      result = await axios.get(url).then(r => {
        // return the data to the user
        var links = parse(r.headers.link);
        if (links.self.url === links.last.url) {
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
    } while (hasMore && paginate);
    return data;
  }

  postprocessEclipseData(data, param) {
    if (this.#verbose) {
      console.log(`EclipseAPI:postprocessEclipseData(data = ${JSON.stringify(data)}, param = ${param})`);
    }
    for (var key in data) {
      var project = data[key];
      // add post processing fields
      project.pp_repos = [];
      project.pp_orgs = [];
      var repos = project[param];
      if (repos.length === 0) {
        delete data[key];
        continue;
      }
      for (var idx in repos) {
        var repo = repos[idx];
        var repoUrl = repo.url;

        console.log(`Checking repo URL: ${repoUrl}`);
        // strip the repo url to get the org + repo
        var match = /.*\/([^/]+)\/([^/]+)\/?$/.exec(repoUrl);
        // check to make sure we got a match
        if (match === null) {
          console.log(`No match for URL ${repoUrl}`);
          continue;
        }

        // get the org + repo from the repo URL
        var org = match[1];
        var repoName = match[2];
        // set the computed data back to the objects
        repo.org = org;
        repo.repo = repoName;
        if (project.pp_orgs.indexOf(org) === -1) {
          console.log(`Found new match, registered org=${org}`);
          project.pp_orgs.push(org);
        }
        if (project.pp_repos.indexOf(repoName) === -1) {
          console.log(`Found match, registered repo=${repoName}`);
          project.pp_repos.push(repoName);
        }
      }
      // set back to ensure properly set
      data[key] = project;
    }
    return data;
  }

  async eclipseUser(username) {
    if (this.#verbose) {
      console.log(`EclipseAPI:eclipseUser(username = ${username})`);
    }
    return await axios.get('https://api.eclipse.org/account/profile/' + username, {
      headers: {
        Authorization: `Bearer ${await this._getAccessToken()}`,
      },
    })
      .then(result => result.data)
      .catch(err => console.log(err));
  }

  async eclipseUserByEmail(email) {
    if (this.#verbose) {
      console.log(`EclipseAPI:eclipseUserByEmail(email = ${email})`);
    }
    return await axios.get('https://api.eclipse.org/account/profile?mail=' + email, {
      headers: {
        Authorization: `Bearer ${await this._getAccessToken()}`,
      },
    })
      .then(result => result.data)
      .catch(err => console.log(err));
  }

  async eclipseBots() {
    if (this.#verbose) {
      console.log('EclipseAPI:eclipseBots()');
    }
    var botsRaw = await axios.get('https://api.eclipse.org/bots')
      .then(result => result.data)
      .catch(err => console.log(err));
    if (botsRaw === undefined || botsRaw.length <= 0) {
      console.log('Could not retrieve bots from API');
      process.exit(EXIT_ERROR_STATE);
    }
    return botsRaw;
  }

  processBots(botsRaw, site = 'github.com') {
    if (this.#verbose) {
      console.log(`EclipseAPI:processBots(botsRaw = ${JSON.stringify(botsRaw)}, site = ${site})`);
    }
    var botMap = {};
    for (var botIdx in botsRaw) {
      var bot = botsRaw[botIdx];
      if (bot[site] === undefined) continue;

      var projBots = botMap[bot['projectId']];
      if (projBots === undefined) {
        projBots = [];
      }
      projBots.push(bot[site]['username']);
      botMap[bot['projectId']] = projBots;
    }
    return botMap;
  }

  async _getAccessToken() {
    if (this.#accessToken === undefined || this.#accessToken.expired(this.#config.oauth.timeout | HOUR_IN_SECONDS)) {
      try {
        this.#accessToken = await this.#client.getToken({
          scope: this.#config.oauth.scope,
        });
      } catch (error) {
        console.log('Access Token error', error);
        process.exit(EXIT_ERROR_STATE);
      }
      return this.#accessToken.token.access_token;
    }
  }
};

