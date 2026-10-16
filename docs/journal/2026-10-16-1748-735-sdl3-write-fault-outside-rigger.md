ABOUTME: Records why #735's demo-job tar EILSEQ on SDL_hints.h is a transient runner-host write
fault outside Rigger, what the probe ruled out, and why no workflow change was made.

# The demo job's SDL3 write error is the runner's, not ours (#735)

On 2026-10-14, attempt 1 of CI run 38504642946 (job 115659222813, at `d6d079f`) failed in
`brew install vhs`. While Homebrew fetched the bottles, tar reported
`sdl3/3.4.16/include/SDL3/SDL_hints.h: Write failed: Illegal byte sequence` and exited 1.
One second later the same job poured SDL3 from the same cached file, and the step still ended
with exit 1. Attempt 2 (job 115664188727), at the same SHA, passed without any change. Both ran
image `macos-26-arm64` `20260907.0351`.

**Cause: a transient data-write failure on the runner host, outside Rigger and not
reproducible.** The device and the trigger were never observed. Nothing here prevents a
recurrence, so the risk that remains is that roughly one demo run in sixty fails this way again
and needs a re-run. That rate is the coordinator's figure for this signature: one occurrence in
the last 60 `ci.yml` runs. I did not measure it.

The source shows where the error comes from. The image's release notes list Homebrew 6.0.22,
and H1's log shows no auto-update, though the job never printed a version. Homebrew 6.0.22
(`08e85c4`, `Library/Homebrew/bottle.rb:335–353`) verifies the bottle's SHA-256 before its
fetch-stage extraction. Its retry helper (`:170–200`) hashes the file again after a failed
extraction and prints `Removing corrupt cached download` on a mismatch. H1 shows no such line,
so the bytes matched the bottle checksum both before and after tar failed.

In libarchive 3.7.4 (`313aa1f`), `Write failed` is set only where `write(2)` on the destination
file returns -1 (`libarchive/archive_write_disk_posix.c:1031–1033`). bsdtar appends
`strerror(errno)` (`tar/read.c:376`). So the kernel returned `EILSEQ` on a data write. That
path never converts a pathname, so the locale plays no part in it. The tar version is
`bsdtar 3.5.3 - libarchive 3.7.4`, observed on the probe image, whose OS build (26.6.2, 25G83)
matches the H1 image's release notes. That the H1 runner had the same tar is an inference from
that OS build, not an observation.

The explanations the card asked about each fail against H1 itself:

- **Bottle bytes:** verified before and after the failure, as above.
- **Locale:** it is never consulted on this path.
- **Extraction path:** the fetch stage and the pour run the same tar invocation into a
  `homebrew-unpack` directory, and the pour succeeded.
- **Fetch and pour order:** the failure came at fetch while the later pour succeeded, which no
  fixed ordering explains.

Whether concurrent fetches mattered is not part of the claim. H1 did fetch in parallel, but the
probe found no difference between parallel and serial fetching.

The probe, CI run 38936627558, made 1,308 attempts on four `macos-26` runners and none
reproduced the error. Each runner ran:

- **V0:** a direct extraction of the verified bottle (`8af6805a…`). `SDL_hints.h` was written
  intact.
- **V1:** the same under `LC_ALL=C`. The result was identical.
- **D0:** the same with one byte damaged. Integrity failed, and tar printed
  `Damaged tar archive`. That is a different signature, with no `EILSEQ`.
- 300 extractions twelve at a time.
- Twelve cold-cache installs with parallel fetching and twelve with serial fetching.

A third-party report (coder/internal#1066) shows the same `Write failed: Illegal byte sequence`
on another macOS runner, which its provider traced to a bad block device. I treat that as
corroboration only.

**No workflow change is justified.** Two alternatives were considered and rejected:

- **Serial fetching:** it had no measured effect (0 failures of 12 against 0 of 12).
- **Retrying the install:** it would hide the fault rather than change it.

The probe job was removed before review. Its run and artifacts are the evidence.
