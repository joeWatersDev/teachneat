import { BookOpen, FileText, MessageSquare, Scale, ShieldCheck } from 'lucide-react';
import { ActionList, type ActionRow } from '../../components/ui/ActionList';
import { PageHeader } from '../../components/ui/PageHeader';

/**
 * Help and support (Phase 2 Step 6f).
 *
 * An intermediate page rather than a menu item that goes straight to the
 * contact form, because "help" now means two different things and only one of
 * them is us: documents a teacher can read at midnight, and a message that
 * waits for a reply. The form was the only one of those that existed, which
 * made every question a support ticket.
 *
 * So the page is the one action, then everything to read. Contacting us stands
 * alone at the top not because it is the most likely thing a teacher wants, but
 * because it is the only thing on the page that starts something: a row that
 * creates a support request should not sit in a list of documents where it can
 * be clicked by momentum.
 */

const ROWS: ActionRow[] = [
  {
    key: 'contact',
    icon: MessageSquare,
    label: 'Contact support',
    description:
      'Send us a question or report a problem, and see the status of anything you have already sent.',
    to: '/support',
  },
];

/**
 * Everything there is to read, in one group.
 *
 * "Managing your data" leads it. It is documentation rather than an agreement,
 * and it is the one a teacher arrives with an actual task behind — exporting a
 * class list, deleting an account — while the three below it are consulted
 * rather than followed. It is also a compliance artifact: Google's Workspace API
 * user data and developer policy requires that we "provide user help
 * documentation that explains how users can manage and delete their data from
 * your app or service", and this is where a teacher finds it.
 *
 * All four are public pages outside the app shell, so following one leaves the
 * app. That is why the marketing header offers a way back on exactly these
 * routes — see `MarketingLayout`.
 */
const REFERENCE_ROWS: ActionRow[] = [
  {
    key: 'your-data',
    icon: BookOpen,
    label: 'Managing your data',
    description:
      'Where your students’ information is kept, and how to view, export, correct or delete any of it — including your account.',
    to: '/help/your-data',
  },
  {
    key: 'faq',
    icon: FileText,
    label: 'Common questions',
    description: 'The questions teachers ask before and just after signing up.',
    to: '/faq',
  },
  {
    key: 'privacy',
    icon: ShieldCheck,
    label: 'Privacy policy',
    description:
      'What we hold, what stays in your own Google account, who else sees it, and how long any of it is kept.',
    to: '/privacy',
  },
  {
    key: 'terms',
    icon: Scale,
    label: 'Terms of service',
    description:
      'The agreement you accepted when you signed up, including your responsibilities for student information and how closing an account works.',
    to: '/terms',
  },
];

export function HelpPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader title="Help and support" />
      <ActionList rows={ROWS} />

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-primary">Reference</h2>
        <ActionList rows={REFERENCE_ROWS} />
      </div>
    </div>
  );
}
