# Wagner's Painting timecards

The timecard app lives at:

- `/wagners-timecards.html`

It uses the existing AP Advantage Player Firebase account system through
`nova-auth.js`. Painters sign in with Google or email/password, draft entries on
their phone, and submit signed timecards to the Cloud Run backend.

## Employee accounts

Each painter creates a Wagner employee account after signing in. The profile is
stored under the signed-in Firebase user id.

- Default collection: `wagnersEmployees`
- Override with: `WAGNERS_EMPLOYEE_COLLECTION`

The employee profile stores the employee name, phone, optional employee ID, role,
and signed-in email. Submitted timecards copy those fields onto the timecard so
the payroll record remains attached to the employee even if the profile changes
later.

## Backend storage

Submitted cards are stored in Firestore.

- Default collection: `wagnersTimecards`
- Override with: `WAGNERS_TIMECARD_COLLECTION`

Each card stores:

- signed-in Firebase user id, email, and display name
- employee profile id, employee name, role, phone, and optional employee ID
- week start and end
- multiple job entries per day
- calculated total hours
- signature name and submission timestamp
- status for payroll review
- timecard email delivery status

## Email notification

Submitted cards are prepared for email delivery to:

```text
WAGNERS_TIMECARD_EMAIL_TO=wagnerspainting@comcast.net
```

The email is formatted as a QuickBooks export package:

- Short payroll summary in the message body
- Attached CSV named `quickbooks-timecard-employee-week-id.csv`
- Inline CSV backup in the message body

The attached QuickBooks CSV has one row per job/time activity:

- Employee
- Employee Email
- Employee ID
- Customer/Project
- Service Item
- Payroll Item
- Date
- Hours
- Billable
- Class
- Description
- Source Timecard ID
- Source Entry ID
- Submitted At

The backend supports either Mailgun or Resend for outbound email:

```text
MAILGUN_API_KEY=...
MAILGUN_DOMAIN=...
```

or:

```text
RESEND_API_KEY=...
```

Optional sender override:

```text
WAGNERS_TIMECARD_EMAIL_FROM="Wagner Timecards <timecards@bnapsen.com>"
```

If no mail provider key is configured, the timecard still saves normally and the
card records `emailDelivery.status=not-configured`.

## Boss access

Boss review/export is controlled by an environment variable on Cloud Run:

```text
WAGNERS_TIMECARD_ADMIN_EMAILS=owner@example.com,bookkeeper@example.com
```

Only those signed-in email addresses can load all submitted timecards or update
their payroll status.

## Direct QuickBooks sync

The backend includes a dormant QuickBooks Online sync path. It stays disabled
until an Intuit app is configured.

Required Cloud Run environment variables:

```text
QUICKBOOKS_CLIENT_ID=...
QUICKBOOKS_CLIENT_SECRET=...
QUICKBOOKS_REDIRECT_URI=https://nova-arcade-backend-2rpkpv7fpq-uc.a.run.app/api/wagners/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=production
```

Optional:

```text
QUICKBOOKS_OAUTH_STATE_SECRET=...
QUICKBOOKS_MINOR_VERSION=75
WAGNERS_QUICKBOOKS_COLLECTION=wagnersQuickBooks
```

After those are set, a boss account can open the payroll export panel, click
`Connect QuickBooks`, and have an authorized QuickBooks user approve the Intuit
OAuth connection. The boss can then sync individual timecards into QuickBooks
Online as TimeActivity entries.

The direct sync resolves QuickBooks objects by name before creating entries:

- employee name -> QuickBooks Employee
- customer/project -> QuickBooks Customer/Project
- work type -> QuickBooks Product/Service item

If a name does not match QuickBooks, sync stops and reports the missing mapping
instead of creating incomplete payroll data.

## Export

The app exports CSV columns meant to be easy to reshape for payroll:

- Employee
- Employee Email
- Employee ID
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
