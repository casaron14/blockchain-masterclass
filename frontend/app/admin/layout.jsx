import Link from 'next/link';
import { AdminProvider } from '@/context/AdminContext';
import { defaultEventConfig } from '@/lib/eventConfig';

export const metadata = {
  title: 'Admin',
  description: `Manage bookings for the ${defaultEventConfig.name} event.`,
};

const ADMIN_SECTION_LINKS = [
  { href: '/admin', label: 'Bookings' },
  { href: '/admin/transactions', label: 'Transactions' },
  { href: '/admin/settings', label: 'Settings' },
];

export default function AdminLayout({ children }) {
  return (
    <AdminProvider>
      <div className="admin-shell">
        <header className="admin-masthead">
          <div className="admin-masthead__inner">
            <Link href="/admin" className="admin-masthead__brand">
              <span className="admin-masthead__institution">DienAcademy</span>
              <span className="admin-masthead__title">{defaultEventConfig.name}</span>
              <span className="admin-masthead__suffix">Back office</span>
            </Link>

            <nav className="admin-nav" aria-label="Admin">
              {ADMIN_SECTION_LINKS.map((adminLink) => (
                <Link key={adminLink.href} href={adminLink.href} className="admin-nav__link">
                  {adminLink.label}
                </Link>
              ))}
              <Link
                href={`/${defaultEventConfig.slug}`}
                className="admin-nav__link admin-nav__link--exit"
              >
                Event site
              </Link>
            </nav>
          </div>
        </header>

        <div className="admin-container">{children}</div>
      </div>
    </AdminProvider>
  );
}
