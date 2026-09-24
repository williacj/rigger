ABOUTME: A journal entry from card #118 on a config value no tool can fill, and what shipping a
plausible default for one costs.

# A wrong number that named a real board

`rigger.config.mjs` said `board.project` was 1. GitHub says the Rigger board is 6, and 1 is a real but unrelated board of the owner's. A number naming nothing would have failed on the first read; a number naming a real board would have worked the wrong one quietly, and nothing reads the field until M2, so nothing would have noticed until the engine moved somebody else's cards.

The value could not be corrected in one file, and that turned out to be the useful part. This repository's config and its template are one artifact — `init` fills `repo` from the `origin` remote and the two may differ nowhere else — so the question was not what the number is but what `init` does about a fact it cannot read. Asked with `gh api graphql`, the boards linked to a repository are three for `nodejs/node`, none for `cli/cli`, and a SAML permission error for `microsoft/vscode`, and `gh auth login`'s own help does not name `project` among the scopes it requests. So asking GitHub at `init` time answers a different shape of nothing for each consumer, and every one of those answers still needs somewhere to put a value nobody chose.

The lesson is about the shape rather than the number. A field only the consumer can answer has exactly two honest states — answered, or visibly not — and a plausible default is neither. `repo` already had the honest form and half the mechanism: a placeholder the template ships. What it lacked was the other half, because nothing refused a config still holding it. Refusing is what makes a placeholder a question rather than a value, and it is why the starter config a consumer now receives is refused for one named field until they answer it.

The divergence check between this repository and its template reads the board number back out of the config it is comparing. That looks circular and is deliberate: no offline check can tell 6 from 1, because GitHub owns the fact. What the check can say is that the question was answered here, and what it cannot say is left for `doctor` to ask.
