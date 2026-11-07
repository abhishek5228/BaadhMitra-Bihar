# bmctl

A small Go terminal client for BaadhMitra, for a control-room PC with a poor connection or no browser. **Read-only**: it shows the ranked queue and river gauges and exports the incident list. It cannot assign, resolve or change anything.

Standard library only, one static binary.

```bat
cd tools\bmctl
go build -o bmctl.exe .

set BM_API=https://xxxx.execute-api.ap-southeast-2.amazonaws.com/prod
set BM_CLIENT=<UserPoolClientId from the deploy output>
set BM_USER=you@example.org
set BM_PASS=your-password
bmctl queue -n 10
bmctl gauges
bmctl export -o incidents.csv
```

Settings come from environment variables so a password never appears in a flag or shell history. If your account uses two-step sign-in, also set `BM_CODE` to the current 6-digit code. A first sign-in that asks for a new password must be done once in the dashboard.

The CSV export protects spreadsheets from place names that start with `=`, `+`, `-` or `@` (place names come from citizen messages), and includes no reporter ids or message text.

Tests: `go test ./...` (fake sign-in and API servers, no AWS needed).
