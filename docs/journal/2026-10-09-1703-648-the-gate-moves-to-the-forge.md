<!-- ABOUTME: Records what card 648 learned redrawing ARCHITECTURE.md's gate as one L2 rule enforced on the forge and in the engine. -->
# The gate moves to the forge

`ARCHITECTURE.md` described the gate as a client hook that nothing could route around. #638 showed a forge merge and a push that skips the hook both reach the main line, so that sentence was false before any M5 code existed. The section now places the boundary in a required status check, with the hooks kept as an early check under `D23` rule 2.

Two spike findings shaped the text more than any reasoning did. #643 Q-a showed that a check pinned to GitHub Actions' integration is satisfied by any Actions run's token, which is why both contexts are pinned to a gate App's id. #701 finding 6 showed a run marked cancelled still posting, so the section rests correctness on serial runs per card and never on cancellation. That serial premise is GitHub's documented behaviour and was not measured; the section says so.

Writing the posting job as a numbered list exposed a category error in the first draft: declaring `environment: gate` is a property of the job, not a step, and listing it as step one implied an order that does not exist.

Naming which directories L3 has L1 remove after a merge forced a choice the card left open. The text names the workspace and each role's judge and scratch directories. The architect's structure §5 said a requirement row for scratch directories returns only if M5 removes them, so that question is now live and goes to the PM.
