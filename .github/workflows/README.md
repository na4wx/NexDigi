# GitHub Actions Workflows

This directory contains automated CI/CD workflows for NexDigi.

## Workflows

### ci.yml - Continuous Integration

Runs on every push and pull request to `main` and `develop` branches.

**Jobs:**

1. **Lint** - Code quality checks
   - Runs ESLint (if configured)
   - Validates configuration files
   - Node.js 18

2. **Test** - Unit tests
   - Runs on Node.js 18 and 20
   - Executes `npm test`
   - Uploads test results as artifacts

3. **Build Client** - Build production bundle
   - Builds React client with Vite
   - Checks bundle size
   - Uploads build artifacts

4. **Security** - Security audit
   - Runs `npm audit` on server and client
   - Checks for high/critical vulnerabilities
   - Uploads audit results

5. **Integration Test** - End-to-end tests (PR only)
   - Creates test configuration
   - Starts server in background
   - Runs integration tests (when configured)

6. **Release** - Create release artifacts (tags only)
   - Packages full application
   - Generates checksums
   - Uploads to GitHub Releases

7. **Notify** - Failure notification
   - Runs if any job fails
   - Reports failure details

**Triggers:**
- Push to `main` or `develop`
- Pull requests to `main` or `develop`
- Release published

### release.yml - Release Automation

Runs when a version tag is pushed (e.g., `v1.0.0`).

**Jobs:**

1. **Build and Release**
   - Extracts version from tag
   - Installs dependencies
   - Runs tests
   - Builds client
   - Updates package.json versions
   - Creates release packages:
     - Full package (tar.gz + zip)
     - Server-only package (tar.gz)
   - Generates SHA256 checksums
   - Extracts changelog for version
   - Creates GitHub Release with:
     - Release notes from CHANGELOG.md
     - Installation instructions
     - Download links
     - Checksums

**Triggers:**
- Tags matching `v*.*.*` (e.g., v1.0.0, v1.2.3)

## Usage

### Triggering CI

CI runs automatically on every push and pull request. No manual action needed.

### Creating a Release

1. Update CHANGELOG.md with new version:
   ```markdown
   ## [1.0.0] - 2025-10-20
   
   ### Added
   - New feature description
   
   ### Fixed
   - Bug fix description
   ```

2. Commit changes:
   ```bash
   git add CHANGELOG.md
   git commit -m "chore: prepare release v1.0.0"
   git push
   ```

3. Create and push tag:
   ```bash
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin v1.0.0
   ```

4. GitHub Actions will automatically:
   - Run all tests
   - Build the client
   - Create release packages
   - Generate checksums
   - Publish GitHub Release

### Checking Workflow Status

- Visit: https://github.com/na4wx/NexDigi/actions
- Click on a workflow run to see details
- Download artifacts from successful runs

## Artifacts

### Test Results
- Location: Uploaded as `test-results-node-{version}`
- Contents: Test output and coverage reports
- Retention: 90 days (default)

### Client Build
- Location: Uploaded as `client-build`
- Contents: Production-ready client files
- Retention: 7 days

### Security Audit
- Location: Uploaded as `security-audit`
- Contents: npm audit JSON reports
- Retention: 90 days

### Release Packages
- Location: GitHub Releases page
- Contents:
  - nexdigi-{version}.tar.gz (full package)
  - nexdigi-{version}.zip (full package)
  - nexdigi-server-{version}.tar.gz (server only)
  - SHA256SUMS.txt (checksums)
- Retention: Permanent

## Local Testing

### Test the CI workflow locally with act:

```bash
# Install act (https://github.com/nektos/act)
brew install act  # macOS
choco install act  # Windows

# Run CI workflow
act push

# Run specific job
act -j test

# Run with secrets
act -s GITHUB_TOKEN=your_token
```

## Secrets Required

No secrets are required for the current workflows. The `GITHUB_TOKEN` is automatically provided by GitHub Actions.

For future enhancements (optional):
- `NPM_TOKEN` - For publishing to npm registry
- `DISCORD_WEBHOOK` - For Discord notifications
- `SLACK_WEBHOOK` - For Slack notifications

## Troubleshooting

### Tests Fail in CI But Pass Locally

**Possible causes:**
- Environment differences (paths, line endings)
- Missing environment variables
- Timing issues in async tests
- Platform-specific code (Windows vs Linux)

**Solutions:**
- Check CI logs for specific errors
- Add debug output: `console.log()` or `set -x` in bash
- Test with `NODE_ENV=test` locally
- Use `matrix` strategy to test multiple Node versions

### Build Fails to Upload Artifacts

**Error:** `Artifact upload failed`

**Solutions:**
- Check artifact path exists
- Verify permissions
- Ensure artifact size < 10GB
- Check for special characters in artifact name

### Release Workflow Doesn't Trigger

**Possible causes:**
- Tag format doesn't match `v*.*.*`
- Tag not pushed to remote
- Workflow file has syntax errors

**Solutions:**
```bash
# List tags
git tag

# Push specific tag
git push origin v1.0.0

# Push all tags
git push --tags

# Verify workflow syntax
cat .github/workflows/release.yml | yamllint -
```

### npm audit Finds Vulnerabilities

**Note:** `npm audit` runs with `continue-on-error: true`, so vulnerabilities won't fail the build.

**To fix:**
```bash
# Update dependencies
npm audit fix

# Update with breaking changes
npm audit fix --force

# Review specific vulnerability
npm audit | grep <package-name>
```

## Best Practices

### Commit Messages

Use conventional commits for automatic changelog generation:

```
feat(chat): add message encryption
fix(bbs): resolve message duplication
docs(api): update authentication examples
chore(deps): update dependencies
```

### Version Tags

Follow semantic versioning:
- **Major** (v2.0.0): Breaking changes
- **Minor** (v1.1.0): New features, backwards compatible
- **Patch** (v1.0.1): Bug fixes, backwards compatible

Pre-release tags:
- Alpha: v1.0.0-alpha.1
- Beta: v1.0.0-beta.1
- RC: v1.0.0-rc.1

### Changelog

Keep CHANGELOG.md updated with every release:
- Add new section at top
- Use "Unreleased" section for ongoing work
- Link to GitHub compare view
- Follow Keep a Changelog format

## Monitoring

### Success Rate

Monitor workflow success rate:
- GitHub Insights → Actions
- Track failed runs
- Investigate patterns

### Build Times

Typical job durations:
- Lint: ~1 minute
- Test: ~2-3 minutes per Node version
- Build Client: ~2 minutes
- Security: ~1 minute
- Release: ~5 minutes

### Optimization

To reduce build times:
- Use `npm ci` instead of `npm install`
- Enable caching for node_modules
- Parallelize independent jobs
- Skip unnecessary steps with conditions

## Future Enhancements

Planned workflow improvements:
- [ ] Code coverage reporting with Codecov
- [ ] Automated dependency updates (Dependabot)
- [ ] Performance benchmarks
- [ ] Docker image building and pushing
- [ ] Deployment to staging environment
- [ ] Smoke tests after deployment
- [ ] Automatic CHANGELOG.md generation
- [ ] Notify Discord/Slack on releases

---

**For more information:**
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Workflow Syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)
- [CONTRIBUTING.md](../../docs/CONTRIBUTING.md)

**73 de NA4WX**
