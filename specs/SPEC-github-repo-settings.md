# GitHub repository settings

Status: Approved

Date: 2026-11-13

## Authority and purpose

The user requested `$super-agent setup this github repo settings as the other projects`.
This is a direct, lower-assurance settings change, documented after execution.
Target: alexbanica/netatmo-home-coach-control-integration.

## Delivered behavior

Matched verified RpiInfrastructure, RpiEPaper and cad-designs merge settings:
squash merges only, delete merged branches, allow updating PR branches, wiki disabled.
Auto-merge remains disabled. Actions retains read-only workflow permissions and
cannot approve pull request reviews.

Copied RpiEPaper's active default-branch ruleset: prevent deletion and force pushes,
require linear history and pull requests with resolved review conversations,
zero mandatory approvals, squash-only PR merges, and Copilot review on pushes
excluding draft PRs. Repository administrators retain an always-bypass role.
Ruleset ID: 27214319. No required status checks were added because the reference
ruleset does not require them.

## Constraints, assumptions and impact

The established infrastructure/CAD convention was selected over the older Toytrail
merge defaults. GitHub reports the repository as public; visibility is preserved.
Application behavior in docs/specs/NETATMO-001-SPEC.md remains unchanged.
No application, CI, credentials, release, deployment or live calibration changes.
No prior approved artifact was modified. No settings were changed in reference repos.

## Validation and documentation

Read back repository settings, Actions permissions and ruleset through GitHub API.
These verify stored configuration, not a future merge or Copilot review execution.
Local whitespace validation covers this pair of documentation artifacts.
Business/build tests are inapplicable; longer checks, independent QA and review
were skipped under super-agent. Documentation consists of this SPEC and paired PLAN.
