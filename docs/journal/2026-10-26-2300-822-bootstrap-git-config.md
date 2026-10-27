<!-- ABOUTME: Records the isolated Git configuration used by the temporary #822 Mac proof carrier. -->

# Host bootstrap Git configuration

This temporary evidence commit has the frozen #822 guide head b8618111756dcea584d876ec084728fd9632ee85 as its sole parent. It carries only a push-triggered hosted Mac workflow and this scratch journal; neither belongs in the final four-path documentation PR.

The first evidence run, 40443731104, remains attributable to its separate carrier 108ebe6b08586781464b6c117fb02c1372193f65. Its retained originals showed a host-tier failure when the carrier set GIT_CONFIG_NOSYSTEM=1, preventing a Git system-configuration fixture from being read. Its ordinary-tier success does not prove the complete bootstrap.

This carrier unsets GIT_CONFIG_NOSYSTEM before Git commands, records its absence in the parent and each captured child, and uses GIT_CONFIG_SYSTEM=/dev/null as the inherited-host isolation default. A test may override that default with its own fixture. The empty per-run HOME and GIT_CONFIG_GLOBAL=/dev/null remain as the guide requires. Independent exact-head review and owner ratification precede any push; creating this commit proves no supported-Mac result.
