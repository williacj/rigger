<!-- ABOUTME: Records the item-2 guard added after the first independent review of card 621. -->

# Guard the omitted post-kill response

The first judge found that `A0 call omitted` still passed when its helper forced a post-kill zombie listing. The earlier assertion checked the census positions and the group event, but neither established that a read after the kill omitted the target. That let the omitted and zombie cells collapse into the same observed outcome.

The stand-in now labels each answered read before or after the group kill, using the kill mark already written by the test's signal stand-in. The omitted census tests require an actual post-kill response and reject a row for the target in every such response. The zombie tests retain their distinct state and listing assertions. Call fixtures keep a reaping parent outside the group so an omitted call also reaches a post-kill read.

Before the fixture change, the new guard failed in `A0 call omitted` because no post-kill response occurred. With the revised fixture, the real `A0 call omitted` and `A0 call zombie` tests passed separately. A disposable copy that changed the omitted test's helper forcing to `zombie` failed at the new omission guard; its diagnostic showed a zombie row after the kill. The 31-cell selector then passed after the stand-in marked read phases explicitly. Full outputs are linked from PR #687.
