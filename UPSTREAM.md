# Source Provenance

This repository contains the complete tracked source snapshot of
[LobeHub v2.2.20](https://github.com/lobehub/lobehub/tree/v2.2.20), followed by the
New API integration and its standalone deployment files.

- Upstream commit: `49204982cab98bfa2f2fb6831a34d5018a2af6be`.
- The initial snapshot commit preserves the exact upstream Git tree. Upstream
  commit history is not imported into this independent repository.
- The adaptation source matches the verified integration patch with SHA-256
  `0bde34bf4707af5fcab71214954192f2803e793a91e6db690a7a496ac92121d9`.
- Upstream license, copyright notices, attribution, and source files are retained.
  This fork does not change the upstream license or grant additional rights.

## Deployment And Automation

Use [deploy/lobehub/README.md](deploy/lobehub/README.md). The repository includes
the frozen dependency locks and build fixes required by the tested Docker build.
Do not use the upstream image or build the unmodified top-level Dockerfile
directly for this integration.

All 31 upstream GitHub Actions workflows are removed from the adapted branch.
They target upstream release registries, deployment services, synchronization,
and repository policies. This independent repository intentionally has no active
Actions workflows until its owner configures and reviews them. No container
image or release is published by importing or pushing this source.

Dependencies, compiled application assets, local Docker state, runtime reports,
real environment files, and credentials are excluded. Build-time lock/config
adjustments are applied inside the builder by the deployment tools, rather than
committed as unrelated changes to upstream application manifests.

## Validation Scope

The adapted application has been exercised locally with separate test accounts
and a local model fixture: embedded login/logout, session and file ownership,
group/model selection, accounting, mobile layout, model-price visibility, and
model availability notices. No paid upstream request is required for these checks.
The fork preserves the same application sources; publication itself changes
only repository documentation, standalone build delivery, and workflow policy.

Deployment generation tests are included under `deploy/lobehub/`. The original
adapter's broader integration tests and focused typecheck tooling remain in the
paired New API repository under `integrations/lobehub/`; they are not a claim
that the complete upstream test suite or a fresh full build ran on publication.
