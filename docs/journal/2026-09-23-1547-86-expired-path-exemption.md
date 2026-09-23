ABOUTME: A journal entry from card #86 on retiring a path exemption when its generated directory lands.

# An exemption outlived its condition

The generated test matrix now creates `docs/derived/`, so the path exemption written for the absent directory had expired. The path check already ignores that exemption once the directory exists, which is why removing its entry changes no current check result. Removing the entry makes the configuration reflect the condition it already enforces.
