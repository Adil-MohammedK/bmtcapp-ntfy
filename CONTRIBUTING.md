# Contributing

Thank you for helping improve BMTC Live Tracker. Contributions are welcome for
the Home Assistant integration, transit API, web app, and documentation.

## Before you start

- Check existing issues and pull requests to avoid duplicating work.
- For a significant change, open an issue first to discuss the approach.
- Keep changes focused and explain any user-visible behavior changes.
- Never include credentials, personal data, or other secrets in an issue or
  pull request.
- Use [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/)
  messages (for example, `feat: add weekend route support` or
  `fix: handle missing bus ETAs`). A `feat` commit triggers a minor release, a
  `fix` commit triggers a patch release, and a breaking change triggers a major
  release.

## Development setup

The API and web app use the repository's npm workspaces and require Node.js 20
or newer:

```bash
npm ci
npm run typecheck
npm run build
```

The Home Assistant integration is under
`custom_components/bmtc_live_tracker`. There is no Python test suite configured
in this repository; validate integration changes against the supported Home
Assistant behavior and include clear manual verification steps in your pull
request. The GitHub Actions workflow runs HACS validation and Hassfest.

## Pull requests

1. Make your change on a branch.
2. Update relevant documentation and translations when behavior or setup
   changes.
3. Run the applicable checks above and report their results.
4. Open a pull request with a concise summary, motivation, and test/verification
   details. Include screenshots for visual changes when useful.
5. Be responsive to review feedback and keep the discussion respectful.

By submitting a contribution, you agree that it will be distributed under the
project's [MIT License](./LICENSE).

## Releases

Release Please checks commits pushed to `main` and opens or updates a release
pull request when it finds releasable Conventional Commits. The PR updates the
changelog and keeps the root package, npm lockfile, and Home Assistant
integration versions in sync. Merging that PR publishes the corresponding
versioned GitHub release.
