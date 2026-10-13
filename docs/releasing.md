# Releasing

The game is at **https://pedrohenriques15.github.io/party-kart/**. GitHub Pages serves the root of
the repo's `gh-pages` branch, which holds nothing but the last build. The setting is under
Settings → Pages: deploy from a branch, `gh-pages`, `/ (root)`.

## Shipping a change

1. **Check it.**

   ```sh
   npm run check && npm test
   ```

   If "eight bots race a lap…" fails on "the lead changes", run it again. That test is flaky
   (see `CLAUDE.md`).
2. **Commit it to `main` and push.**

   ```sh
   git push origin main
   ```

3. **Publish it.**

   ```sh
   npm run deploy
   ```

   `scripts/deploy.sh` runs the tests again and builds with `npm run build`. It then copies `dist/`
   into a fresh repository with a `.nojekyll` file (so Pages serves the files as they are) and
   force-pushes it to `origin` as `gh-pages`. It needs bash (Git Bash on Windows) and push access
   to the repo.
4. **Check that it's live.** Pages rebuilds within a minute or two. The live page's script name
   should match the one in the fresh build:

   ```sh
   curl -s https://pedrohenriques15.github.io/party-kart/ | grep -o 'assets/index-[^"]*\.js'
   grep -o 'assets/index-[^"]*\.js' dist/index.html
   ```

   GitHub's CDN caches pages for up to 10 minutes (`max-age=600`), so a browser can show the old
   build for a while. A hard refresh (Ctrl+F5) gets the new one.

## Things to know

- **The deploy publishes the working tree, not a commit.** Whatever is in `src/` gets built and
  published, committed or not. Commit and push first, and deploy from a clean `main`, so the live
  game is always a commit you can find again.
- **`gh-pages` has no history.** Each deploy replaces it with a single new commit. To roll back,
  check out the last good commit, run `npm run deploy`, then switch back to `main`.
- **Players keep the old build until they reload.** Old and new builds still share rooms as long
  as the peer id prefix in `src/session.ts` is unchanged. If the network messages changed so that
  an old client would misbehave, change the prefix too. See
  [making-changes.md](making-changes.md#a-new-network-message).
- **The build works under `/party-kart/`** because `vite.config.ts` sets `base: './'`, which makes
  every path relative. Keep it that way, or the site breaks on Pages.
- **There's no CI.** Nothing builds or deploys by itself. The live site only changes when someone
  runs `npm run deploy`.
