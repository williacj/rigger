#!/bin/bash
# ABOUTME: Throwaway for #1462: saves every issue and pull request comment of this public repository
# as JSON lines under public/, and prints how many there are and the window they cover.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$here/public"
gh api 'repos/williacj/rigger/issues/comments?per_page=100' --paginate --jq '.[] | {id, created_at, issue: (.issue_url | split("/") | last | tonumber), body}' > "$here/public/comments.jsonl"
jq -s '{comments: length, first: (map(.created_at) | min), last: (map(.created_at) | max)}' "$here/public/comments.jsonl"
