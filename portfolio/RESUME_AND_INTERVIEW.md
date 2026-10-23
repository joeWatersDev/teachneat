# Teachneat: Resume and Interview Notes

## Resume entry

**Founder and developer, Teachneat** (classroom web app for secondary teachers), January to October 2026

- Surveyed 39 teachers and interviewed 4 to find where their non-teaching time went. 70% had missed an accommodation they should have provided, and about 74% spent more than five minutes a week on parent-communication logistics.
- Wrote a product requirements document that set a baseline and a target for each feature, such as cutting a class-wide parent email from 15 to 30+ minutes to under 5.
- Built and launched the full product on my own (React, TypeScript, Express, Postgres, Google Sheets and Gmail APIs) with 1,139 automated tests, and got it through Google's OAuth app verification.
- Stored all student data in each teacher's own Google Sheet, with no copy kept on the app's servers, to make the app easier for school boards to approve.
- Designed the free and Premium plans and built Stripe billing, then switched billing off when a legal review limited the launch to a free year in Ontario.
- Tracked first use of each tool and monthly usage per account, and used that data alongside a feedback form to test the product with three teachers.
- Shut the product down when testing showed teachers weren't using the core tools, before signing up for insurance, a legal review or tax registration.

### Shorter version

- Researched, built and launched Teachneat, a web app for teachers, from a 39-teacher survey and requirements document to a live product approved by Google.
- Tested it with teachers using account usage data and a feedback form, and found that the tools they rated highly were the ones they didn't use.
- Shut it down on that evidence before taking on insurance, legal and tax costs.

## Profile summary

Teachneat was a web app I researched, designed, built and ran for secondary school teachers. It kept one class list in the teacher's own Google Drive and used it for attendance, random groups, a name picker and personalized emails to families. It went live in August 2026 and passed Google's OAuth verification in September. When I tested it with colleagues, they rated the tools well but didn't use attendance or grouping, mainly because they already take attendance in the school's system. With the accommodation feature already removed after a legal review, I shut it down in October before taking on its ongoing costs. The case study covers the research, the main decisions, the testing and why I stopped.

## Interview stories

### Deciding what to build

I had more problems from teachers than I could build for, so I ranked them using the survey. The board's accommodation system averaged 2.4 out of 5 and 70% of teachers had missed an accommodation, so accommodations came first. Grouping averaged 3.75 out of 5 with existing tools like Flippity, so I treated it as an extra. Each feature in the requirements document had a baseline and a target, for example a class-wide parent email going from 15 to 30+ minutes to under 5.

### Removing the most important feature

In August a legal review found that the school board, not the teacher, has the authority to approve a tool for special education records. I removed accommodation tracking completely, limited the launch to Ontario and made it free for the first year. It was the right call legally, but it took away the feature behind my strongest research result. Whether boards would allow that data had been an open question since February, and I would now answer a question like that before writing any code.

### What testers said compared to what they did

Three colleagues created accounts and three filled out a feedback form. On the form they rated grouping and attendance well, and two of three said they were likely to sign up (4, 4 and 2 out of 5). In the app, all three added students and opened the Name Picker, but none saved attendance, made groups or sent an email, and only one came back after the first day. One comment explained the attendance result: they would not take attendance twice, once for the school and once for the app. Three people can't tell you a rate, and I don't present it as one. What I wanted to know was whether people with every reason to try it would start using it regularly, and they didn't.

### Deciding to stop

The next steps were insurance, a legal review, a business mailing address, tax registration and months of approvals with each school board. I weighed four things: the accommodation feature was gone, testers didn't use the core tools, none of them used a school Google account, and costs would start well before any revenue. Hosting alone was about $31 USD a month, roughly seven subscribers at the planned price. I stopped before signing up for any of those costs and kept the backlog in case I come back to it.

## Likely questions

**Why not keep running it for free?** Free still costs hosting and insurance, and comes with privacy obligations to every teacher whose class list passes through the server. Without regular use there was no route to the paid plan that would cover those costs.

**What would make you come back to it?** A school board willing to approve the app for its teachers, and a way to avoid double entry, either syncing attendance with the school's student information system or importing class lists from Google Classroom or a CSV file. Both are written up in the project's backlog.

**What would you have needed to see to keep going?** Testers using the tools each week without being reminded. None of the accounts got to the point where a specific threshold would have mattered.
