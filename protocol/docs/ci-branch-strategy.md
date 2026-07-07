# CI and Branch Strategy

This document defines the GitHub workflow and merge policy for canix402.

## Branch Flow

- Day-to-day work happens on feature branches.
- Feature branches open PRs into `dev`.
- `dev` is the integration branch.
- Release PRs promote `dev` into `main`.

## Required Status Checks

The CI workflow is defined in `.github/workflows/ci.yml` and should be required
for merges into `dev` and `main`.

Require these checks:

- `Protocol checks`
- `Website checks`
- `Docker build smoke`

## Branch Protection Rules

Configure the following for `dev` and `main`:

- Require a pull request before merging.
- Require status checks to pass before merging.
- Require branches to be up to date before merging.
- Block direct pushes (except admins if desired).
- Optionally require at least one reviewer.

## Smoke Validation

Production smoke checks are in `.github/workflows/production-smoke.yml`.

- Manual run via `workflow_dispatch`.
- Daily scheduled run.
- Covers live health/discovery/openapi/x402 preflight (no paid settlement).

Use this smoke workflow as a runtime confidence check, not as a merge gate.
