# Pre-Release Checklist for v1.0.0

Use this checklist before creating the v1.0.0 release tag and publishing to GitHub.

## Code Quality

- [x] All unit tests pass (`npm test`)
- [x] No ESLint errors (if configured)
- [x] Configuration validator works (`npm run validate`)
- [ ] Manual testing completed on target platforms
  - [ ] Ubuntu 22.04
  - [ ] Windows 11
  - [ ] macOS (if available)
- [ ] All example configurations validated
- [ ] Health check endpoint returns 200

## Documentation

- [x] CHANGELOG.md updated with v1.0.0 section
- [x] All documentation links valid
- [x] INSTALL.md instructions tested
- [x] CONFIGURATION.md examples verified
- [x] API.md endpoints documented
- [x] TROUBLESHOOTING.md covers common issues
- [x] CONTRIBUTING.md provides clear guidelines
- [x] README.md up to date
- [x] LICENSE year correct (2025)
- [x] Example configurations in examples/ directory

## Version Numbers

- [x] package.json version: 1.0.0
- [x] client/package.json version: 1.0.0
- [x] CHANGELOG.md has [1.0.0] section with date
- [ ] Git tag created: `v1.0.0`

## Build & Test

- [ ] Server starts without errors
- [ ] Client builds successfully (`npm run build`)
- [ ] Built client assets in client/dist/
- [ ] Mock channel connects and receives frames
- [ ] WebSocket connections work
- [ ] Authentication works
- [ ] Health endpoints accessible without auth
- [ ] Setup wizard completes successfully

## GitHub Preparation

- [x] GitHub Actions CI/CD workflows created
- [x] Release automation workflow ready
- [ ] All changes committed to main branch
- [ ] No uncommitted changes in working directory
- [ ] Repository pushed to GitHub

## Release Assets

The following will be automatically created by the release workflow:

- [ ] nexdigi-1.0.0.tar.gz (full package)
- [ ] nexdigi-1.0.0.zip (full package, Windows-friendly)
- [ ] nexdigi-server-1.0.0.tar.gz (server only)
- [ ] SHA256SUMS.txt (checksums)

## Release Notes

- [x] Release announcement prepared (RELEASE_ANNOUNCEMENT.md)
- [x] Changelog excerpt ready
- [ ] Screenshots/demo ready (optional for v1.0.0)
- [ ] Known issues documented

## Post-Release Tasks

After the release is published:

- [ ] Verify release assets uploaded correctly
- [ ] Test download and installation from release
- [ ] Verify checksums match
- [ ] Update website/blog (if applicable)
- [ ] Announce on social media/forums:
  - [ ] Reddit r/amateurradio
  - [ ] QRZ forums
  - [ ] eHam.net
  - [ ] Local club email list
- [ ] Create GitHub Discussion announcement
- [ ] Update project status badges (if any)

## Creating the Release

### Step 1: Final Commit

```bash
# Ensure all changes are committed
git status

# Commit any final changes
git add -A
git commit -m "chore: prepare for v1.0.0 release"
git push origin main
```

### Step 2: Create Tag

```bash
# Create annotated tag
git tag -a v1.0.0 -m "Release v1.0.0 - First stable release"

# Push tag to GitHub (triggers release workflow)
git push origin v1.0.0
```

### Step 3: Monitor Release

1. Go to https://github.com/na4wx/NexDigi/actions
2. Watch the "Release Automation" workflow
3. Wait for all jobs to complete (usually 5-10 minutes)
4. Verify release created at https://github.com/na4wx/NexDigi/releases

### Step 4: Verify Release

```bash
# Download release
wget https://github.com/na4wx/NexDigi/releases/download/v1.0.0/nexdigi-1.0.0.tar.gz

# Verify checksum
wget https://github.com/na4wx/NexDigi/releases/download/v1.0.0/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt

# Extract and test
tar -xzf nexdigi-1.0.0.tar.gz
cd nexdigi-1.0.0
npm run setup
npm run dev
```

### Step 5: Announce

Post to forums/social media using RELEASE_ANNOUNCEMENT.md as a template.

## Rollback Procedure

If critical issues are found after release:

```bash
# Delete tag locally
git tag -d v1.0.0

# Delete tag from GitHub
git push origin :refs/tags/v1.0.0

# Delete GitHub Release (manually in web UI)
# Fix issues, increment version to v1.0.1, repeat process
```

## Notes

- Keep this checklist updated for future releases
- Document any issues encountered during release
- Update automation if manual steps are required
- Consider creating release candidates (v1.0.0-rc.1) for major releases

## Release Timeline

Estimated time for full release process:
- Pre-release checklist: 1-2 hours
- Create tag and push: 5 minutes
- GitHub Actions build: 5-10 minutes
- Verify release: 15 minutes
- Announce and communicate: 30 minutes
- **Total**: 2-3 hours

## Success Criteria

Release is considered successful when:
- [x] All automated tests pass
- [ ] Release assets available on GitHub
- [ ] Installation works on all platforms
- [ ] No critical bugs reported in first 24 hours
- [ ] Documentation accurate and complete
- [ ] Community can successfully deploy

---

**Last Updated**: October 20, 2025  
**Release Manager**: NA4WX  
**Status**: Ready for v1.0.0 release
