/** **************************************************************
 Copyright (C) 2020 Eclipse Foundation, Inc.

 This program and the accompanying materials are made
 available under the terms of the Eclipse Public License 2.0
 which is available at https://www.eclipse.org/legal/epl-2.0/

  Contributors:
    Martin Lowe <martin.lowe@eclipse-foundation.org>

 SPDX-License-Identifier: EPL-2.0
******************************************************************/
/*
   Note: teams should not be removed from the static file until they
   have been removed manually or expired and automatically deleted.
   Otherwise, they will become orphan teams that are no longer managed
   by the script.
*/
const teamData = require('./static.json');
const { getLogger } = require('../logger.js');

const ServiceTypes = {
  GITHUB: 'GITHUB',
  GITLAB: 'GITLAB',
};
// Enum used for mapping permissions between different systems
const PermissionsEnum = {
  READ: function(serviceType) {
    if (serviceType === ServiceTypes.GITHUB) {
      return 'pull';
    } else if (serviceType === ServiceTypes.GITLAB) {
      return '10';
    }
  },
  TRIAGE: function(serviceType) {
    if (serviceType === ServiceTypes.GITHUB) {
      return 'triage';
    } else if (serviceType === ServiceTypes.GITLAB) {
      return '20';
    }
  },
  WRITE: function(serviceType) {
    if (serviceType === ServiceTypes.GITHUB) {
      return 'push';
    } else if (serviceType === ServiceTypes.GITLAB) {
      return '30';
    }
  },
  MAINTAIN: function(serviceType) {
    if (serviceType === ServiceTypes.GITHUB) {
      return 'maintain';
    } else if (serviceType === ServiceTypes.GITLAB) {
      return '40';
    }
  },
  ADMIN: function(serviceType) {
    if (serviceType === ServiceTypes.GITHUB) {
      return 'admin';
    } else if (serviceType === ServiceTypes.GITLAB) {
      return '40';
    }
  },
};
const enumKeys = Object.keys(PermissionsEnum);

class StaticTeamManager {
  extendedTeamData;
  // guarded verbose value
  #verbose = false;
  set verbose(val) {
    if (typeof val === 'boolean') {
      this.#verbose = val;
      this.#logger = getLogger(this.#verbose ? 'debug' : 'info', 'StaticTeamManager');
    }
  }
  get verbose() {
    return this.#verbose;
  }
  #logger;
  set logger(logger) {
    this.#logger = logger;
  }
  get logger() {
    return this.#logger;
  }

  /**
  Expects data in the following format, to match other static team definitions:
    [
      {
        "repos": [
          "https://github.com/eclipsefdn-webdev/example",
          "https://gitlab.eclipse.org/eclipsefdn-webdev/example"
        ],
        "teamName": "sample-triage",
        "members": [
          {
            "name": "malowe",
            "url": "https://api.eclipse.org/account/profile/malowe",
            "expiration": ""
          }
        ],
        "permission": "TRIAGE",
        "expiration": "2099-12-31"
      }
    ]
   */
  constructor(additionalTeamData = []) {
    this.extendedTeamData = [];
    if (additionalTeamData.length !== 0 && additionalTeamData instanceof Array) {
      this.extendedTeamData.push(...additionalTeamData);
    }
    this.extendedTeamData.push(...teamData);
    this.#logger = getLogger('info', 'StaticTeamManager');
  }

  processTeams(serviceType) {
    let out = [];
    for (let key in this.extendedTeamData) {
      let team = this.extendedTeamData[key];
      if (this.#verbose) {
        this.#logger.info(`Processing team ${team.teamName} for service type '${serviceType}'`);
      }
      let perms = this.getPermissionsForTeam(team, serviceType);
      if (perms === null) {
        this.#logger.warn(`Could not get permissions for team, ending processing of this team: ${JSON.stringify(team)}`);
        continue;
      } else if (this.#verbose) {
        this.#logger.verbose(`Detected permissions value of '${perms}' for current team.`);
      }

      let repos = [];
      for (let repoIdx in team.repos) {
        let repo = team.repos[repoIdx];
        // if the repo is applicable to current service, then track it
        if (this.checkRepoForServiceType(repo, serviceType)) {
          if (this.#verbose) {
            this.#logger.debug(`Repo '${repo}' in team ${team.teamName} is compatible with current service type, tracking`);
          }
          repos.push(repo);
        } else if (this.#verbose) {
          this.#logger.debug(`Repo '${repo}' in team ${team.teamName} not compatible with current service type ${serviceType}, skipping`);
        }
      }
      // only add if there are repos to handle
      if (repos.length > 0) {
        out.push({
          repos: repos,
          members: team.members,
          name: team.teamName,
          permission: perms,
          expiration: team.expiration,
        });
      }
    }
    return out;
  }

  checkRepoForServiceType(repo, serviceType) {
    if (serviceType === ServiceTypes.GITHUB) {
      return (/^(https:\/\/)?(www.)?github.com\/.*$/).test(repo);
    } else if (serviceType === ServiceTypes.GITLAB) {
      return (/^(https:\/\/)?(www.)?gitlab.eclipse.org\/.*$/).test(repo);
    }
    return false;
  }

  getPermissionsForTeam(team, serviceType) {
    if (team === null) {
      this.#logger.warn('Cannot get permissions for null team');
      return null;
    }
    if (serviceType === null) {
      this.#logger.warn(`Cannot get permissions for team ${team.teamName} with no service type`);
      return null;
    }
    // iterate over the enum keys to check if
    for (let idx in enumKeys) {
      let key = enumKeys[idx];
      if (team.permission === key) {
        if (this.#verbose) {
          this.#logger.verbose(`Found permissions ${PermissionsEnum[key](serviceType)} for team ${team.teamName}`);
        }
        return PermissionsEnum[key](serviceType);
      }
    }
    this.#logger.warn(`No valid permissions found for team ${team.teamName}`);
    return null;
  }
}


module.exports.StaticTeamManager = StaticTeamManager;
module.exports.ServiceTypes = ServiceTypes;
