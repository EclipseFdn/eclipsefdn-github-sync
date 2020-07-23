const axios = require('axios');
const parse = require('parse-link-header');
const { ClientCredentials } = require('simple-oauth2');

module.exports = class EclipseAPI {
  #config;
  #client;
  #accessToken;
  constructor(config = {}) {
    this.#config = config;
    // if we have oauth config, intialize access token
    if (this.#config.oauth !== undefined) {
      const oauth = {
        client: {
          id: this.#config.oauth.client_id,
          secret: this.#config.oauth.client_secret
        },
        auth: {
          tokenHost: this.#config.oauth.endpoint,
          tokenPath: '/oauth2/token',
          authorizePath: '/oauth2/authorize'
        }
      };
      this.#client = new ClientCredentials(oauth);
    }
  }

  async eclipseAPI() {
    var hasMore = true;
    var result = [];
    var data = [];
    // add timestamp to url to avoid browser caching
    var url = `https://projects.eclipse.org/api/projects`;
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
    return data;
  };

  postprocessEclipseData(data, param) {
    for (var key in data) {
      var project = data[key];
      // add post processing fields
      project.pp_repos = [];
      project.pp_orgs = [];
      var repos = project[param];
      if (repos.length == 0) {
        delete data[key];
        continue;
      }
      for (var idx in repos) {
        var repo = repos[idx];
        var repoUrl = repo.url;

        console.log(`Checking repo URL: ${repoUrl}`);
        // strip the repo url to get the org + repo
        var match = /.*\/([^\/]+)\/([^\/]+)\/?$/.exec(repoUrl);
        // check to make sure we got a match
        if (match == null) {
          console.log(`No match for URL ${repoUrl}`);
          continue;
        }

        // get the org + repo from the repo URL
        var org = match[1];
        var repoName = match[2];
        // set the computed data back to the objects
        repo.org = org;
        repo.repo = repoName;
        if (project.pp_orgs.indexOf(org) == -1) {
          console.log(`Found new match, registered org=${org}`);
          project.pp_orgs.push(org);
        }
        if (project.pp_repos.indexOf(repoName) == -1) {
          console.log(`Found match, registered repo=${repoName}`);
          project.pp_repos.push(repoName);
        }
      }
      // set back to ensure properly set
      data[key] = project;
    }
    return data;
  };

  async eclipseUser(username) {
    return await axios.get("https://api.eclipse.org/account/profile/" + username, {
      'headers': {
        'Authorization': `Bearer ${await this._getAccessToken()}`
      }
    })
      .then(result => result.data)
      .catch(err => console.log(err));
  };

  async eclipseBots() {
    var botsRaw = await axios.get("https://api.eclipse.org/bots")
      .then(result => result.data)
      .catch(err => console.log(err));
    if (botsRaw == undefined) {
      console.log('Could not retrieve bots from API');
      process.exit(1);
    }
    return botsRaw;
  }

  processBots(botsRaw, site = "github.com") {
    var botMap = {};
    for (var botIdx in botsRaw) {
      var bot = botsRaw[botIdx];
      if (bot[site] == undefined) continue;

      var projBots = botMap[bot["projectId"]];
      if (projBots == undefined) {
        projBots = [];
      }
      projBots.push(bot[site]["username"]);
      botMap[bot["projectId"]] = projBots;
    }
    return botMap;
  };

  async _getAccessToken() {
    if (this.#accessToken === undefined || this.#accessToken.expired(this.#config.oauth.timeout | 3600)) {
      try {
        this.#accessToken = await this.#client.getToken({
          scope: this.#config.oauth.scope,
        });
      } catch (error) {
        console.log('Access Token error', error);
        exit(1);
      }
      return this.#accessToken.token.access_token;
    }
  }
}

