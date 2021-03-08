# Gitlab Migration script (BugZilla source)

In our efforts to modernize, we have looked to migrate from Bugzilla to the more modern Gitlab platform for hosted bug tracking outside of GitHub. This has necessitated a migration effort to ensure there is as little effort needed to move to the new platform, with as little hassle as possible.


## Parameters 

| Parameter name | Required | Accepts | Default | Description |
|----------------|:--------:|---------|---------|-------------|
|-c, --component | ✓ | string | N/A | The Bugzilla component to search in for bugs. |
|-P, --product | ✓ | string | N/A | The Bugzilla product to search in for bugs. |
|-t, --targetProject | ✓ | number | N/A | The target project ID in Gitlab to migrate to. This project should be visible and accessible to the public. |
|-s, --secretLocation | ✓ | string | N/A | The location of the files containing API access tokens and secure configurations containing keys. |
|-a, --all | x | boolean flag | `false` | Get all bugs open and closed related to the given product/components when true/set. |
|-b, --bugzillaHost | x | string | `https://bugs.eclipse.org/bugs/` | BugZilla host base URL, should lead to homepage of the BugZilla instance. |
|-d, --dryRun | x | boolean flag | `false` | Runs script as dry run, not writing any changes to API. |
|-H, --host | x | string | `https://gitlab.eclipse.org` | The Gitlab host target for the migration. This allows for testing and staging migrations for use in development and dry runs. |
|-h, --help | x | N/A (flag) | N/A | Prints the help text for the script parameters. |
|-p, --provider | x | string | `oauth2_generic` | The OAuth provider name set in GitLab for the Eclipse Accounts binding. |
|-V, --verbose | x | N/A (counted flag) | 0 | Sets the script to run in verbose mode (ranges from 1-4 for more verbose logging). |

Example usage:

node src/gl/Migration.js --secretLocation=$(pwd)/secrets --component=EclipseCon --product=Community -t 1612