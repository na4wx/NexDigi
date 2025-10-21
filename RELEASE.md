# Release Instructions

This document provides step-by-step instructions for creating new releases of NexDigi.

## Overview

NexDigi uses semantic versioning (MAJOR.MINOR.PATCH) and automated releases via GitHub Actions.

## Version Numbering

- **MAJOR** (1.x.x): Breaking changes, incompatible API changes
- **MINOR** (x.1.x): New features, backwards compatible
- **PATCH** (x.x.1): Bug fixes, backwards compatible

Pre-release suffixes:
- `-alpha.1`: Early testing, unstable
- `-beta.1`: Feature complete, testing
- `-rc.1`: Release candidate, final testing

## Release Types

### 1. Patch Release (Bug Fixes)

For critical bug fixes that don't change functionality.

**Example**: 1.0.0 → 1.0.1

```bash
# Update CHANGELOG.md
vim CHANGELOG.md  # Add [1.0.1] section

# Update version
npm version patch --no-git-tag-version
cd client && npm version patch --no-git-tag-version && cd ..

# Commit
git add -A
git commit -m "chore: prepare for v1.0.1 release"
git push

# Tag and push
git tag -a v1.0.1 -m "Release v1.0.1 - Bug fixes"
git push origin v1.0.1
```

### 2. Minor Release (New Features)

For new features that don't break existing functionality.

**Example**: 1.0.0 → 1.1.0

```bash
# Update CHANGELOG.md
vim CHANGELOG.md  # Add [1.1.0] section with new features

# Update version
npm version minor --no-git-tag-version
cd client && npm version minor --no-git-tag-version && cd ..

# Commit
git add -A
git commit -m "chore: prepare for v1.1.0 release"
git push

# Tag and push
git tag -a v1.1.0 -m "Release v1.1.0 - New features"
git push origin v1.1.0
```

### 3. Major Release (Breaking Changes)

For breaking changes or major architectural updates.

**Example**: 1.9.0 → 2.0.0

```bash
# Update CHANGELOG.md with breaking changes section
vim CHANGELOG.md

# Update version
npm version major --no-git-tag-version
cd client && npm version major --no-git-tag-version && cd ..

# Update migration guide in CHANGELOG.md
# Document all breaking changes

# Commit
git add -A
git commit -m "chore: prepare for v2.0.0 release"
git push

# Tag and push
git tag -a v2.0.0 -m "Release v2.0.0 - Major update"
git push origin v2.0.0
```

### 4. Pre-Release (Alpha/Beta/RC)

For testing before stable release.

```bash
# Alpha
npm version 1.1.0-alpha.1 --no-git-tag-version
git tag -a v1.1.0-alpha.1 -m "Release v1.1.0-alpha.1"

# Beta
npm version 1.1.0-beta.1 --no-git-tag-version
git tag -a v1.1.0-beta.1 -m "Release v1.1.0-beta.1"

# Release Candidate
npm version 1.1.0-rc.1 --no-git-tag-version
git tag -a v1.1.0-rc.1 -m "Release v1.1.0-rc.1"
```

## Pre-Release Checklist

Before creating any release:

1. **Run Tests**
   ```bash
   npm test
   npm run validate
   npm run lint
   ```

2. **Update Documentation**
   - Update CHANGELOG.md
   - Update version numbers
   - Review README.md
   - Check all doc links

3. **Build Client**
   ```bash
   npm run build
   ```

4. **Test Locally**
   ```bash
   npm run dev  # Verify server starts
   # Test basic functionality
   ```

5. **Review Checklist**
   - See PRE_RELEASE_CHECKLIST.md

## Creating the Release

### Automated Process (Recommended)

1. **Prepare Release**
   ```bash
   # Update CHANGELOG.md
   vim CHANGELOG.md
   
   # Update versions
   npm version <version> --no-git-tag-version
   cd client && npm version <version> --no-git-tag-version && cd ..
   
   # Commit changes
   git add -A
   git commit -m "chore: prepare for v<version> release"
   git push origin main
   ```

2. **Create Tag**
   ```bash
   git tag -a v<version> -m "Release v<version>"
   git push origin v<version>
   ```

3. **Monitor Workflow**
   - Visit: https://github.com/na4wx/NexDigi/actions
   - Watch "Release Automation" workflow
   - Wait for completion (~5-10 minutes)

4. **Verify Release**
   - Check: https://github.com/na4wx/NexDigi/releases
   - Verify assets uploaded
   - Test download and installation

