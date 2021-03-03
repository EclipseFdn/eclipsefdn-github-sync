# eclipsefdn-github-sync

## Repository access levels

To be granted access to a repository through the Eclipse Sync scripts (Gitlab or Github), a user must first either be nominated as a committer or a project lead within the PMI(projects management interface), or be added as a contributor by an active committer or project lead. Depending on the role granted within the PMI, different access rights will be granted through the sync scripts. Should a user be promoted or retired within a project, the new permission sets should be active within a few hours of finalization.

Bot access within repositories is possible, but managed by a manual process and tracked by a [publicly available API](https://api.eclipse.org/bots) rather than through the sync script. How these bot permissions are typically interpretted varies by platform, and more info for each is available in the given sections below.

The Eclipse Foundation supports granting permissions from triage to maintain permissions on Github, and Reporter to Maintainer on Gitlab. Owner permissions are not supported for either platform as they are not needed for typical project management scenarios.

### Gitlab Permissions mapping

More information on Gitlab permissions can be found in the [API documentation](https://docs.gitlab.com/ee/user/permissions.html).

| Eclipse Group | Gitlab Permission |
|---|---|
| Contributor | Reporter |
| Committer | Developer |
| Project Leads | Maintainer |

### Github Permissions mapping

Information on Github permissions is available in the [documentation for organizations](https://docs.github.com/en/github/setting-up-and-managing-organizations-and-teams/repository-permission-levels-for-an-organization).

| Eclipse Group | Github Permission |
|---|---|
| Contributor | triage |
| Committer | push |
| Project Leads | maintain |

## Github Sync

Within Github, there is a mixed strategy for management of projects within the space. Projects that are started while under the Eclipse umbrella or from a project that was incepted within the Eclipse ecosystem are created under the central Eclipse organization. Repositories or projects born from organizations or groups that have joined Eclipse Foundation post inception are usually managed under organizations managed by the EclipseWebmaster. While there are cases where projects can cross organizational bounds, it is uncommon (and covered by the sync script). 

Permissions to projects are managed through hidden teams that are then granted access to each repository for the given project within the current organization. For each organization that a project has repositories in, a set of contributor, committer, and project-lead teams will be created to give access to those repositories. Each of these teams will have the same set of users as defined within the project management interface on projects.eclipse.org.

In regards to bot access, this is typically granted at the repository level, but can also be added at the team level if more broad access is needed. These permissions, while not removed by the script are currently managed manually by the Eclipse Foundation. If there are issues regarding bot access, new or existing, an issue should be created within our [bug-tracking system](https://bugs.eclipse.org) rather than within this project.

Below is an example of how a few projects may be managed within the Eclipse ecosystem:

```  
Eclipse/
├─ dash-licenses (project)
├─ technology-dash-contributors (private team, access to dash-licenses)
├─ technology-dash-committers (private team, access to dash-licenses)
├─ technology-dash-committers (private team, access to dash-licenses)
locationtech/
├─ spatial4j (project)
├─ locationtech-spatial4j-contributors (private team, access to spatial4j)
├─ locationtech-spatial4j-committers (private team, access to spatial4j)
├─ locationtech-spatial4j-committers (private team, access to spatial4j)
```

## Gitlab Sync

In Gitlab, a nested group strategy was chosen to manage access to both groups and projects. This gives greater control over inherited permissions without having to manage teams across multiple base groups. For each Open Source group with repositories managed by the Eclipse Foundation (such as Eclipse Foundation and the Open Hardware Group), a base group will exist to encapsulate all projects for that group. Within each of these groups, each active project will have a subgroup (such as Eclipse Dash and Eclipse Marketplace Client) that will manage permissions for all repositories active within the Gitlab instance. 

In regards to bot access, this can be granted at either the subgroup or project (repository) level depending on the needs of the project. These permissions, while not removed by the script are currently managed manually by the Eclipse Foundation. If there are issues regarding bot access, new or existing, an issue should be created within our [bug-tracking system](https://bugs.eclipse.org) rather than within this project.

Below is an example of a few projects within the Eclipse Gitlab instance and their structure:

```  
Eclipse/ (group)
├─ Eclipse Dash/ (group)
│  ├─ dash-gitlab-testing (project)
│  ├─ org.eclipse.dash.handbook (project)
├─ Eclipse Marketplace Client/ (group)
│  ├─ MPC Client (project)
│  ├─ org.eclipse.epp.mpc (project)
Eclipse Foundation/ (group)
├─ webdev/ (group)
│  ├─ eclipsefdn-api-common (project)
├─ 
```  

## Running the toolset for development

By default, the script is run in docker containers to emulate the production environment (Openshift). This sync tool can be run in standard and verbose mode. The difference between the modes is that in verbose all log messages are printed to the STDOUT of the container.

Before running, an `api-token` file should be created that contains the GitHub API key to be used for connectivity. This should be created in a `secret` folder in the root of the project (this has been excluded from Git commits so there is less danger of pushing live keys to a public repository).

Additionally, an eclipse-oauth-config should be created when running the GitLab sync script. This file will define how connections to the Eclipse OAuth server should be handled. If this is missing, the GitLab sync script will fail. The file should be in JSON format, with the following being an example of format:

```
{"oauth":{"timeout":3600, "client_id":"<client id>","client_secret":"<client secret>","endpoint":"https://accounts.eclipse.org","scope":"eclipsefdn_view_all_profiles","redirect":"http://localhost"}}
```


```
docker build -f Dockerfile -t ef/gh-test .
docker run -i --rm -v <fullpath to current project folder>/secrets:/run/secrets --env DRYRUN=true ef/gh-test
```

## Maintainers

**Martin Lowe (Eclipse Foundation)**

- <https://github.com/autumnfound>

## Trademarks

* Eclipse® is a Trademark of the Eclipse Foundation, Inc.
* Eclipse Foundation is a Trademark of the Eclipse Foundation, Inc.

## Copyright and license

Copyright 2019 the [Eclipse Foundation, Inc.](https://www.eclipse.org) and the [eclipsefdn-github-sync authors](https://github.com/eclipsefdn/eclipsefdn-github-sync/graphs/contributors). Code released under the [Eclipse Public License Version 2.0 (EPL-2.0)](https://github.com/eclipsefdn/eclipsefdn-github-sync/blob/master/LICENSE).
