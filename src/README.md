# What do we do here?

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
├─ 
├─ 
```  