### Manual Process (Fallback)

If automated release fails:

1. **Build Locally**
   ```bash
   npm run build
   npm ci --production
   cd client && npm ci --production
   ```

2. **Create Archive**
   ```bash
   tar -czf nexdigi-<version>.tar.gz \
     server/ client/dist/ scripts/ docs/ examples/ \
     package.json README.md LICENSE CHANGELOG.md
   ```

3. **Generate Checksums**
   ```bash
   sha256sum nexdigi-<version>.tar.gz > SHA256SUMS.txt
   ```

4. **Create GitHub Release**
   - Go to: https://github.com/na4wx/NexDigi/releases/new
   - Tag: v<version>
   - Title: NexDigi v<version>
   - Description: Copy from CHANGELOG.md
   - Upload: Archives and checksums
   - Publish

## Post-Release Tasks

1. **Verify Installation**
   ```bash
   wget https://github.com/na4wx/NexDigi/releases/download/v<version>/nexdigi-<version>.tar.gz
   tar -xzf nexdigi-<version>.tar.gz
   cd nexdigi-<version>
   npm run setup
   npm run dev
   ```

2. **Announce Release**
   - Reddit r/amateurradio
   - GitHub Discussions
   - Twitter/X
   - Ham radio forums
   - Local club

3. **Update Documentation**
   - Website (if applicable)
   - Wiki (if applicable)
   - Badges in README

4. **Monitor Issues**
   - Watch for bug reports
   - Respond to questions
   - Plan hotfix if needed

## Hotfix Process

For critical bugs in production:

```bash
# Create hotfix branch from tag
git checkout -b hotfix-1.0.1 v1.0.0

# Fix the bug
# ... make changes ...

# Commit fix
git add -A
git commit -m "fix: critical bug description"

# Update version
npm version patch --no-git-tag-version
cd client && npm version patch --no-git-tag-version && cd ..

# Update CHANGELOG.md
vim CHANGELOG.md

# Commit version bump
git add -A
git commit -m "chore: bump version to 1.0.1"

# Merge to main
git checkout main
git merge hotfix-1.0.1
git push origin main

# Tag and push
git tag -a v1.0.1 -m "Hotfix v1.0.1"
git push origin v1.0.1

# Delete hotfix branch
git branch -d hotfix-1.0.1
```

## Rollback Procedure

If a release has critical issues:

```bash
# Delete tag
git tag -d v<version>
git push origin :refs/tags/v<version>

# Mark release as draft or delete on GitHub
# Fix issues
# Create new patch version
```

## Release Schedule

Suggested release schedule:

- **Major releases**: Yearly or as needed
- **Minor releases**: Quarterly or as needed
- **Patch releases**: As needed for bugs
- **Pre-releases**: Before major/minor releases

## Changelog Format

Always update CHANGELOG.md following Keep a Changelog format:

```markdown
## [1.1.0] - 2025-11-15

### Added
- New feature X
- New feature Y

### Changed
- Modified behavior of Z

### Deprecated
- Feature A (will be removed in v2.0.0)

### Removed
- Old feature B

### Fixed
- Bug in C
- Issue with D

### Security
- Patched vulnerability in E
```

## Version Support

- **Current major version**: Full support
- **Previous major version**: Security updates for 1 year
- **Older versions**: No support

## Communication

Release announcements should include:
- Version number
- Release date
- Major changes
- Installation instructions
- Breaking changes (if any)
- Migration guide (if needed)

## Tools

Useful commands:

```bash
# List all tags
git tag

# Show tag details
git show v1.0.0

# Compare versions
git diff v1.0.0 v1.1.0

# Current version
npm version

# Next versions
npm version patch --dry-run
npm version minor --dry-run
npm version major --dry-run
```

## Troubleshooting

### Tag Already Exists

```bash
# Delete local tag
git tag -d v1.0.0

# Delete remote tag
git push origin :refs/tags/v1.0.0

# Recreate tag
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

### GitHub Actions Failed

1. Check workflow logs
2. Fix issues in code
3. Delete tag
4. Fix and recreate tag
5. Or use manual process

### Wrong Version Released

1. Delete the release (GitHub UI)
2. Delete the tag
3. Fix version numbers
4. Create new tag with correct version

---

**For questions, see:**
- [CONTRIBUTING.md](docs/CONTRIBUTING.md)
- [GitHub Releases Help](https://docs.github.com/en/repositories/releasing-projects-on-github)

**73 de NA4WX**
