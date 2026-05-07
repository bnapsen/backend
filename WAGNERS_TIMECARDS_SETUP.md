# Wagner's Painting timecards

The timecard app lives at:

- `/wagners-timecards.html`

It uses the existing AP Advantage Player Firebase account system through
`nova-auth.js`. Painters sign in with Google or email/password, draft entries on
their phone, and submit signed timecards to the Cloud Run backend.

## Backend storage

Submitted cards are stored in Firestore.

- Default collection: `wagnersTimecards`
- Override with: `WAGNERS_TIMECARD_COLLECTION`

Each card stores:

- signed-in Firebase user id, email, and display name
- worker name and role
- week start and end
- multiple job entries per day
- calculated total hours
- signature name and submission timestamp
- status for payroll review

## Boss access

Boss review/export is controlled by an environment variable on Cloud Run:

```text
WAGNERS_TIMECARD_ADMIN_EMAILS=owner@example.com,bookkeeper@example.com
```

Only those signed-in email addresses can load all submitted timecards or update
their payroll status.

## Export

The app exports CSV columns meant to be easy to reshape for payroll:

- Employee
- Employee Email
- Date
- Customer or Project
- Job Name
- Service
- Pay Type
- Start Time
- End Time
- Break Minutes
- Hours
- Billable
- Notes
- Source Timecard ID
- Status
- Submitted At

The first QuickBooks automation step should map the app fields to the company's
QuickBooks employee and customer/project names. A direct QuickBooks integration
later should use QuickBooks OAuth and time activity APIs instead of storing any
QuickBooks password in this app.
