# analysis

After-action report from the incident CSV, in Python (standard library only).

```bat
python analysis\afteraction.py incidents.csv > report.md
```

Input is either the dashboard's "Download incident list (CSV)" (officers get closed incidents too) or `bmctl export -all`. The report gives counts by status, time until a crew was assigned and until resolved (median, p90 and a bootstrap 95% interval for the median), results by severity, who closed incidents, overdue counts and the longest-waiting open incidents.

Small samples are labelled as such, and a median from fewer than five incidents gets no interval. Times are the dashboard's own timestamps, so they measure how long the system knew about an incident, not how long a family waited.

Tests: `cd analysis && python -m unittest`.
